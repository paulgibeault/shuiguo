// shuǐguǒ game state machine. Pure module — no DOM, no Arcade globals; the
// host (main.js) injects a `now()` clock and an rng, so every rule here runs
// under node --test.
//
// States: 'menu' → 'playing' → 'over'. The turn loop (GRD §1): spawn into the
// NEXT preview, promote to the dropper, aim, drop, a short input cooldown,
// merge chains resolve, deadline check, repeat.

import { WORLD, RULES, MAX_LEVEL, MAX_SPAWN_LEVEL, ANNIHILATE_SCORE, radiusOf, scoreOf } from './constants.js';
import { makeBody, step } from './physics.js';

export function makeGame({ rng, now }) {
  const g = {
    state: 'menu',
    bodies: [],
    score: 0,
    current: 1,          // level held in the dropper
    next: 1,             // level shown in the preview
    dropX: WORLD.width / 2,
    canDrop: true,
    lockedAt: null,      // wall-clock ms when input locked (drop happened)
    overAt: null,        // set when the game ends
    // per-game tallies the host folds into Arcade.stats at game over
    tally: { merges: 0, watermelons: 0, annihilations: 0, chainBest: 0 },
    events: [],          // drained by the host each frame → sfx/particles
    rng, now,
  };
  g.current = rollSpawn(rng);
  g.next = rollSpawn(rng);
  return g;
}

function rollSpawn(rng) { return rng.int(1, MAX_SPAWN_LEVEL); }

export function clampDropX(g, x) {
  const r = radiusOf(g.current);
  return Math.min(WORLD.width - r, Math.max(r, x));
}

export function aim(g, x) {
  if (g.state !== 'playing') return;
  g.dropX = clampDropX(g, x);
}

export function start(g) {
  g.state = 'playing';
  g.bodies = [];
  g.score = 0;
  g.canDrop = true;
  g.lockedAt = null;
  g.overAt = null;
  g.tally = { merges: 0, watermelons: 0, annihilations: 0, chainBest: 0 };
  g.current = rollSpawn(g.rng);
  g.next = rollSpawn(g.rng);
  g.dropX = clampDropX(g, WORLD.width / 2);
  g.events.push({ type: 'start' });
}

export function drop(g, x) {
  if (g.state !== 'playing' || !g.canDrop) return false;
  if (typeof x === 'number') aim(g, x);      // tap-to-snap (GRD §4)
  const level = g.current;
  g.bodies.push(makeBody(level, clampDropX(g, g.dropX), WORLD.dropperY));
  g.current = g.next;
  g.next = rollSpawn(g.rng);
  g.dropX = clampDropX(g, g.dropX);          // new fruit may be fatter — re-clamp
  g.canDrop = false;
  g.lockedAt = g.now();
  g.events.push({ type: 'drop', level });
  return true;
}

// Advance the simulation by dt seconds. The host calls this from Arcade.loop.
export function tick(g, dt) {
  if (g.state !== 'playing') return;

  const { mergeable, impacts } = step(g.bodies, dt);
  emitImpacts(g, impacts);
  resolveMerges(g, mergeable);

  // Input unlock: a flat cooldown, not a settle-wait. Waiting on the pile to
  // stop moving cost the player up to 1.5 s a turn and got worse the bouncier
  // the fruit got; a fixed window keeps the cadence honest and predictable.
  if (!g.canDrop && g.now() - g.lockedAt >= RULES.dropCooldownMs) {
    g.canDrop = true;
    g.lockedAt = null;
  }

  checkDeadline(g);
}

// Landings → bounce events for the juice layer, rate-limited per body so a
// pile shuffling itself into place doesn't fire hundreds of squashes a second.
function emitImpacts(g, impacts) {
  if (!impacts.length) return;
  const t = g.now();
  for (const { body, speed, nx, ny } of impacts) {
    if (body.lastImpactAt != null && t - body.lastImpactAt < RULES.impactEventMs) continue;
    body.lastImpactAt = t;
    g.events.push({ type: 'bounce', id: body.id, level: body.level, x: body.x, y: body.y, speed, nx, ny });
  }
}

// Merge every contacting same-level pair, then keep scanning so a freshly
// spawned fruit chains in the SAME tick (GRD §3 "instantly process its own
// collision check").
function resolveMerges(g, firstContacts) {
  let chain = 0;
  let pairs = firstContacts;
  const dead = new Set();
  for (let guard = 0; guard < 24 && pairs.length; guard++) {
    for (const [a, b] of pairs) {
      if (dead.has(a.id) || dead.has(b.id)) continue;
      dead.add(a.id); dead.add(b.id);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      g.bodies = g.bodies.filter((o) => o !== a && o !== b);
      chain++;
      g.tally.merges++;
      if (a.level === MAX_LEVEL) {
        // watermelon + watermelon: mutual destruction, max points, no spawn
        g.score += ANNIHILATE_SCORE;
        g.tally.annihilations++;
        g.events.push({ type: 'annihilate', x: mx, y: my, score: ANNIHILATE_SCORE });
        continue;
      }
      const born = a.level + 1;
      const nb = makeBody(born, mx, my, (a.vx + b.vx) / 2, (a.vy + b.vy) / 2);
      nb.touched = true;
      g.bodies.push(nb);
      g.score += scoreOf(born);
      if (born === MAX_LEVEL) g.tally.watermelons++;
      // `id` lets the renderer key the newborn's pop animation to this body
      g.events.push({ type: 'merge', id: nb.id, level: born, x: mx, y: my, score: scoreOf(born), chain });
    }
    // rescan: did any newborn land touching its own level?
    pairs = [];
    for (let i = 0; i < g.bodies.length; i++) {
      for (let j = i + 1; j < g.bodies.length; j++) {
        const a = g.bodies[i], b = g.bodies[j];
        if (a.level !== b.level) continue;
        const dx = b.x - a.x, dy = b.y - a.y, rs = a.r + b.r;
        if (dx * dx + dy * dy < rs * rs) pairs.push([a, b]);
      }
    }
  }
  if (chain > g.tally.chainBest) g.tally.chainBest = chain;
}

// The line of death (GRD §5): any fruit whose top sits above the deadline for
// a CONTINUOUS overLineMs triggers game over. A falling just-dropped fruit
// passes through the zone before touching anything — grace until first contact.
function checkDeadline(g) {
  const t = g.now();
  for (const b of g.bodies) {
    const over = b.y - b.r < WORLD.deadlineY && (!RULES.spawnGraceContact || b.touched);
    if (!over) { b.overSince = null; continue; }
    if (b.overSince == null) b.overSince = t;
    if (t - b.overSince >= RULES.overLineMs) {
      g.state = 'over';
      g.overAt = t;
      g.events.push({ type: 'gameover', score: g.score });
      return;
    }
  }
}

// Is anything currently in the danger zone? (renderer pulses the line)
export function inDanger(g) {
  return g.bodies.some((b) => b.overSince != null);
}

// ── save / restore (Arcade.state payload) ──────────────────────────────────
// Everything needed to put a mid-game board back: fruit kinematics, the
// dropper queue, the score, and the rng state so future spawns continue the
// same sequence.

export function serialize(g) {
  if (g.state !== 'playing') return null;
  return {
    v: 1,
    score: g.score,
    current: g.current,
    next: g.next,
    rngState: g.rng.getState(),
    tally: g.tally,
    fruits: g.bodies.map((b) => [b.level, Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10]),
  };
}

export function restore(g, save) {
  if (!save || save.v !== 1 || !Array.isArray(save.fruits)) return false;
  if (!Number.isInteger(save.current) || save.current < 1 || save.current > MAX_SPAWN_LEVEL) return false;
  if (!Number.isInteger(save.next) || save.next < 1 || save.next > MAX_SPAWN_LEVEL) return false;
  const fruits = [];
  for (const f of save.fruits) {
    if (!Array.isArray(f) || f.length < 3) return false;
    const [level, x, y] = f;
    if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return false;
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return false;
    const b = makeBody(level, x, y);
    b.touched = true;
    fruits.push(b);
  }
  g.state = 'playing';
  g.bodies = fruits;
  g.score = typeof save.score === 'number' && isFinite(save.score) ? Math.max(0, Math.floor(save.score)) : 0;
  g.current = save.current;
  g.next = save.next;
  g.tally = { merges: 0, watermelons: 0, annihilations: 0, chainBest: 0, ...(save.tally || {}) };
  if (typeof save.rngState === 'number') g.rng.setState(save.rngState);
  g.canDrop = true;
  g.lockedAt = null;
  g.overAt = null;
  g.dropX = clampDropX(g, WORLD.width / 2);
  return true;
}

// shuǐ guǒ tān game state machine. Pure module — no DOM, no Arcade globals; the
// host (main.js) injects a `now()` clock and an rng, so every rule here runs
// under node --test.
//
// States: 'menu' → 'playing' → 'over'. The turn loop (GRD §1): spawn into the
// NEXT preview, promote to the dropper, aim, drop, a short input cooldown,
// merge chains resolve, deadline check, repeat.
//
// WHERE THE FRUIT COMES FROM is injectable. Free play draws forever from the
// rng across levels 1–5 (`rollSpawn`, the default, byte-identical to what it
// always did). The campaign hands in a crate-backed draw instead: a finite
// harvest that can hold anything up to a watermelon and returns null when it
// runs out. That null propagates — the preview empties, then the dropper — and
// the host reads it as "sold out" and closes the stall.

import { WORLD, RULES, MAX_LEVEL, MAX_SPAWN_LEVEL, PHYS, ANNIHILATE_SCORE, radiusOf, scoreOf } from './constants.js';
import { makeBody, step } from './physics.js';

export function makeGame({ rng, now, drawFruit }) {
  const g = {
    state: 'menu',
    bodies: [],
    score: 0,
    current: 1,          // level held in the dropper — null once the stock is out
    next: 1,             // level shown in the preview — empties first
    dropX: WORLD.width / 2,
    canDrop: true,
    lockedAt: null,      // wall-clock ms when input locked (drop happened)
    overAt: null,        // set when the game ends
    // The combo in flight, on the same clock as `lockedAt`. It lives on the
    // game rather than inside resolveMerges because a chain is a thing the
    // PLAYER experiences over a second or so, and resolveMerges is 4ms wide.
    chainDepth: 0,
    lastMergeAt: null,
    // per-game tallies the host folds into Arcade.stats at game over
    tally: freshTally(),
    events: [],          // drained by the host each frame → sfx/particles
    rng, now,
    // A crated game is finite, and it may legitimately hold fruit far bigger
    // than anything free play ever spawns. The distinction is kept on the
    // instance rather than read off a save, so a free-play board stays exactly
    // as strict about a hostile save as it has always been.
    crated: typeof drawFruit === 'function',
    draw: typeof drawFruit === 'function' ? drawFruit : () => rollSpawn(rng),
  };
  // A menu-state game primes its dropper so the board has something to show
  // before the first start(), and start() then re-rolls — which costs an
  // infinite rng stream nothing. A CRATE is stock, though, and priming it would
  // tip two of the player's harvested fruit onto the floor before the stall
  // even opened. So a crated game holds nothing until it starts.
  if (!g.crated) {
    g.current = g.draw();
    g.next = g.draw();
  } else {
    g.current = null;
    g.next = null;
  }
  return g;
}

function rollSpawn(rng) { return rng.int(1, MAX_SPAWN_LEVEL); }

// The biggest level this game is allowed to hold in the dropper.
function maxHeld(g) { return g.crated ? MAX_LEVEL : MAX_SPAWN_LEVEL; }

// Nothing left in the hands or the crate. The host finishes the run on this
// once the pile has settled — see isSettled().
export function isSoldOut(g) { return g.current == null && g.next == null; }

// Is the board at rest? PHYS.settleSpeed is the same threshold the physics uses
// to call a scene settled, so "the last fruit has stopped rolling" means the
// same thing here as it does there.
export function isSettled(g) {
  return g.bodies.every((b) => Math.hypot(b.vx, b.vy) < PHYS.settleSpeed);
}

// `bestLevel` is the biggest fruit this game ever HELD — set by the dropper as
// well as by merges, so the game-over screen always has a fruit to show even
// for a game that never merged anything. Everything else counts events.
function freshTally() {
  return { merges: 0, watermelons: 0, annihilations: 0, chainBest: 0, bestLevel: 0 };
}

function reachedLevel(g, level) {
  if (level > g.tally.bestLevel) g.tally.bestLevel = level;
}

// A watermelon is half the board wide, and clamping already scales by whatever
// is held — which is what makes big-fruit crates work without a special case.
// An empty dropper clamps to the bare walls rather than throwing.
export function clampDropX(g, x) {
  const r = g.current == null ? 0 : radiusOf(g.current);
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
  g.chainDepth = 0;
  g.lastMergeAt = null;
  g.tally = freshTally();
  g.current = g.draw();
  g.next = g.draw();
  g.dropX = clampDropX(g, WORLD.width / 2);
  g.events.push({ type: 'start' });
}

export function drop(g, x) {
  if (g.state !== 'playing' || !g.canDrop) return false;
  if (g.current == null) return false;            // the crate is empty
  if (typeof x === 'number') aim(g, x);      // tap-to-snap (GRD §4)
  const level = g.current;
  g.bodies.push(makeBody(level, clampDropX(g, g.dropX), WORLD.dropperY));
  g.current = g.next;
  g.next = g.draw();
  g.dropX = clampDropX(g, g.dropX);          // new fruit may be fatter — re-clamp
  g.canDrop = false;
  g.lockedAt = g.now();
  reachedLevel(g, level);
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

// The combo counter, advanced once per merge and measured against the wall
// clock. Inside RULES.chainWindowMs of the previous merge this is the same
// combo and deepens; outside it, a new one starts at 1. The value returned is
// the 1-based depth that rides on the event — the semantics `completedChains`
// in js/progress.js already reads, so a 1,2,3,1,2 batch still means what it
// always did.
//
// chainBest is banked HERE rather than at the end of the tick, because a
// windowed combo can still be in flight when the tick (and the frame, and the
// batch the host drains) ends.
function bumpChain(g, t) {
  const continuing = g.lastMergeAt != null && t - g.lastMergeAt < RULES.chainWindowMs;
  g.chainDepth = continuing ? g.chainDepth + 1 : 1;
  g.lastMergeAt = t;
  if (g.chainDepth > g.tally.chainBest) g.tally.chainBest = g.chainDepth;
  return g.chainDepth;
}

// Merge every contacting same-level pair, then keep scanning so a freshly
// spawned fruit chains in the SAME tick (GRD §3 "instantly process its own
// collision check"). Same-tick cascades are still cascades — they simply are
// not the only ones any more.
function resolveMerges(g, firstContacts) {
  let pairs = firstContacts;
  const dead = new Set();
  const t = g.now();
  for (let guard = 0; guard < 24 && pairs.length; guard++) {
    for (const [a, b] of pairs) {
      if (dead.has(a.id) || dead.has(b.id)) continue;
      dead.add(a.id); dead.add(b.id);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      g.bodies = g.bodies.filter((o) => o !== a && o !== b);
      const chain = bumpChain(g, t);
      g.tally.merges++;
      if (a.level === MAX_LEVEL) {
        // watermelon + watermelon: mutual destruction, max points, no spawn.
        // It carries `chain` for the same reason a merge does — the campaign
        // pays a chain multiplier on it (js/economy.js), and the biggest thing
        // the board can do must not be the one merge that drops out of a combo.
        g.score += ANNIHILATE_SCORE;
        g.tally.annihilations++;
        g.events.push({ type: 'annihilate', x: mx, y: my, score: ANNIHILATE_SCORE, chain });
        continue;
      }
      const born = a.level + 1;
      const nb = makeBody(born, mx, my, (a.vx + b.vx) / 2, (a.vy + b.vy) / 2);
      nb.touched = true;
      nb.bornAt = t;              // the renderer's cue for a moment of delight
      g.bodies.push(nb);
      g.score += scoreOf(born);
      reachedLevel(g, born);
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
      finish(g, 'toppled');
      return;
    }
  }
}

// End the run, whatever ended it. Every ending is a sale (design pillar): the
// reason rides on the event so the campaign's appraisal can pay a Tidy Stall
// bonus for the two deliberate ones, and free play can go on ignoring it.
//
//   'toppled'   the deadline rule, unchanged and the default
//   'packed'    the player pressed Pack Up
//   'sold-out'  the crate and both hands are empty
//
// Idempotent: a pile that topples on the same frame the last fruit is sold can
// only close the stall once.
export function finish(g, reason = 'toppled') {
  if (g.state !== 'playing') return false;
  g.state = 'over';
  g.overAt = g.now();
  g.events.push({ type: 'gameover', score: g.score, reason });
  return true;
}

// Is anything currently in the danger zone? (renderer pulses the line)
export function inDanger(g) {
  return g.bodies.some((b) => b.overSince != null);
}

// ── save / restore (Arcade.state payload) ──────────────────────────────────
// Everything needed to put a mid-game board back: fruit kinematics, the
// dropper queue, the score, and the rng state so future spawns continue the
// same sequence.
//
// What is deliberately NOT here: the combo in flight. `lastMergeAt` is a
// performance.now() reading and means nothing in the session that reads it
// back, and a wall-time window has no honest way to survive an app that was
// closed for a week. So a restored run starts with no combo — forfeiting a
// mid-combo on suspend is a stated property of the rule, not an oversight.
// `tally.chainBest` rides along as it always has: the deep chain HAPPENED.

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

// What may sit in the dropper of THIS game, out of a save. The bound is the
// instance's, not the file's: free play still refuses anything it could never
// have spawned, and a crated game additionally accepts the empty hand that
// means the harvest ran out mid-run.
function validHeld(g, v) {
  if (v === null) return g.crated;
  return Number.isInteger(v) && v >= 1 && v <= maxHeld(g);
}

export function restore(g, save) {
  if (!save || save.v !== 1 || !Array.isArray(save.fruits)) return false;
  if (!validHeld(g, save.current)) return false;
  if (!validHeld(g, save.next)) return false;
  // …and the hands empty in order: the preview goes first, so a save holding
  // nothing with a fruit still queued behind it never happened.
  if (save.current === null && save.next !== null) return false;
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
  g.tally = { ...freshTally(), ...(save.tally || {}) };
  // bestLevel indexes FRUITS, so unlike the other counters it must be sound
  // even from a hostile save. It is also additive — saves written before it
  // existed have none, and the save version stays 1 — and the board itself is
  // proof of what was reached, so recover the floor from it rather than
  // resetting the player to zero.
  //
  // A stored value outside 1..MAX_LEVEL is not clamped, it is discarded: the
  // board is better evidence than a number we don't believe. In range it is
  // kept even when it beats every fruit on the board, because it legitimately
  // can — annihilating two watermelons leaves an 11 behind on a board of 3s.
  const saved = g.tally.bestLevel;
  g.tally.bestLevel = Number.isInteger(saved) && saved >= 0 && saved <= MAX_LEVEL ? saved : 0;
  for (const b of g.bodies) reachedLevel(g, b.level);
  if (typeof save.rngState === 'number') g.rng.setState(save.rngState);
  g.canDrop = true;
  g.lockedAt = null;
  g.overAt = null;
  g.chainDepth = 0;
  g.lastMergeAt = null;
  g.dropX = clampDropX(g, WORLD.width / 2);
  return true;
}

// Rigid-circle physics for shuǐguǒ. Pure module — no DOM, runs under
// node --test unchanged.
//
// Deliberately small: circles, one open-topped box, impulse resolution with
// positional correction. The GRD needs rolling, squeezing, and settling —
// not a general engine. Determinism across devices is NOT a goal (nothing
// replays physics); the seeded RNG covers what must be reproducible (spawns).

import { WORLD, PHYS, radiusOf, bounceOf } from './constants.js';

let nextId = 1;

export function makeBody(level, x, y, vx = 0, vy = 0) {
  const r = radiusOf(level);
  return {
    id: nextId++,
    level, x, y, vx, vy, r,
    angle: 0,             // visual roll
    mass: r * r,          // ∝ area; big fruit shoves small fruit, not vice versa
    bounce: bounceOf(level),  // per-fruit restitution — its landing personality
    touched: false,       // has contacted anything (deadline grace, see game.js)
    overSince: null,      // wall-clock ms when its top first crossed the deadline
    lastImpactAt: null,   // wall-clock ms of the last emitted bounce event (game.js)
    bornAt: null,         // wall-clock ms if this body came from a merge; the
                          // renderer wears a happy face for a moment after
                          // (js/fruit-art.js). Never serialized.
  };
}

// Restitution actually applied to a contact: fruit personality above the
// cutoff, dead below it. Slow contacts resolving inelastically is what lets a
// bouncy pile come to rest instead of shivering forever.
function restitution(e, approach) {
  return approach < PHYS.inelasticSpeed ? 0 : e;
}

// One fixed step. Mutates bodies in place. Returns:
//   mergeable — contacting same-level pairs ([bodyA, bodyB]) for the merge pass
//   impacts   — [{ body, speed, nx, ny }] for contacts whose normal approach
//               speed cleared PHYS.impactSpeed, one entry per body (the hardest
//               hit it took this step). The host turns these into juice; game.js
//               rate-limits them per body before they reach the event queue.
export function step(bodies, dt) {
  const g = PHYS.gravity;
  for (const b of bodies) {
    b.vy += g * dt;
    const drag = 1 - PHYS.airDrag;
    b.vx *= drag; b.vy *= drag;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.angle += (b.vx / b.r) * dt;   // reads as rolling; exact contact spin not needed
  }

  const mergeable = [];
  const seenPair = new Set();
  const hits = new Map();   // body → hardest impact this step

  const noteImpact = (b, speed, nx, ny) => {
    if (speed < PHYS.impactSpeed) return;
    const prev = hits.get(b);
    if (!prev || speed > prev.speed) hits.set(b, { body: b, speed, nx, ny });
  };

  for (let iter = 0; iter < PHYS.solverIters; iter++) {
    // walls + floor (container inner faces are frictionless per the GRD)
    for (const b of bodies) {
      if (b.x - b.r < 0) {
        b.x = b.r;
        const approach = Math.abs(b.vx);
        b.vx = approach * restitution(b.bounce, approach);
        noteImpact(b, approach, 1, 0);
        b.touched = true;
      }
      if (b.x + b.r > WORLD.width) {
        b.x = WORLD.width - b.r;
        const approach = Math.abs(b.vx);
        b.vx = -approach * restitution(b.bounce, approach);
        noteImpact(b, approach, -1, 0);
        b.touched = true;
      }
      if (b.y + b.r > WORLD.floorY) {
        b.y = WORLD.floorY - b.r;
        if (b.vy > 0) {
          const approach = b.vy;
          b.vy = -approach * restitution(b.bounce, approach);
          noteImpact(b, approach, 0, -1);
        }
        // rolling resistance on the floor so nothing spins/slides forever
        b.vx *= (1 - PHYS.friction);
        b.touched = true;
      }
    }
    // pairwise circles
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const rsum = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rsum * rsum) continue;

        a.touched = true; b.touched = true;
        if (a.level === b.level && iter === 0) {
          const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
          if (!seenPair.has(key)) { seenPair.add(key); mergeable.push([a, b]); }
        }

        const d = Math.sqrt(d2) || 0.0001;
        const nx = dx / d, ny = dy / d;
        const overlap = rsum - d;
        const invA = 1 / a.mass, invB = 1 / b.mass;
        const invSum = invA + invB;

        // positional correction — split by inverse mass, slight slop to keep
        // resting piles from jittering
        const corr = Math.max(overlap - 0.05, 0) / invSum * 0.8;
        a.x -= nx * corr * invA; a.y -= ny * corr * invA;
        b.x += nx * corr * invB; b.y += ny * corr * invB;

        // impulse along the normal
        const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
        const velN = rvx * nx + rvy * ny;
        if (velN < 0) {
          // pair restitution: the average of the two personalities, so a cherry
          // landing on a watermelon splits the difference
          const approach = -velN;
          const e = restitution((a.bounce + b.bounce) / 2, approach);
          noteImpact(a, approach, -nx, -ny);
          noteImpact(b, approach, nx, ny);
          const jN = -(1 + e) * velN / invSum;
          a.vx -= jN * invA * nx; a.vy -= jN * invA * ny;
          b.vx += jN * invB * nx; b.vy += jN * invB * ny;
          // tangential friction — bleed slip so stacks stop shuffling
          const tvx = rvx - velN * nx, tvy = rvy - velN * ny;
          a.vx += tvx * PHYS.friction * 0.5; a.vy += tvy * PHYS.friction * 0.5;
          b.vx -= tvx * PHYS.friction * 0.5; b.vy -= tvy * PHYS.friction * 0.5;
        }
      }
    }
  }
  return { mergeable, impacts: [...hits.values()] };
}

// Every body slow enough to count as at rest? (The GRD's input re-enable.)
export function settled(bodies) {
  for (const b of bodies) {
    if (Math.abs(b.vx) > PHYS.settleSpeed || Math.abs(b.vy) > PHYS.settleSpeed) return false;
  }
  return true;
}

// Rigid-circle physics for shuǐguǒ. Pure module — no DOM, runs under
// node --test unchanged.
//
// Deliberately small: circles, one open-topped box, impulse resolution with
// positional correction. The GRD needs rolling, squeezing, and settling —
// not a general engine. Determinism across devices is NOT a goal (nothing
// replays physics); the seeded RNG covers what must be reproducible (spawns).

import { WORLD, PHYS, radiusOf } from './constants.js';

let nextId = 1;

export function makeBody(level, x, y, vx = 0, vy = 0) {
  const r = radiusOf(level);
  return {
    id: nextId++,
    level, x, y, vx, vy, r,
    angle: 0,             // visual roll
    mass: r * r,          // ∝ area; big fruit shoves small fruit, not vice versa
    touched: false,       // has contacted anything (deadline grace, see game.js)
    overSince: null,      // wall-clock ms when its top first crossed the deadline
  };
}

// One fixed step. Mutates bodies in place; returns a list of contacting
// same-level pairs ([bodyA, bodyB]) found this step, for the merge pass.
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

  for (let iter = 0; iter < PHYS.solverIters; iter++) {
    // walls + floor (container inner faces are frictionless per the GRD)
    for (const b of bodies) {
      if (b.x - b.r < 0)            { b.x = b.r;                b.vx = Math.abs(b.vx) * PHYS.restitution; b.touched = true; }
      if (b.x + b.r > WORLD.width)  { b.x = WORLD.width - b.r;  b.vx = -Math.abs(b.vx) * PHYS.restitution; b.touched = true; }
      if (b.y + b.r > WORLD.floorY) {
        b.y = WORLD.floorY - b.r;
        if (b.vy > 0) b.vy = -b.vy * PHYS.restitution;
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
          const jN = -(1 + PHYS.restitution) * velN / invSum;
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
  return mergeable;
}

// Every body slow enough to count as at rest? (The GRD's input re-enable.)
export function settled(bodies) {
  for (const b of bodies) {
    if (Math.abs(b.vx) > PHYS.settleSpeed || Math.abs(b.vy) > PHYS.settleSpeed) return false;
  }
  return true;
}

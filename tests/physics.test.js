import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBody, step, settled } from '../js/physics.js';
import { WORLD, PHYS, FRUITS, radiusOf } from '../js/constants.js';

const DT = 1 / 240;
function run(bodies, seconds) {
  for (let t = 0; t < seconds; t += DT) step(bodies, DT);
}

test('a dropped fruit falls, lands on the floor, and settles', () => {
  const b = makeBody(3, WORLD.width / 2, WORLD.dropperY);
  const bodies = [b];
  run(bodies, 3);
  assert.ok(Math.abs(b.y + b.r - WORLD.floorY) < 1.5, `rests on floor, y=${b.y}`);
  assert.ok(settled(bodies), 'settles');
  assert.ok(b.touched, 'floor contact marks touched');
});

// The bounciest fruit in the game is the one most likely to hop forever; if it
// comes to rest, the restitution cutoff is doing its job for everything else.
test('even the bounciest fruit comes to rest (restitution cutoff holds)', () => {
  const b = makeBody(1, WORLD.width / 2, WORLD.dropperY);
  const bodies = [b];
  run(bodies, 5);
  assert.ok(settled(bodies), `cherry settles, vy=${b.vy}`);
  assert.ok(Math.abs(b.y + b.r - WORLD.floorY) < 1.5, 'resting on the floor');
});

test('fruits never interpenetrate at rest and never leave the box', () => {
  const bodies = [];
  for (let i = 0; i < 12; i++) {
    bodies.push(makeBody(1 + (i % 4), 40 + (i * 53) % 280, WORLD.dropperY - (i % 3) * 20));
    run(bodies, 0.4);
  }
  run(bodies, 4);
  for (const b of bodies) {
    assert.ok(b.x - b.r >= -1 && b.x + b.r <= WORLD.width + 1, 'inside walls');
    assert.ok(b.y + b.r <= WORLD.floorY + 1, 'above floor');
  }
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      assert.ok(d > (a.r + b.r) * 0.9, `no deep overlap (${d} vs ${a.r + b.r})`);
    }
  }
});

test('a big fruit displaces a small one, not vice versa', () => {
  const small = makeBody(1, 100, WORLD.floorY - radiusOf(1));
  const big = makeBody(8, 106, WORLD.dropperY);   // slightly off-center hit
  const bodies = [small, big];
  run(bodies, 3);
  // the cherry gets shoved aside; the peach barely deflects (mass ∝ r²)
  assert.ok(Math.abs(small.x - 100) > 5, 'cherry pushed aside');
  assert.ok(Math.abs(big.x - 106) < Math.abs(small.x - 100), 'peach moved less');
});

test('same-level contact is reported for the merge pass', () => {
  const a = makeBody(2, 100, WORLD.floorY - radiusOf(2));
  const b = makeBody(2, 100 + 2 * radiusOf(2) + 4, WORLD.floorY - radiusOf(2));
  b.vx = -80;   // roll into its twin
  const bodies = [a, b];
  let saw = false;
  for (let t = 0; t < 2; t += DT) {
    if (step(bodies, DT).mergeable.length > 0) { saw = true; break; }
  }
  assert.ok(saw, 'contact pair surfaced');
});

// ── per-fruit bounce personality ───────────────────────────────────────────

// Drop one fruit from the dropper and report how fast it leaves the floor.
function floorRebound(level) {
  const b = makeBody(level, WORLD.width / 2, WORLD.dropperY);
  const bodies = [b];
  for (let t = 0; t < 2; t += DT) {
    step(bodies, DT);
    if (b.vy < 0) return -b.vy;      // moving upward again ⇒ it bounced
  }
  return 0;
}

test('a body bounces off the floor with its own restitution', () => {
  const cherry = floorRebound(1);
  const watermelon = floorRebound(11);
  assert.ok(cherry > watermelon * 2, `cherry ${cherry} vs watermelon ${watermelon}`);
  assert.ok(watermelon > 0, 'even a watermelon rebounds a little');
});

test('a wall bounce uses the body own restitution', () => {
  const fast = (level) => {
    const b = makeBody(level, WORLD.width / 2, 300);
    b.vx = 600; b.vy = 0;
    for (let t = 0; t < 2; t += DT) {
      step([b], DT);
      if (b.vx < 0) return -b.vx;
      b.vy = 0;                       // hold it off the floor: walls only
    }
    return 0;
  };
  assert.ok(fast(1) > fast(11) * 2, 'cherry pings off the wall, watermelon does not');
});

test('fruit-fruit contacts use the pair average restitution', () => {
  // identical pair, closing head-on at the same speed: the separation speed
  // after the impulse is the pair restitution made visible
  const separation = (level) => {
    const r = radiusOf(level);
    const a = makeBody(level, 180 - r - 1, 300);
    const b = makeBody(level, 180 + r + 1, 300);
    a.vx = 400; b.vx = -400;
    for (let t = 0; t < 0.5; t += DT) {
      a.vy = 0; b.vy = 0;             // isolate the pair impulse from gravity
      step([a, b], DT);
      if (b.vx > a.vx) return b.vx - a.vx;
    }
    return 0;
  };
  const cherries = separation(1);
  const melons = separation(11);
  assert.ok(cherries > melons * 2, `cherries ${cherries} vs watermelons ${melons}`);
});

test('impacts are reported above the speed threshold and not below it', () => {
  // start each body just touching the floor so the contact resolves this step
  const onFloor = (level, vy) => {
    const b = makeBody(level, WORLD.width / 2, WORLD.floorY - radiusOf(level));
    b.vy = vy;
    return b;
  };

  const b = onFloor(4, PHYS.impactSpeed * 3);
  const hard = step([b], DT).impacts;
  assert.equal(hard.length, 1);
  assert.equal(hard[0].body, b);
  assert.ok(hard[0].speed >= PHYS.impactSpeed);
  assert.equal(hard[0].ny, -1, 'floor normal points up');

  const c = onFloor(4, PHYS.impactSpeed * 0.3);
  assert.equal(step([c], DT).impacts.length, 0, 'a gentle touchdown is not an impact');
});

test('every fruit body carries its table bounce value', () => {
  FRUITS.forEach((f, i) => assert.equal(makeBody(i + 1, 100, 100).bounce, f.bounce, f.name));
});

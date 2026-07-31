import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBody, step, settled } from '../js/physics.js';
import { WORLD, radiusOf } from '../js/constants.js';

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
  const big = makeBody(8, 100, WORLD.dropperY);
  const bodies = [small, big];
  run(bodies, 3);
  // the cherry gets shoved aside; the peach ends up at/near the floor line
  assert.ok(Math.abs(small.x - 100) > 5, 'cherry pushed aside');
});

test('same-level contact is reported for the merge pass', () => {
  const a = makeBody(2, 100, WORLD.floorY - radiusOf(2));
  const b = makeBody(2, 100 + 2 * radiusOf(2) + 4, WORLD.floorY - radiusOf(2));
  b.vx = -80;   // roll into its twin
  const bodies = [a, b];
  let saw = false;
  for (let t = 0; t < 2; t += DT) {
    if (step(bodies, DT).length > 0) { saw = true; break; }
  }
  assert.ok(saw, 'contact pair surfaced');
});

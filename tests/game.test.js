import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, start, drop, tick, aim, serialize, restore, clampDropX } from '../js/game.js';
import { makeBody } from '../js/physics.js';
import { WORLD, RULES, radiusOf, scoreOf, ANNIHILATE_SCORE, MAX_SPAWN_LEVEL } from '../js/constants.js';
import { makeRng } from '../js/arcade-rng.js';

// A controllable clock: tests advance it by hand.
function makeClock() {
  let t = 0;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

function playingGame(seed = 42) {
  const now = makeClock();
  const g = makeGame({ rng: makeRng(seed), now });
  start(g);
  g.events.length = 0;
  return { g, now };
}

// Run the sim for `seconds`, advancing the wall clock in lockstep.
function sim(g, now, seconds) {
  const dt = 1 / 240;
  for (let t = 0; t < seconds; t += dt) {
    tick(g, dt);
    now.advance(dt * 1000);
  }
}

test('spawner only ever rolls levels 1..5', () => {
  const { g } = playingGame(7);
  for (let i = 0; i < 500; i++) {
    assert.ok(g.current >= 1 && g.current <= MAX_SPAWN_LEVEL);
    g.canDrop = true;
    drop(g);
    g.bodies.length = 0;   // keep the board empty; we only test the queue
  }
});

test('dropper clamps to the container walls for the held fruit size', () => {
  const { g } = playingGame();
  g.current = 5;
  const r = radiusOf(5);
  assert.equal(clampDropX(g, -100), r);
  assert.equal(clampDropX(g, 9999), WORLD.width - r);
  aim(g, 0);
  assert.equal(g.dropX, r);
});

test('drop locks input; settle re-enables it', () => {
  const { g, now } = playingGame();
  assert.ok(drop(g, 180));
  assert.equal(g.canDrop, false);
  assert.equal(drop(g, 180), false, 'locked while falling');
  sim(g, now, 3);
  assert.equal(g.canDrop, true, 'unlocked after settle');
});

test('two equal fruits merge at their midpoint into level+1 and score it', () => {
  const { g, now } = playingGame();
  const r = radiusOf(2);
  const a = makeBody(2, 100, WORLD.floorY - r);
  const b = makeBody(2, 100 + 2 * r - 0.5, WORLD.floorY - r);
  g.bodies.push(a, b);
  tick(g, 1 / 240);
  assert.equal(g.bodies.length, 1, 'both destroyed, one born');
  const born = g.bodies[0];
  assert.equal(born.level, 3);
  assert.ok(Math.abs(born.x - (a.x + b.x) / 2) < 6, 'near the contact midpoint');
  assert.equal(g.score, scoreOf(3));
  assert.ok(g.events.some((e) => e.type === 'merge' && e.level === 3));
});

test('chain reaction: a newborn immediately merges with its own level', () => {
  const { g } = playingGame();
  const r2 = radiusOf(2), r3 = radiusOf(3);
  // two grapes-to-be touching, with a level-3 waiting exactly where the
  // newborn appears
  g.bodies.push(
    makeBody(2, 200, WORLD.floorY - r2),
    makeBody(2, 200 + 2 * r2 - 0.5, WORLD.floorY - r2),
    makeBody(3, 200 + r2, WORLD.floorY - r2),   // overlaps the merge midpoint
  );
  tick(g, 1 / 240);
  assert.equal(g.bodies.length, 1, 'chained into a single fruit');
  assert.equal(g.bodies[0].level, 4);
  assert.equal(g.score, scoreOf(3) + scoreOf(4), 'both merges scored');
  const chainEv = g.events.filter((e) => e.type === 'merge');
  assert.equal(chainEv.length, 2);
  assert.equal(g.tally.chainBest, 2);
});

test('two watermelons annihilate: no fruit remains, max points awarded', () => {
  const { g } = playingGame();
  const r = radiusOf(11);
  g.bodies.push(
    makeBody(11, 100, WORLD.floorY - r),
    makeBody(11, 100 + 2 * r - 0.5, WORLD.floorY - r),
  );
  tick(g, 1 / 240);
  assert.equal(g.bodies.length, 0);
  assert.equal(g.score, ANNIHILATE_SCORE);
  assert.equal(g.tally.annihilations, 1);
  assert.ok(g.events.some((e) => e.type === 'annihilate'));
});

test('game over: a settled fruit above the line for 3 continuous seconds', () => {
  const { g, now } = playingGame();
  const r = radiusOf(3);
  const b = makeBody(3, 180, WORLD.deadlineY - 5);   // top above the line
  b.touched = true;
  b.vy = 0;
  // pin it there: no gravity fight — just hold and tick the clock
  g.bodies.push(b);
  for (let i = 0; i < 40; i++) {
    b.y = WORLD.deadlineY - 5; b.vy = 0; b.vx = 0;
    tick(g, 1 / 240);
    now.advance(100);
    if (g.state === 'over') break;
  }
  assert.equal(g.state, 'over');
  assert.ok(g.events.some((e) => e.type === 'gameover'));
});

test('a transient bounce above the line does NOT end the game', () => {
  const { g, now } = playingGame();
  const r = radiusOf(3);
  const b = makeBody(3, 180, WORLD.deadlineY - 5);
  b.touched = true;
  g.bodies.push(b);
  // over the line briefly...
  tick(g, 1 / 240); now.advance(800);
  tick(g, 1 / 240);
  // ...then back below
  b.y = WORLD.deadlineY + b.r + 40;
  tick(g, 1 / 240); now.advance(4000);
  // over again — the continuity clock must have reset
  b.y = WORLD.deadlineY - 5;
  tick(g, 1 / 240); now.advance(1000);
  tick(g, 1 / 240);
  assert.equal(g.state, 'playing');
});

test('an untouched (still falling) fruit cannot trip the deadline', () => {
  const { g, now } = playingGame();
  const b = makeBody(3, 180, 20);   // spawned above the line, falling
  g.bodies.push(b);
  // freeze it above the line without contact for 4 s of clock
  for (let i = 0; i < 5; i++) {
    b.y = 20; b.vy = 0; b.touched = false;
    tick(g, 1 / 240);
    now.advance(1000);
  }
  assert.equal(g.state, 'playing');
});

test('save round-trip: board, queue, score, and rng sequence survive', () => {
  const { g, now } = playingGame(1234);
  drop(g, 100); sim(g, now, 1.6);
  drop(g, 250); sim(g, now, 1.6);
  const save = serialize(g);
  assert.ok(save && save.fruits.length >= 1);

  const g2 = makeGame({ rng: makeRng(0), now: makeClock() });
  assert.ok(restore(g2, save));
  assert.equal(g2.score, g.score);
  assert.equal(g2.current, g.current);
  assert.equal(g2.next, g.next);
  assert.equal(g2.bodies.length, g.bodies.length);
  // future spawns continue the same sequence
  const seq1 = [g.rng.int(1, 5), g.rng.int(1, 5), g.rng.int(1, 5)];
  const seq2 = [g2.rng.int(1, 5), g2.rng.int(1, 5), g2.rng.int(1, 5)];
  assert.deepEqual(seq2, seq1);
});

test('restore rejects hostile or malformed saves', () => {
  const now = makeClock();
  const g = makeGame({ rng: makeRng(1), now });
  assert.equal(restore(g, null), false);
  assert.equal(restore(g, { v: 9 }), false);
  assert.equal(restore(g, { v: 1, current: 1, next: 1, fruits: [[99, 10, 10]] }), false, 'level out of range');
  assert.equal(restore(g, { v: 1, current: 8, next: 1, fruits: [] }), false, 'unspawnable held level');
  assert.equal(restore(g, { v: 1, current: 1, next: 1, fruits: [[3, NaN, 10]] }), false, 'NaN position');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, start, drop, tick, aim, serialize, restore, clampDropX } from '../js/game.js';
import { makeBody, settled } from '../js/physics.js';
import { WORLD, RULES, PHYS, radiusOf, scoreOf, ANNIHILATE_SCORE, MAX_SPAWN_LEVEL } from '../js/constants.js';
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

test('drop locks input; a fixed cooldown re-enables it', () => {
  const { g, now } = playingGame();
  assert.ok(drop(g, 180));
  assert.equal(g.canDrop, false);
  assert.equal(drop(g, 180), false, 'locked immediately after the drop');

  // just shy of the cooldown: still locked, even though the fruit is airborne
  sim(g, now, (RULES.dropCooldownMs - 20) / 1000);
  assert.equal(g.canDrop, false, `still locked at ${RULES.dropCooldownMs - 20}ms`);

  sim(g, now, 0.05);
  assert.equal(g.canDrop, true, 'unlocked once the cooldown elapses');
  assert.equal(g.lockedAt, null);
});

test('the cooldown does NOT wait for the pile to settle', () => {
  const { g, now } = playingGame();
  // a deliberately unsettled board: a fruit flung across the box
  const flyer = makeBody(2, 60, 200);
  flyer.vx = 900; flyer.vy = -400;
  g.bodies.push(flyer);
  drop(g, 180);
  sim(g, now, (RULES.dropCooldownMs + 20) / 1000);
  assert.equal(settled(g.bodies), false, 'board is still very much in motion');
  assert.equal(g.canDrop, true, 'input is free anyway');
});

test('aiming is never blocked by the input lock', () => {
  const { g } = playingGame();
  drop(g, 180);
  assert.equal(g.canDrop, false);
  aim(g, 60);
  assert.ok(Math.abs(g.dropX - 60) < 1e-9, 'aim still moves while locked');
});

test('drops can be repeated at the cooldown cadence', () => {
  const { g, now } = playingGame();
  const step = RULES.dropCooldownMs / 1000;
  let dropped = 0;
  for (let i = 0; i < 6; i++) {
    if (drop(g, 40 + i * 12)) dropped++;
    sim(g, now, step + 0.01);
  }
  assert.equal(dropped, 6, 'every attempt at the cadence lands');
  assert.equal(g.bodies.length > 0, true);
});

test('stacking over the line still ends the game while dropping at full speed', () => {
  const { g, now } = playingGame();
  // A pile the player has already stacked past the line: alternating levels so
  // nothing in it can merge its way back to safety.
  const X = WORLD.width / 2;
  let y = WORLD.floorY;
  for (const level of [7, 8, 7, 8, 7]) {
    const r = radiusOf(level);
    y -= r;
    const b = makeBody(level, X, y);
    b.touched = true;
    g.bodies.push(b);
    y -= r;
  }
  const top = g.bodies.at(-1);
  assert.ok(top.y - top.r < WORLD.deadlineY, 'the pile really is over the line');

  // Now keep dropping into the far corner as fast as the cooldown allows. The
  // deadline clock is independent of the input lock and must still run out.
  let drops = 0;
  for (let i = 0; i < 200 && g.state === 'playing'; i++) {
    g.current = 1;
    if (g.canDrop && drop(g, 20)) drops++;
    sim(g, now, 0.05);
  }
  assert.equal(g.state, 'over', 'the line still claims the pile');
  assert.ok(g.events.some((e) => e.type === 'gameover'));
  assert.ok(drops >= 5, `the player was dropping throughout (${drops} drops)`);
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

test('the merge event names the newborn body, so juice can key off it', () => {
  const { g } = playingGame();
  const r = radiusOf(2);
  g.bodies.push(
    makeBody(2, 100, WORLD.floorY - r),
    makeBody(2, 100 + 2 * r - 0.5, WORLD.floorY - r),
  );
  tick(g, 1 / 240);
  const ev = g.events.find((e) => e.type === 'merge');
  assert.ok(ev, 'merge event emitted');
  assert.equal(ev.id, g.bodies[0].id, 'event id is the surviving newborn');
});

test('a hard landing emits a bounce event, rate-limited per body', () => {
  const { g, now } = playingGame();
  const b = makeBody(1, 180, WORLD.floorY - radiusOf(1) - 2);
  b.vy = PHYS.impactSpeed * 4;
  g.bodies.push(b);

  tick(g, 1 / 240);
  const first = g.events.filter((e) => e.type === 'bounce');
  assert.equal(first.length, 1);
  assert.equal(first[0].id, b.id);
  assert.equal(first[0].level, 1);
  assert.ok(first[0].speed >= PHYS.impactSpeed);
  g.events.length = 0;

  // hit it again inside the rate-limit window: silent
  b.y = WORLD.floorY - b.r - 2; b.vy = PHYS.impactSpeed * 4;
  now.advance(RULES.impactEventMs - 20);
  tick(g, 1 / 240);
  assert.equal(g.events.filter((e) => e.type === 'bounce').length, 0, 'rate-limited');

  // and again once the window has passed: heard
  b.y = WORLD.floorY - b.r - 2; b.vy = PHYS.impactSpeed * 4;
  now.advance(RULES.impactEventMs + 20);
  tick(g, 1 / 240);
  assert.equal(g.events.filter((e) => e.type === 'bounce').length, 1, 'audible again');
});

test('a settling pile does not spray bounce events', () => {
  const { g, now } = playingGame();
  for (let i = 0; i < 6; i++) g.bodies.push(makeBody(1 + (i % 3), 50 + i * 45, 200 - i * 15));
  sim(g, now, 4);
  const perBody = new Map();
  for (const e of g.events.filter((e) => e.type === 'bounce')) {
    perBody.set(e.id, (perBody.get(e.id) || 0) + 1);
  }
  // 4 s at a 150 ms floor is ~26 events worst case; anything near that means
  // the limiter is off. Real settling should be a small handful per fruit.
  for (const [id, n] of perBody) assert.ok(n <= 12, `body ${id} emitted ${n} bounce events`);
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

test('tally.bestLevel follows the biggest fruit the game ever held', () => {
  const { g } = playingGame();
  assert.equal(g.tally.bestLevel, 0, 'nothing held yet');

  g.current = 4;
  drop(g, 100);
  assert.equal(g.tally.bestLevel, 4, 'the dropper counts — you held a dekopon');

  // …and a merge that outgrows it moves it on
  const r = radiusOf(6);
  g.bodies.push(
    makeBody(6, 250, WORLD.floorY - r),
    makeBody(6, 250 + 2 * r - 0.5, WORLD.floorY - r),
  );
  tick(g, 1 / 240);
  assert.equal(g.bodies.some((b) => b.level === 7), true);
  assert.equal(g.tally.bestLevel, 7);

  // a smaller drop afterwards must not walk it back
  g.current = 1;
  g.canDrop = true;
  drop(g, 40);
  assert.equal(g.tally.bestLevel, 7);
});

test('bestLevel survives the save round-trip', () => {
  const { g, now } = playingGame(99);
  g.current = 5;
  drop(g, 120); sim(g, now, 1.2);
  assert.equal(g.tally.bestLevel, 5);

  const g2 = makeGame({ rng: makeRng(0), now: makeClock() });
  assert.ok(restore(g2, serialize(g)));
  assert.equal(g2.tally.bestLevel, 5);
});

test('a save written before bestLevel existed recovers it from the board', () => {
  const now = makeClock();
  const g = makeGame({ rng: makeRng(3), now });
  // an old save: tally without the field at all (the version stays 1)
  assert.ok(restore(g, {
    v: 1, score: 300, current: 2, next: 3,
    tally: { merges: 9, watermelons: 0, annihilations: 0, chainBest: 2 },
    fruits: [[3, 100, 400], [8, 200, 480], [5, 300, 500]],
  }));
  assert.equal(g.tally.bestLevel, 8, 'the peach on the counter is proof');
  assert.equal(g.tally.merges, 9, 'the fields that were there are kept');
});

test('restore refuses to take a nonsense bestLevel from a save', () => {
  const now = makeClock();
  const g = makeGame({ rng: makeRng(3), now });
  for (const bad of [999, -5, 'watermelon', 4.5, null]) {
    assert.ok(restore(g, {
      v: 1, score: 0, current: 1, next: 1,
      tally: { bestLevel: bad },
      fruits: [[6, 100, 400]],
    }));
    assert.equal(g.tally.bestLevel, 6, `bestLevel ${JSON.stringify(bad)} fell back to the board`);
  }
});

test('a bestLevel above everything on the board is kept — annihilation earns it', () => {
  const now = makeClock();
  const g = makeGame({ rng: makeRng(3), now });
  // two watermelons wiped each other out; the board is small again, but an
  // 11 was unquestionably reached
  assert.ok(restore(g, {
    v: 1, score: 2048, current: 1, next: 2,
    tally: { merges: 40, watermelons: 2, annihilations: 1, chainBest: 3, bestLevel: 11 },
    fruits: [[3, 100, 500], [2, 200, 520]],
  }));
  assert.equal(g.tally.bestLevel, 11);
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

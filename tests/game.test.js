import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeGame, start, drop, tick, aim, serialize, restore, clampDropX,
  finish, isSoldOut, isSettled, setStock, QUEUE_DEPTH,
} from '../js/game.js';
import { makeBody, settled } from '../js/physics.js';
import { WORLD, RULES, PHYS, radiusOf, scoreOf, ANNIHILATE_SCORE, MAX_LEVEL, MAX_SPAWN_LEVEL } from '../js/constants.js';
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
  assert.deepEqual(chainEv.map((e) => e.chain), [1, 2], 'the same-tick cascade counts as it always did');
  assert.equal(g.tally.chainBest, 2);
});

// ── the combo window ───────────────────────────────────────────────────────
// A chain used to be a run of merges inside ONE physics tick — 4ms of sim, so
// only a newborn born already overlapping its next partner ever counted. The
// cascade the player watches happen (a merge pops, the pile shifts, two pears
// roll together half a second later) was credited as a row of 1-chains. The
// window is now wall time, and these pin what that means.

// One merge, right now, wherever it is put. Clears the board first so the
// newborn of the last one can never be a party to the next.
function forceMerge(g, level, x = 180) {
  const r = radiusOf(level);
  g.bodies = [
    makeBody(level, x, WORLD.floorY - r),
    makeBody(level, x + 2 * r - 0.5, WORLD.floorY - r),
  ];
  tick(g, 1 / 240);
}

function chainsOf(g) {
  return g.events.filter((e) => e.type === 'merge').map((e) => e.chain);
}

test('a merge the pile settles into a second later is the same combo', () => {
  const { g, now } = playingGame();
  forceMerge(g, 2);
  now.advance(RULES.chainWindowMs - 200);
  forceMerge(g, 2);
  assert.deepEqual(chainsOf(g), [1, 2], 'the second merge fell out of the combo');
  assert.equal(g.tally.chainBest, 2);
});

test('two deliberate merges, well apart, never chain', () => {
  const { g, now } = playingGame();
  forceMerge(g, 2);
  now.advance(RULES.chainWindowMs + 1);
  forceMerge(g, 2);
  now.advance(RULES.chainWindowMs * 2);
  forceMerge(g, 2);
  assert.deepEqual(chainsOf(g), [1, 1, 1], 'unrelated merges were credited as a combo');
  assert.equal(g.tally.chainBest, 1);
});

// The window is measured from the PREVIOUS merge, not from the start of the
// combo — which is what lets a long cascade keep going as long as it keeps
// producing, and is the whole reason a chain can outlive a drop.
test('a combo deepens across drops as long as merges keep landing', () => {
  const { g, now } = playingGame();
  for (let i = 0; i < 5; i++) {
    forceMerge(g, 2);
    now.advance(RULES.chainWindowMs - 100);
  }
  assert.deepEqual(chainsOf(g), [1, 2, 3, 4, 5]);
  assert.equal(g.tally.chainBest, 5);

  // …and it ends the moment the pile goes quiet for long enough
  now.advance(RULES.chainWindowMs);
  forceMerge(g, 2);
  assert.equal(g.events.filter((e) => e.type === 'merge').pop().chain, 1);
  assert.equal(g.tally.chainBest, 5, 'a fresh combo walked the record back');
});

// chainBest is banked per merge now, because a windowed combo can still be in
// flight when the tick — and the frame, and the batch the host drains — ends.
// Banking it at the end of the tick lost every chain that spanned two.
test('chainBest counts the deepest combo, not the deepest single tick', () => {
  const { g, now } = playingGame();
  forceMerge(g, 3);
  now.advance(500);
  forceMerge(g, 3);
  now.advance(500);
  forceMerge(g, 3);
  assert.equal(g.tally.chainBest, 3, 'three merges over a second were three 1-chains');
});

test('a restored run keeps its record and forfeits the combo it was mid-way through', () => {
  const { g, now } = playingGame();
  forceMerge(g, 2);
  now.advance(200);
  forceMerge(g, 2);
  assert.equal(g.chainDepth, 2);
  const save = serialize(g);
  assert.equal(save.lastMergeAt, undefined, 'a performance.now() reading was written to storage');

  const later = makeClock();
  const g2 = makeGame({ rng: makeRng(0), now: later });
  assert.ok(restore(g2, save));
  assert.equal(g2.chainDepth, 0, 'the combo came back from the dead');
  assert.equal(g2.lastMergeAt, null);
  assert.equal(g2.tally.chainBest, 2, 'the deep chain still happened');

  // the next merge starts over, however soon it lands
  forceMerge(g2, 2);
  assert.equal(chainsOf(g2).pop(), 1);
});

test('the annihilation carries its combo depth like any other merge', () => {
  const { g, now } = playingGame();
  forceMerge(g, 2);
  now.advance(300);
  forceMerge(g, MAX_LEVEL, 90);
  const blown = g.events.filter((e) => e.type === 'annihilate');
  assert.equal(blown.length, 1);
  assert.equal(blown[0].chain, 2, 'the biggest thing the board can do dropped out of the combo');
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

// ── the injectable spawn source (campaign) ─────────────────────────────────
//
// Free play draws forever from the rng; the campaign draws from a finite crate
// that may hold anything up to a watermelon. The seam between them is one
// injected function, and the first thing it must prove is that it changed
// nothing at all for the mode that was already shipping.

test('REGRESSION: the default spawn sequence is byte-identical to the rng dropper', () => {
  // What the dropper produced before drawFruit existed: rng.int(1,5), forever,
  // and one fruit per drop in that order. Pinned against the raw generator
  // rather than against a recorded list, so it holds for any seed.
  //
  // The PREVIEW got deeper — the queue draws five ahead instead of one — but the
  // stream is the same stream and it reaches the player's hand in the same
  // order, which is the thing a player would notice.
  for (const seed of [1, 42, 1234, 0xC0FFEE]) {
    const oracle = makeRng(seed);
    const expected = Array.from({ length: 60 }, () => oracle.int(1, MAX_SPAWN_LEVEL));

    const g = makeGame({ rng: makeRng(seed), now: makeClock() });
    g.state = 'playing';               // start() re-rolls; this pins makeGame's own priming
    const seen = [g.current, g.next];
    for (let i = 0; i < 58; i++) {
      g.canDrop = true;
      drop(g);
      g.bodies.length = 0;
      seen.push(g.next);
    }
    assert.deepEqual(seen, expected, `spawn sequence drifted for seed ${seed}`);
  }
});

test('the preview is five deep, and it is the front of the same sequence', () => {
  const oracle = makeRng(99);
  const expected = Array.from({ length: QUEUE_DEPTH + 1 }, () => oracle.int(1, MAX_SPAWN_LEVEL));
  const g = makeGame({ rng: makeRng(99), now: makeClock() });
  assert.equal(g.queue.length, QUEUE_DEPTH, 'an endless board did not fill its preview');
  assert.deepEqual([g.current, ...g.queue], expected);
  assert.equal(g.next, g.queue[0], 'next is not the head of the queue');
});

test('REGRESSION: start() re-rolls from the rng exactly as it always did', () => {
  const oracle = makeRng(77);
  // makeGame's own priming: the hand, then the whole preview behind it
  for (let i = 0; i <= QUEUE_DEPTH; i++) oracle.int(1, MAX_SPAWN_LEVEL);
  const g = makeGame({ rng: makeRng(77), now: makeClock() });
  start(g);
  assert.equal(g.current, oracle.int(1, MAX_SPAWN_LEVEL));
  assert.equal(g.next, oracle.int(1, MAX_SPAWN_LEVEL));
});

// A crate-backed draw: hands out `stock` in order, then null forever.
//
// `crated` is declared, not inferred from the injected dropper. Being fed by
// something other than the rng and running OUT are two different facts, and a
// friend's stall (js/friends.js) is the first thing to be the one without being
// the other — an infinite sky, weighted differently.
function cratedGame(stock) {
  const left = stock.slice();
  const now = makeClock();
  const g = makeGame({
    rng: makeRng(5), now, crated: true,
    drawFruit: () => (left.length ? left.shift() : null),
  });
  assert.equal(g.current, null, 'a crated game tipped fruit out before it opened');
  start(g);
  g.events.length = 0;
  return { g, now, left };
}

// An injected dropper WITHOUT a crate: the friend's-stall case. It primes its
// dropper like any endless board, and stays as strict as free play about what a
// save may put in its hands.
test('an injected dropper is not by itself a crate', () => {
  const g = makeGame({ rng: makeRng(5), now: makeClock(), drawFruit: () => 3 });
  assert.equal(g.crated, false, 'a weighted dropper was mistaken for a finite harvest');
  assert.equal(g.current, 3, 'an endless board did not prime its dropper');
  assert.equal(g.next, 3);

  // free play's own bound, unchanged: a watermelon in the hand never happened
  assert.equal(restore(g, {
    v: 1, score: 0, current: MAX_LEVEL, next: 1, fruits: [],
  }), false, 'a friend\'s stall accepted a fruit it could never spawn');
  assert.equal(restore(g, {
    v: 1, score: 0, current: null, next: null, fruits: [],
  }), false, 'a friend\'s stall accepted the empty hand only a crate can have');
});

test('a crate feeds the dropper instead of the rng, and empties exactly', () => {
  const { g, now } = cratedGame([1, 2, 3, 4]);
  assert.equal(g.current, 1);
  assert.equal(g.next, 2);
  assert.ok(drop(g, 100)); sim(g, now, 0.6);
  assert.equal(g.current, 2);
  assert.equal(g.next, 3);
  assert.equal(g.bodies.length, 1);
  assert.equal(g.bodies[0].level, 1, 'the crate handed over a different fruit than it promised');
});

test('the preview empties first, then the dropper, then the stall is sold out', () => {
  const { g, now } = cratedGame([1, 2, 3]);
  assert.ok(!isSoldOut(g));

  drop(g, 100); sim(g, now, 0.6);        // holds 2, previews 3
  assert.equal(g.next, 3);
  drop(g, 150); sim(g, now, 0.6);        // holds 3, previews nothing
  assert.equal(g.current, 3);
  assert.equal(g.next, null);
  assert.ok(!isSoldOut(g), 'sold out with a fruit still in hand');

  drop(g, 200); sim(g, now, 0.6);        // both hands empty
  assert.equal(g.current, null);
  assert.equal(g.next, null);
  assert.ok(isSoldOut(g));
  assert.equal(g.bodies.length, 3, 'every crated fruit should have reached the board');
});

test('an empty dropper drops nothing and aims without throwing', () => {
  const { g, now } = cratedGame([1]);
  drop(g, 100); sim(g, now, 0.6);
  assert.ok(isSoldOut(g));
  assert.equal(drop(g, 180), false, 'dropped a fruit that does not exist');
  assert.equal(g.bodies.length, 1);
  aim(g, 9999);
  assert.equal(g.dropX, WORLD.width, 'an empty hand clamps to the bare wall');
  assert.equal(clampDropX(g, -50), 0);
  assert.equal(g.state, 'playing', 'running out of fruit is not itself the end of the run');
});

test('a crate of big fruit clamps to the walls by what is actually held', () => {
  const { g } = cratedGame([11, 1]);
  const r = radiusOf(11);
  assert.equal(clampDropX(g, -100), r);
  assert.equal(clampDropX(g, 9999), WORLD.width - r);
  assert.ok(r * 2 < WORLD.width, 'a watermelon that cannot be dropped at all is a bug, not a risk');
});

// A friend's stall: a crate that runs out, holding only what a sky can send
// down. It is `finite` WITHOUT being `crated`, which is the combination that
// used to be unreachable — and the one that must not quietly inherit the
// campaign's looser rule about what may sit in the dropper.
test('a finite stall runs out like a crate and stays as strict as free play', () => {
  const left = [3, 4, 5];
  const g = makeGame({
    rng: makeRng(5), now: makeClock(), finite: true,
    drawFruit: () => (left.length ? left.shift() : null),
  });
  assert.equal(g.crated, false, "a friend's morning was mistaken for a campaign harvest");
  assert.equal(g.current, null, 'a finite stall tipped its crate out before it opened');

  start(g);
  assert.equal(g.current, 3);
  assert.deepEqual(g.queue, [4, 5], 'the preview did not take what was left');

  // the empty hand a crate can have…
  assert.ok(restore(g, { v: 1, score: 0, current: null, next: null, fruits: [] }),
    'a finite stall refused the empty hand it can genuinely reach');
  // …and free play's own bound, untouched: a watermelon in the hand never
  // happened on a board stocked out of the sky.
  assert.equal(restore(g, { v: 1, score: 0, current: MAX_LEVEL, next: 1, fruits: [] }), false,
    "a friend's stall accepted a fruit it could never spawn");
});

test('setStock re-points the dropper without touching the board', () => {
  const { g, now } = playingGame();
  drop(g, 100); sim(g, now, 0.6);
  const onBoard = g.bodies.length;

  const left = [2, 2];
  setStock(g, { draw: () => (left.length ? left.shift() : null), finite: true });
  assert.equal(g.bodies.length, onBoard, 'restocking swept the counter');
  assert.ok(g.finite, 'the new stock did not bring its own ending with it');
  start(g);
  assert.equal(g.current, 2);
  assert.deepEqual(g.queue, [2]);

  setStock(g, { draw: () => 1 });
  start(g);
  assert.equal(g.queue.length, QUEUE_DEPTH, 'an endless restock still ran out');
  assert.equal(g.finite, false);
});

// A whole preview out of a finite crate is in the player's hands the moment the
// stall opens. A save that forgot them would eat QUEUE_DEPTH of the harvest per
// suspend, which is real money in the campaign.
test('the whole preview survives a save, and a shallow save fills back up', () => {
  // one for the hand, then one per queue slot, drawn in order
  const drawn = Array.from({ length: QUEUE_DEPTH + 1 }, (_, i) => i + 1);
  const left = [...drawn];
  const queued = drawn.slice(1);
  const g = makeGame({
    rng: makeRng(5), now: makeClock(), crated: true,
    drawFruit: () => (left.length ? left.shift() : null),
  });
  start(g);
  const save = serialize(g);
  assert.deepEqual(save.queue, queued);
  assert.equal(save.next, queued[0], 'the head of the queue is still called next on disk');

  const g2 = makeGame({ rng: makeRng(5), now: makeClock(), crated: true, drawFruit: () => null });
  assert.ok(restore(g2, save));
  assert.deepEqual(g2.queue, queued, 'the preview was dropped on the floor');

  // a board written before the preview went deep carries only `next`
  const shallow = { v: 1, score: 0, current: 1, next: 2, fruits: [], rngState: 3 };
  const g3 = makeGame({ rng: makeRng(5), now: makeClock(), drawFruit: () => 4 });
  assert.ok(restore(g3, shallow));
  assert.deepEqual(g3.queue, [2, ...Array(QUEUE_DEPTH - 1).fill(4)],
    'an old save did not fill its new preview');
});

test('a hole in the preview is refused, not repaired', () => {
  const g = makeGame({ rng: makeRng(5), now: makeClock(), drawFruit: () => 1 });
  const board = { v: 1, score: 0, current: 1, next: 1, fruits: [] };
  const tooDeep = Array(QUEUE_DEPTH + 1).fill(1);
  for (const queue of [[1, null, 2], [1, 99], [1, 0], tooDeep, [1, 1.5]]) {
    assert.equal(restore(g, { ...board, queue }), false,
      `a preview of ${JSON.stringify(queue)} was believed`);
  }
  assert.equal(restore(g, { ...board, current: null, next: null, queue: [1] }), false,
    'a save queued fruit behind an empty hand');
});

test('the board settles, and isSettled says so', () => {
  const { g, now } = cratedGame([1, 1]);
  drop(g, 100);
  sim(g, now, 0.1);
  assert.ok(!isSettled(g), 'a fruit in mid-air is not settled');
  sim(g, now, 4);
  assert.ok(isSettled(g));
});

// ── endings ────────────────────────────────────────────────────────────────

test('every ending names itself on the gameover event', () => {
  for (const reason of ['packed', 'sold-out']) {
    const { g } = cratedGame([1, 2]);
    assert.ok(finish(g, reason));
    assert.equal(g.state, 'over');
    const over = g.events.filter((e) => e.type === 'gameover');
    assert.equal(over.length, 1);
    assert.equal(over[0].reason, reason);
    assert.equal(over[0].score, g.score);
  }
});

test('toppling still ends the run, and still calls itself toppled', () => {
  const { g, now } = playingGame();
  const b = makeBody(3, 180, WORLD.deadlineY - 5);   // top above the line
  b.touched = true;
  g.bodies.push(b);
  for (let i = 0; i < 40 && g.state === 'playing'; i++) {
    b.y = WORLD.deadlineY - 5; b.vx = 0; b.vy = 0;   // pin it there
    tick(g, 1 / 240);
    now.advance(100);
  }
  assert.equal(g.state, 'over');
  const over = g.events.filter((e) => e.type === 'gameover');
  assert.equal(over.length, 1);
  assert.equal(over[0].reason, 'toppled', 'the free-play ending changed its name');
});

test('finish() defaults to toppled, and the stall can only close once', () => {
  const { g } = playingGame();
  assert.ok(finish(g));
  assert.equal(g.events.filter((e) => e.type === 'gameover')[0].reason, 'toppled');
  assert.equal(finish(g, 'packed'), false, 'the stall closed twice');
  assert.equal(g.events.filter((e) => e.type === 'gameover').length, 1);
  assert.equal(finish(makeGame({ rng: makeRng(1), now: makeClock() }), 'packed'), false,
    'a game that never started cannot end');
});

test('finish() mid-fall keeps the falling fruit on the board for the appraisal', () => {
  const { g, now } = cratedGame([5, 5, 5]);
  drop(g, 180);
  sim(g, now, 0.1);                       // still in the air
  assert.ok(finish(g, 'packed'));
  assert.equal(g.bodies.length, 1, 'the fruit in flight was lost');
  sim(g, now, 2);
  assert.equal(g.bodies.length, 1, 'a finished game kept simulating');
});

// ── crated saves ───────────────────────────────────────────────────────────

test('a crated board saves and restores its big fruit and its empty hands', () => {
  const { g, now } = cratedGame([11, 9, 7]);
  drop(g, 180); sim(g, now, 2);
  const save = serialize(g);
  assert.equal(save.current, 9);

  const g2 = makeGame({ rng: makeRng(0), now: makeClock(), crated: true, drawFruit: () => null });
  assert.ok(restore(g2, save), 'a campaign board would not restore');
  assert.equal(g2.current, 9);
  assert.equal(g2.next, 7);
  assert.equal(g2.bodies[0].level, 11);

  // …and the sold-out end state round-trips too
  const { g: g3, now: n3 } = cratedGame([1]);
  drop(g3, 100); sim(g3, n3, 1);
  const g4 = makeGame({ rng: makeRng(0), now: makeClock(), crated: true, drawFruit: () => null });
  assert.ok(restore(g4, serialize(g3)));
  assert.ok(isSoldOut(g4));
});

test('free play stays exactly as strict about a save as it always was', () => {
  const now = makeClock();
  const free = makeGame({ rng: makeRng(1), now });
  const crated = makeGame({ rng: makeRng(1), now, crated: true, drawFruit: () => 1 });

  // a level free play could never have spawned
  const big = { v: 1, current: 11, next: 1, fruits: [] };
  assert.equal(restore(free, big), false, 'free play accepted a watermelon in the dropper');
  assert.equal(restore(crated, big), true);

  // an empty hand is meaningless without a crate behind it
  const empty = { v: 1, current: null, next: null, fruits: [] };
  assert.equal(restore(free, empty), false, 'free play accepted an empty dropper');
  assert.equal(restore(crated, empty), true);

  // and the hands must empty in order, in either mode
  assert.equal(restore(crated, { v: 1, current: null, next: 3, fruits: [] }), false,
    'a save emptied the dropper before the preview');
});

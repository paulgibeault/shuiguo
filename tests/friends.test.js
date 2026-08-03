// The cast, and the two things about it that are rules rather than taste: a
// friend's stall is stocked by a weighted draw, and only an evenly-stocked one
// is comparable with anybody else's.
//
// The load-bearing claim here is the first test. 草莓's stall must be the
// dropper free play has always had — not a re-implementation that agrees on
// average, the same sequence out of the same generator — or every free-play
// save ever written continues into a different game than the one it left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_FRIEND, STALLS, friendOf, stallOf, stallName, stallAlt, openFriends,
  isFriendOpen, isBalanced, isEndless, isRanked, crateSizeOf, stockCrate, weightedDraw,
  restockMsOf, makeStallClock, noteStallSold, msUntilRestock, isStocked,
  packStallClock, unpackStallClock,
} from '../js/friends.js';
import { FRIENDS, WHOLESALER, MAX_SPAWN_LEVEL } from '../js/constants.js';
import { makeCampaign, noteMerges, makeRunTally } from '../js/campaign.js';
import { totalCount, levelsIn, countOf } from '../js/counts.js';
import { makeRng } from '../js/arcade-rng.js';

test('an evenly stocked stall IS free play\'s dropper, draw for draw', () => {
  const oracle = makeRng(2024);
  const weighted = makeRng(2024);
  for (let i = 0; i < 500; i++) {
    assert.equal(
      weightedDraw(FIRST_FRIEND.weights, weighted),
      oracle.int(1, MAX_SPAWN_LEVEL),
      `the streams parted at draw ${i} — every free-play save resumes into a different game`,
    );
  }
});

test('every draw is a level that can actually spawn', () => {
  const rng = makeRng(11);
  for (const f of FRIENDS) {
    for (let i = 0; i < 300; i++) {
      const level = weightedDraw(f.weights, rng);
      assert.ok(Number.isInteger(level) && level >= 1 && level <= MAX_SPAWN_LEVEL,
        `a stall sent down ${level}`);
    }
  }
});

// The whole mechanical difference between the friends. Asserted as ORDER, not
// as exact proportions: the point is that 葡萄 rains small fruit and 苹果 sends
// down big ones, and the table is free to be retuned without breaking this.
test('a stall sends down what its weights say, and nothing a zero forbids', () => {
  const counts = (weights, n) => {
    const rng = makeRng(7);
    const seen = new Array(MAX_SPAWN_LEVEL).fill(0);
    for (let i = 0; i < n; i++) seen[weightedDraw(weights, rng) - 1]++;
    return seen;
  };

  const even = counts(FIRST_FRIEND.weights, 20000);
  for (const n of even) assert.ok(Math.abs(n - 4000) < 400, `an even stall drew ${even}`);

  const cozy = counts(FRIENDS[1].weights, 20000);   // 葡萄 — [3, 3, 2, 1, 0]
  assert.equal(cozy[4], 0, 'a zero weight sent one down anyway');
  assert.ok(cozy[0] > cozy[2] && cozy[2] > cozy[3], `the cozy stall drew ${cozy}`);

  const risky = counts(FRIENDS[2].weights, 20000);  // 苹果 — [0, 1, 1, 2, 3]
  assert.equal(risky[0], 0, 'a zero weight sent one down anyway');
  assert.ok(risky[4] > risky[3] && risky[3] > risky[1], `the risky stall drew ${risky}`);
});

// A stall with nothing in it at all is a stall nobody can play. Whatever the
// weights are, the sky has to send something down.
test('hostile weights fall back to an even spread rather than an empty sky', () => {
  const rng = makeRng(3);
  const junk = [
    [0, 0, 0, 0, 0], [], null, undefined, 'lots',
    [-3, -1, 0, 0, 0], [NaN, NaN, NaN, NaN, NaN], [1.5, 0.2, 0, 0, 0],
    [Infinity, 0, 0, 0, 0], { 0: 5 },
  ];
  for (const weights of junk) {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const level = weightedDraw(weights, rng);
      assert.ok(level >= 1 && level <= MAX_SPAWN_LEVEL, `${JSON.stringify(weights)} drew ${level}`);
      seen.add(level);
    }
    assert.equal(seen.size, MAX_SPAWN_LEVEL, `${JSON.stringify(weights)} did not fall back to even`);
  }
});

// [1, 2] is short but not junk — the levels it does not mention weigh nothing,
// and it is a perfectly playable if lopsided stall.
test('a short weight list stocks the levels it names and no others', () => {
  const rng = makeRng(4);
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(weightedDraw([1, 2], rng));
  assert.deepEqual([...seen].sort(), [1, 2]);
});

// ── who is open, and who competes ──────────────────────────────────────────

// The first friend's stall is the endless stall this game has always had. It is
// open before there is a campaign at all — asking the seed drawer would be the
// wrong question, since the starter strawberries are held but not yet plantable.
test('草莓 is open from the very first launch, and the others are not', () => {
  const c = makeCampaign();
  assert.ok(isFriendOpen(null, FIRST_FRIEND), 'a player with no campaign found the stall shut');
  assert.deepEqual(openFriends(c), [FIRST_FRIEND], 'a fresh player met more than one grower');
  assert.ok(isFriendOpen(c, FRIENDS[0]));
  assert.ok(!isFriendOpen(c, FRIENDS[1]));
});

test('a stall opens when its seed is earned, and only a CAMPAIGN merge earns it', () => {
  const c = makeCampaign();
  // a campaign merge of a grape: the seed, and the grower behind it
  noteMerges(c, makeRunTally(), [{ type: 'merge', level: FRIENDS[1].level }]);
  assert.ok(isFriendOpen(c, FRIENDS[1]), '葡萄 stayed shut after their fruit was merged at market');
  assert.ok(!isFriendOpen(c, FRIENDS[2]), 'one unlock opened the whole cast');
  assert.equal(openFriends(c).length, 2);
});

test('an unknown stall is 草莓\'s, never nobody\'s', () => {
  for (const junk of [undefined, null, 0, 99, 'grape', 4.5, NaN]) {
    assert.equal(friendOf(junk), FIRST_FRIEND, `friendOf(${String(junk)}) found somebody else`);
  }
  assert.equal(friendOf(FRIENDS[2].level), FRIENDS[2]);
});

// The records gate, derived from the weights rather than from a flag — so a
// friend added to the table later cannot be let onto the leaderboard by a field
// nobody remembered to set.
test('only an evenly stocked stall counts as comparable', () => {
  assert.ok(isBalanced(FRIENDS[0]), '草莓\'s stall stopped being the comparable one');
  for (const f of FRIENDS.slice(1)) {
    assert.ok(!isBalanced(f), `${f.flavor} is being treated as comparable`);
  }
  assert.ok(isBalanced({ weights: [4, 4, 4, 4, 4] }), 'even is even at any scale');

  // The gate asks what the stall actually DROPS, not what its literal says.
  // A short list is a lopsided stall wearing an even-looking table: [1, 1, 1]
  // sends down three of the five levels, and its scores are comparable with
  // nothing — which is the whole reason the gate exists.
  assert.ok(!isBalanced({ weights: [1, 1, 1] }), 'a stall dropping 3 of 5 levels passed as balanced');
  // …and by the same token, weight past the last spawnable level is not a
  // lopsided stall, it is a table saying nothing. It still drops 1–5 evenly.
  assert.ok(isBalanced({ weights: [1, 1, 1, 1, 1, 1, 1] }), 'weight on a level nobody can spawn counted');

  // …and a stall nobody described is not one anybody vouched for, even though
  // the playability fallback happens to make it drop evenly.
  for (const junk of [{ weights: [0, 0, 0, 0, 0] }, {}, { weights: 'lots' }, null, undefined]) {
    assert.ok(!isBalanced(junk), `${JSON.stringify(junk)} passed as balanced`);
  }
});

// ── the morning's produce ──────────────────────────────────────────────────

test('a friend hands over exactly as much fruit as their table says', () => {
  const rng = makeRng(31);
  for (const f of FRIENDS) {
    const crate = stockCrate(f, rng);
    assert.equal(totalCount(crate), crateSizeOf(f), `${f.flavor} packed the wrong amount`);
    for (const level of levelsIn(crate)) {
      assert.ok(level >= 1 && level <= MAX_SPAWN_LEVEL, `a crate held a level ${level}`);
      assert.ok(f.weights[level - 1] > 0, `${f.flavor} packed a fruit their own table forbids`);
    }
  }
});

// A crate IS the stall: one morning of the sky that stall used to send down, so
// the flavour a player learned from the endless version is the flavour they get
// in the crate.
test('a crate is packed to the stall\'s own flavour', () => {
  const rng = makeRng(8);
  const cozy = stockCrate(FRIENDS[1], rng);          // 葡萄 — [3, 3, 2, 1, 0]
  assert.equal(countOf(cozy, 5), 0, 'a zero weight was packed anyway');
  assert.ok(countOf(cozy, 1) > countOf(cozy, 4), `the cozy crate came out ${JSON.stringify(cozy)}`);

  const risky = stockCrate(FRIENDS[2], rng);         // 苹果 — [0, 1, 1, 2, 3]
  assert.equal(countOf(risky, 1), 0, 'a zero weight was packed anyway');
  assert.ok(countOf(risky, 5) > countOf(risky, 2), `the risky crate came out ${JSON.stringify(risky)}`);
});

test('no two mornings are the same', () => {
  const rng = makeRng(12);
  const a = stockCrate(FRIENDS[0], rng);
  const b = stockCrate(FRIENDS[0], rng);
  assert.notDeepEqual(a, b, 'every visit hands over the identical crate');
});

test('the wholesaler is endless, and the endless stall has no crate to pack', () => {
  assert.ok(isEndless(WHOLESALER));
  assert.equal(stockCrate(WHOLESALER, makeRng(1)), null, 'an endless stall packed a crate');
  for (const f of FRIENDS) assert.ok(!isEndless(f), `${f.flavor} never runs out`);
});

// The leaderboard gate, and it takes BOTH: an even sky and no cap on it. Asked
// of the run, because a board saved before crates existed is an endless run of
// whatever stall it was in and finishes as one.
test('only an endless, evenly stocked run competes', () => {
  assert.ok(isRanked(WHOLESALER, true), 'the one comparable board stopped competing');
  assert.ok(!isRanked(WHOLESALER, false), 'a capped run competed anyway');
  assert.ok(!isRanked(FRIENDS[1], true), 'a lopsided stall competed');
  assert.ok(!isRanked(FIRST_FRIEND, false), '草莓\'s crate is capped and competed anyway');
  // …and the legacy case: 草莓's stall, endless, is what every save written
  // before crates existed resumes into
  assert.ok(isRanked(FIRST_FRIEND, true), 'an old endless save was struck off the board');
});

// ── the morning after ──────────────────────────────────────────────────────
//
// A friend has one farm. Selling everything on it costs them the time it takes
// to pick another, which is the limit of their land said in the only unit the
// game has for it. The load-bearing claim is the second test: whatever a save
// or a wall clock says, nobody is ever shut for longer than one morning — a
// wait that can outlive its own duration is a retention mechanic by accident.

test('selling a friend\'s morning shuts their stall, and the endless one has no clock', () => {
  const clock = makeStallClock();
  const t = 1_000_000;
  assert.ok(isStocked(clock, FIRST_FRIEND, t), 'a stall nobody has visited was already sold out');

  const wait = noteStallSold(clock, FIRST_FRIEND, t);
  assert.equal(wait, restockMsOf(FIRST_FRIEND));
  assert.ok(!isStocked(clock, FIRST_FRIEND, t), '草莓 handed over two mornings in one');
  assert.equal(msUntilRestock(clock, FIRST_FRIEND, t + wait / 2), wait / 2, 'the wait does not run down');
  assert.ok(isStocked(clock, FIRST_FRIEND, t + wait), 'the morning never came');
  assert.ok(isStocked(clock, FRIENDS[1], t), 'one friend selling out shut the whole cast');

  // …and the one door that is always open, which is what makes the rest of it
  // a limit rather than a wait
  assert.equal(restockMsOf(WHOLESALER), 0);
  assert.equal(noteStallSold(clock, WHOLESALER, t), 0, 'the wholesaler went picking');
  assert.ok(isStocked(clock, WHOLESALER, t + 1), 'the endless crate ran out');
});

test('nothing shuts a stall for longer than one morning', () => {
  const wait = restockMsOf(FIRST_FRIEND);
  const hostile = [
    Number.MAX_SAFE_INTEGER, 1e15, Date.now() + 400 * 24 * 3600 * 1000,
  ];
  for (const at of hostile) {
    const clock = unpackStallClock({ [FIRST_FRIEND.level]: at });
    assert.equal(msUntilRestock(clock, FIRST_FRIEND, 0), wait,
      `an epoch of ${at} shut a friend out for longer than they take to pick`);
  }

  // …and the same cap catches a wall clock that moved backwards under a live
  // wait, which is a timezone change or a device with a bad clock, not an attack
  const clock = makeStallClock();
  noteStallSold(clock, FIRST_FRIEND, 5_000_000);
  assert.equal(msUntilRestock(clock, FIRST_FRIEND, 0), wait);
});

test('a clock we cannot read is an open stall, never a shut one', () => {
  for (const junk of [null, undefined, 0, 'soon', [], { 2: 'noon' }, { 2: -5 }, { 2: 1.5 }, { 99: 1e9 }]) {
    const clock = unpackStallClock(junk);
    for (const s of STALLS) {
      assert.ok(isStocked(clock, s, Date.now()), `${JSON.stringify(junk)} shut ${stallName(s)}`);
    }
  }
});

test('the wait round-trips through a save, and the endless stall never rides in one', () => {
  const clock = makeStallClock();
  const t = 2_000_000;
  noteStallSold(clock, FIRST_FRIEND, t);
  noteStallSold(clock, WHOLESALER, t);

  const packed = packStallClock(clock);
  assert.deepEqual(Object.keys(packed), [String(FIRST_FRIEND.level)], 'the save carries a stall with no clock');

  const back = unpackStallClock(JSON.parse(JSON.stringify(packed)));
  assert.equal(msUntilRestock(back, FIRST_FRIEND, t), restockMsOf(FIRST_FRIEND), 'the wait did not survive the save');
});

test('every friend needs time to pick again, and the wholesaler needs none', () => {
  for (const f of FRIENDS) {
    assert.ok(restockMsOf(f) > 0, `${f.flavor} restocks instantly, which is a farm with no limits`);
    assert.ok(restockMsOf(f) <= 60 * 60 * 1000,
      `${f.flavor} takes over an hour to pick — a wait that long is a scold, not a limit`);
  }
  assert.equal(restockMsOf(WHOLESALER), 0, 'the one always-open door grew a clock');
  for (const junk of [null, undefined, {}, { restockMs: 0 }, { restockMs: -5 }, { restockMs: 'soon' }]) {
    assert.equal(restockMsOf(junk), 0, `${JSON.stringify(junk)} invented a wait`);
  }
});

test('the wholesaler is reachable by level, and called by their own name', () => {
  assert.equal(stallOf(WHOLESALER.level), WHOLESALER);
  assert.equal(stallOf(FRIENDS[1].level), FRIENDS[1]);
  assert.equal(stallOf(undefined), FIRST_FRIEND, 'an unknown stall is 草莓\'s, never nobody\'s');
  assert.equal(stallName(WHOLESALER), 'Wholesaler');
  assert.equal(stallAlt(WHOLESALER), WHOLESALER.alt);
  assert.equal(stallName(FIRST_FRIEND), 'Strawberry', 'a friend is called by the fruit they are');
  assert.match(stallAlt(FIRST_FRIEND), /草莓/);
});

test('the table is well formed — one real fruit each, and 草莓 first', () => {
  assert.equal(FIRST_FRIEND, FRIENDS[0]);
  const levels = new Set();
  for (const f of FRIENDS) {
    assert.ok(Number.isInteger(f.level) && f.level >= 1, `${f.flavor} is not a fruit`);
    assert.ok(!levels.has(f.level), `two friends are the same fruit (${f.level})`);
    levels.add(f.level);
    assert.equal(f.weights.length, MAX_SPAWN_LEVEL, `${f.flavor} weighs the wrong number of levels`);
    assert.ok(f.weights.some((n) => n > 0), `${f.flavor} has an empty stall`);
    assert.match(f.flavor, /^\S+ \S+$/, `${f.flavor} is not one word in each language`);
    assert.ok(crateSizeOf(f) > 0, `${f.flavor} hands over a crate with nothing in it`);
  }

  // The wholesaler leads the chooser and is nobody's friend: they are never
  // unlocked, never a fruit somebody grows, and never absent.
  assert.equal(STALLS[0], WHOLESALER);
  assert.deepEqual(STALLS.slice(1), FRIENDS);
  assert.ok(!FRIENDS.includes(WHOLESALER), 'the wholesaler is in the cast');
  assert.match(WHOLESALER.flavor, /^\S+ \S+$/);
});

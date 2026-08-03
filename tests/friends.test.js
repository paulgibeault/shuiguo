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
  FIRST_FRIEND, friendOf, openFriends, isFriendOpen, isBalanced, weightedDraw,
} from '../js/friends.js';
import { FRIENDS, MAX_SPAWN_LEVEL } from '../js/constants.js';
import { makeCampaign, noteMerges, makeRunTally } from '../js/campaign.js';
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
  assert.ok(!isBalanced({ weights: [0, 0, 0, 0, 0] }), 'an empty stall passed as balanced');
  assert.ok(!isBalanced({}), 'a friend with no weights passed as balanced');
  assert.ok(!isBalanced(null));
  assert.ok(isBalanced({ weights: [4, 4, 4, 4, 4] }), 'even is even at any scale');
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
  }
});

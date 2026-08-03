// The appraisal is the campaign's whole reward loop and the one place fruit
// becomes money. Its promises — every ending pays, nothing on the counter is
// wasted, the first run always buys the farm — are economics, not taste, so
// they get pinned here rather than discovered by a player who went broke.
//
// The merchant's curve below it is the same kind of promise one step earlier:
// what a MERGE fetches, as against what an unmerged fruit fetches sitting on
// the counter. Deep merging has to be worth the effort curve it costs, and
// "significantly more" is a number, so it is pinned like one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appraise, isTidy, canBuy, priceOfSeed, priceOfTerrace, priceOfEquipment, EQUIPMENT,
  mergeValue, annihilateValue, tierPremium, chainMultiplier,
} from '../js/economy.js';
import { TUNING, MAX_LEVEL, MAX_TERRACES, ANNIHILATE_SCORE, scoreOf } from '../js/constants.js';

test('the itemization always adds up to the total it reports', () => {
  const cases = [
    { earnings: 0, boardLevels: [], reason: 'toppled' },
    { earnings: 500, boardLevels: [1, 1, 5, 9], reason: 'toppled' },
    { earnings: 500, boardLevels: [1, 1, 5, 9], reason: 'packed' },
    { earnings: 12, boardLevels: [11], reason: 'sold-out', isFirstRun: true },
    { earnings: 9999, boardLevels: [11, 11], reason: 'packed', isFirstRun: true },
  ];
  for (const c of cases) {
    const a = appraise(c);
    assert.equal(a.total, a.runEarnings + a.boardValue + a.tidyBonus + a.floorTopUp,
      `lines do not sum for ${JSON.stringify(c)}`);
  }
});

test('fruit left on the counter sells at face value — nothing is wasted', () => {
  const a = appraise({ earnings: 0, boardLevels: [1, 2, 3, 11] });
  assert.equal(a.boardValue, scoreOf(1) + scoreOf(2) + scoreOf(3) + scoreOf(11));
  assert.equal(a.runEarnings, 0);
  assert.equal(a.total, a.boardValue);
});

test('an empty board is a real result, not a crash', () => {
  const a = appraise({ earnings: 40, boardLevels: [], reason: 'sold-out' });
  assert.equal(a.boardValue, 0);
  assert.ok(a.total > 0, 'selling out earns nothing');
});

test('a called-with-nothing appraisal is all zeroes rather than NaN', () => {
  const a = appraise();
  assert.deepEqual(a, { runEarnings: 0, boardValue: 0, tidyBonus: 0, floorTopUp: 0, total: 0 });
});

// The annihilation board — everything banked, bare counter — used to be exactly
// cash-neutral against leaving the two watermelons sitting there, because score
// and face value were the same number. They are not any more: a merge earns the
// merchant's premium and an unmerged fruit does not, so blowing them up now
// BEATS keeping them, and it should. That is the premium doing its job on the
// biggest thing the board can do.
test('annihilating beats leaving the two watermelons on the counter', () => {
  const blown = appraise({ earnings: annihilateValue(1), boardLevels: [] });
  const kept = appraise({ earnings: 0, boardLevels: [MAX_LEVEL, MAX_LEVEL] });
  assert.equal(kept.boardValue, 2 * scoreOf(MAX_LEVEL));
  assert.ok(blown.total > kept.total, 'the ultimate merge is priced as a sacrifice');
  assert.equal(ANNIHILATE_SCORE, 2 * scoreOf(MAX_LEVEL), 'the doubling the score table rests on broke');
});

test('the tidy bonus is earned by stopping on purpose, never by toppling', () => {
  assert.ok(isTidy('packed'));
  assert.ok(isTidy('sold-out'));
  assert.ok(!isTidy('toppled'));
  assert.ok(!isTidy(undefined));

  const board = [5, 5, 6];
  const toppled = appraise({ earnings: 300, boardLevels: board, reason: 'toppled' });
  const packed = appraise({ earnings: 300, boardLevels: board, reason: 'packed' });
  assert.equal(toppled.tidyBonus, 0);
  assert.equal(packed.tidyBonus, Math.round((toppled.runEarnings + toppled.boardValue) * TUNING.tidyBonus));
  assert.ok(packed.total > toppled.total, 'packing up must beat toppling');
});

test('toppling out is never punished beyond ending the run', () => {
  const a = appraise({ earnings: 420, boardLevels: [3, 4, 5], reason: 'toppled' });
  assert.equal(a.total, a.runEarnings + a.boardValue, 'a topped-out stall was docked something');
});

test('the first run is floored so the farm is always affordable', () => {
  const thin = appraise({ earnings: 1, boardLevels: [], reason: 'toppled', isFirstRun: true });
  assert.equal(thin.total, TUNING.firstRunFloor);
  assert.ok(thin.floorTopUp > 0);
  assert.ok(thin.total > TUNING.starterFarmCost, 'the floor does not clear the farm');
});

test('the floor tops up, it never caps — a good first run keeps what it earned', () => {
  const fat = appraise({ earnings: TUNING.firstRunFloor * 3, boardLevels: [11], isFirstRun: true });
  assert.equal(fat.floorTopUp, 0);
  assert.equal(fat.total, fat.runEarnings + fat.boardValue);
  assert.ok(fat.total > TUNING.firstRunFloor);
});

test('the floor is the first run only', () => {
  const later = appraise({ earnings: 1, boardLevels: [], isFirstRun: false });
  assert.equal(later.floorTopUp, 0);
  assert.equal(later.total, 1);
});

test('a hostile board cannot mint money out of levels that do not exist', () => {
  const a = appraise({ earnings: 10, boardLevels: [0, -3, 1.5, MAX_LEVEL + 1, NaN, null, '11', 4] });
  assert.equal(a.boardValue, scoreOf(4), 'a junk level was priced');
});

test('scores are floored to whole 元, and a negative score cannot drain the till', () => {
  assert.equal(appraise({ earnings: 10.9 }).runEarnings, 10);
  assert.equal(appraise({ earnings: -500, boardLevels: [3] }).runEarnings, 0);
  assert.equal(appraise({ earnings: NaN, boardLevels: [3] }).runEarnings, 0);
});

// ── the merchant's curve ───────────────────────────────────────────────────

test('the tier premium never dips as the fruit gets bigger', () => {
  for (let level = 2; level <= MAX_LEVEL; level++) {
    assert.ok(tierPremium(level) >= tierPremium(level - 1),
      `level ${level} is worth a smaller multiple than the one below it`);
  }
  assert.equal(TUNING.tierPremium.length, MAX_LEVEL, 'one premium per fruit, no more and no fewer');
});

// The two ends of the curve, which are the two things the design promises: a
// cherry pair is not a feat and pays what a cherry is worth, and the fruit at
// the top of the chain pays a multiple that makes the climb worth making.
test('small fruit merge at face value; a watermelon merge pays several times its own', () => {
  assert.equal(mergeValue(2, 1), scoreOf(2), 'a cherry→strawberry merge charged a premium');
  assert.equal(mergeValue(3, 1), scoreOf(3));
  assert.ok(mergeValue(MAX_LEVEL, 1) >= 4 * scoreOf(MAX_LEVEL),
    `a watermelon merge pays ${mergeValue(MAX_LEVEL, 1)} against ${scoreOf(MAX_LEVEL)} face`);
});

// The complaint this whole WP answers: a pear built from scratch banked ~126元
// of cumulative merge value against 64元 of face value, so merging roughly
// DOUBLED a fruit's worth while the effort curve to reach it was far steeper.
test('building a fruit out-earns selling the same fruit unmerged, by a lot', () => {
  // every merge on the way up from cherries to one pear
  let built = 0;
  for (let level = 2; level <= 7; level++) built += mergeValue(level, 1) * (1 << (7 - level));
  assert.ok(built > 4 * scoreOf(7),
    `building a pear banks ${built} against ${scoreOf(7)} face — the climb is not paid for`);
});

test('a chain multiplies the merges in it, and a 1-chain multiplies by exactly one', () => {
  assert.equal(chainMultiplier(1), 1, 'the absence of a combo still charged for one');
  assert.equal(chainMultiplier(4), 1 + TUNING.chainBonus * 3);
  const slow = 4 * mergeValue(4, 1);
  const combo = mergeValue(4, 1) + mergeValue(4, 2) + mergeValue(4, 3) + mergeValue(4, 4);
  assert.ok(combo > slow, 'four dekopons in a chain earned no more than four made slowly');
});

test('the ultimate merge never pays worse than the merge below it', () => {
  for (const chain of [1, 2, 5]) {
    assert.ok(annihilateValue(chain) >= mergeValue(MAX_LEVEL, chain),
      `at chain ${chain} annihilating is a pay cut`);
  }
});

test('the curve refuses to price what is not a fruit, rather than inventing a number', () => {
  for (const bad of [0, -1, 1.5, MAX_LEVEL + 1, NaN, null, undefined, '3']) {
    assert.equal(mergeValue(bad, 1), 0, `${JSON.stringify(bad)} was priced`);
  }
  // a junk chain is no chain, never a negative or infinite multiplier
  for (const bad of [0, -9, NaN, Infinity, null, 'four']) {
    assert.equal(chainMultiplier(bad), 1, `chain ${JSON.stringify(bad)} bent the multiplier`);
  }
  assert.equal(tierPremium(MAX_LEVEL + 1), 1, 'an unknown fruit is sold at face, not for free');
});

test('every merge value is a whole 元 — the campaign has no fractions of one', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    for (const chain of [1, 2, 3, 7]) {
      assert.ok(Number.isInteger(mergeValue(level, chain)), `level ${level} chain ${chain} paid a fraction`);
    }
  }
  assert.ok(Number.isInteger(annihilateValue(3)));
});

test('prices come from exactly one place, and an unbuyable thing is null not free', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) assert.ok(priceOfSeed(level) > 0);

  assert.equal(priceOfTerrace(0), null, 'terrace 1 is bought as the farm, not as a terrace');
  for (let i = 1; i < MAX_TERRACES; i++) assert.ok(priceOfTerrace(i) > 0);
  assert.equal(priceOfTerrace(MAX_TERRACES), null, 'the mountain ran out');
  assert.equal(priceOfTerrace(-1), null);
  assert.equal(priceOfTerrace(1.5), null);

  for (const what of Object.keys(EQUIPMENT)) assert.ok(priceOfEquipment(what) > 0);
  assert.equal(priceOfEquipment('unicorn'), null);
  assert.equal(priceOfEquipment('toString'), null, 'prototype keys are not merchandise');
});

test('affordability: exact change buys, a null price never does', () => {
  assert.ok(canBuy(100, 100));
  assert.ok(canBuy(101, 100));
  assert.ok(!canBuy(99, 100));
  assert.ok(!canBuy(Infinity, null), 'a thing with no price cannot be bought at any price');
  assert.ok(!canBuy(undefined, 10));
  assert.ok(!canBuy(10, NaN));
});

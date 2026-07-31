// The appraisal is the campaign's whole reward loop and the one place score
// becomes money. Its promises — every ending pays, nothing on the counter is
// wasted, the first run always buys the farm — are economics, not taste, so
// they get pinned here rather than discovered by a player who went broke.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appraise, isTidy, canBuy, priceOfSeed, priceOfTerrace, priceOfEquipment, EQUIPMENT,
} from '../js/economy.js';
import { TUNING, MAX_LEVEL, MAX_TERRACES, ANNIHILATE_SCORE, scoreOf } from '../js/constants.js';

test('the itemization always adds up to the total it reports', () => {
  const cases = [
    { score: 0, boardLevels: [], reason: 'toppled' },
    { score: 500, boardLevels: [1, 1, 5, 9], reason: 'toppled' },
    { score: 500, boardLevels: [1, 1, 5, 9], reason: 'packed' },
    { score: 12, boardLevels: [11], reason: 'sold-out', isFirstRun: true },
    { score: 9999, boardLevels: [11, 11], reason: 'packed', isFirstRun: true },
  ];
  for (const c of cases) {
    const a = appraise(c);
    assert.equal(a.total, a.runScore + a.boardValue + a.tidyBonus + a.floorTopUp,
      `lines do not sum for ${JSON.stringify(c)}`);
  }
});

test('fruit left on the counter sells at face value — nothing is wasted', () => {
  const a = appraise({ score: 0, boardLevels: [1, 2, 3, 11] });
  assert.equal(a.boardValue, scoreOf(1) + scoreOf(2) + scoreOf(3) + scoreOf(11));
  assert.equal(a.runScore, 0);
  assert.equal(a.total, a.boardValue);
});

test('an empty board is a real result, not a crash', () => {
  const a = appraise({ score: 40, boardLevels: [], reason: 'sold-out' });
  assert.equal(a.boardValue, 0);
  assert.ok(a.total > 0, 'selling out earns nothing');
});

test('a called-with-nothing appraisal is all zeroes rather than NaN', () => {
  const a = appraise();
  assert.deepEqual(a, { runScore: 0, boardValue: 0, tidyBonus: 0, floorTopUp: 0, total: 0 });
});

// The annihilation board — high score, bare counter — is the case where "no
// fruit is ever wasted" has to be arithmetic rather than a slogan. It is:
// ANNIHILATE_SCORE is exactly what the two watermelons would have fetched
// sitting there, so blowing them up is cash-NEUTRAL and pure counter space.
// That equality is the whole reason the ultimate merge isn't a sacrifice.
test('annihilating pays exactly what the two watermelons were worth on the counter', () => {
  const blown = appraise({ score: ANNIHILATE_SCORE + 1023, boardLevels: [] });
  const kept = appraise({ score: 1023, boardLevels: [MAX_LEVEL, MAX_LEVEL] });
  assert.equal(kept.boardValue, 2 * scoreOf(MAX_LEVEL));
  assert.equal(blown.total, kept.total, 'the ultimate merge is not priced as its own reward');
  assert.equal(ANNIHILATE_SCORE, 2 * scoreOf(MAX_LEVEL), 'the doubling that makes it neutral broke');
});

test('the tidy bonus is earned by stopping on purpose, never by toppling', () => {
  assert.ok(isTidy('packed'));
  assert.ok(isTidy('sold-out'));
  assert.ok(!isTidy('toppled'));
  assert.ok(!isTidy(undefined));

  const board = [5, 5, 6];
  const toppled = appraise({ score: 300, boardLevels: board, reason: 'toppled' });
  const packed = appraise({ score: 300, boardLevels: board, reason: 'packed' });
  assert.equal(toppled.tidyBonus, 0);
  assert.equal(packed.tidyBonus, Math.round((toppled.runScore + toppled.boardValue) * TUNING.tidyBonus));
  assert.ok(packed.total > toppled.total, 'packing up must beat toppling');
});

test('toppling out is never punished beyond ending the run', () => {
  const a = appraise({ score: 420, boardLevels: [3, 4, 5], reason: 'toppled' });
  assert.equal(a.total, a.runScore + a.boardValue, 'a topped-out stall was docked something');
});

test('the first run is floored so the farm is always affordable', () => {
  const thin = appraise({ score: 1, boardLevels: [], reason: 'toppled', isFirstRun: true });
  assert.equal(thin.total, TUNING.firstRunFloor);
  assert.ok(thin.floorTopUp > 0);
  assert.ok(thin.total > TUNING.starterFarmCost, 'the floor does not clear the farm');
});

test('the floor tops up, it never caps — a good first run keeps what it earned', () => {
  const fat = appraise({ score: TUNING.firstRunFloor * 3, boardLevels: [11], isFirstRun: true });
  assert.equal(fat.floorTopUp, 0);
  assert.equal(fat.total, fat.runScore + fat.boardValue);
  assert.ok(fat.total > TUNING.firstRunFloor);
});

test('the floor is the first run only', () => {
  const later = appraise({ score: 1, boardLevels: [], isFirstRun: false });
  assert.equal(later.floorTopUp, 0);
  assert.equal(later.total, 1);
});

test('a hostile board cannot mint money out of levels that do not exist', () => {
  const a = appraise({ score: 10, boardLevels: [0, -3, 1.5, MAX_LEVEL + 1, NaN, null, '11', 4] });
  assert.equal(a.boardValue, scoreOf(4), 'a junk level was priced');
});

test('scores are floored to whole 元, and a negative score cannot drain the till', () => {
  assert.equal(appraise({ score: 10.9 }).runScore, 10);
  assert.equal(appraise({ score: -500, boardLevels: [3] }).runScore, 0);
  assert.equal(appraise({ score: NaN, boardLevels: [3] }).runScore, 0);
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

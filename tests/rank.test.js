// The farmer's rank is the campaign's ladder: what it takes to climb and what
// each rung opens. Two promises are pinned here — the ladder is a ladder (it
// only goes up, and every rung is reachable) and it is COMPLETE: everything
// the shop can ever sell is opened by exactly one rank, so nothing is either
// unreachable or listed twice in the Almanac.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RANKS, MAX_RANK, xpOfHarvest, rankOf, rankInfo, progressOf, xpForRank, unlocksAt,
  rankForSeed, rankForTerrace, rankForStructure, rankForEquipment,
} from '../js/rank.js';
import { FARM, FRUITS, STRUCTURE_KINDS, TUNING, MAX_LEVEL, MAX_TERRACES, scoreOf } from '../js/constants.js';

test('the ladder only goes up, and starts at zero', () => {
  assert.equal(RANKS[0].xp, 0);
  for (let i = 1; i < RANKS.length; i++) {
    assert.ok(RANKS[i].xp > RANKS[i - 1].xp, `rank ${i + 1} is no further than rank ${i}`);
    assert.ok(RANKS[i].title && RANKS[i].hanzi, `rank ${i + 1} has no name`);
  }
  assert.equal(MAX_RANK, RANKS.length);
});

test('experience is face value per fruit picked, and nothing for nonsense', () => {
  assert.equal(xpOfHarvest(1, 10), 10 * scoreOf(1));
  assert.equal(xpOfHarvest(11, 2), 2 * scoreOf(11));
  for (const [l, n] of [[0, 1], [12, 1], [1, 0], [1, -3], [1, 1.5], ['1', 1]]) {
    assert.equal(xpOfHarvest(l, n), 0, `${l}×${n}`);
  }
});

test('rank, progress and the xp that reaches a rank agree with each other', () => {
  for (let r = 1; r <= MAX_RANK; r++) {
    const xp = xpForRank(r);
    assert.equal(rankOf(xp), r);
    if (r > 1) assert.equal(rankOf(xp - 1), r - 1);
    const p = progressOf(xp);
    assert.equal(p.rank, r);
    assert.equal(p.into, 0);
    if (r < MAX_RANK) assert.equal(p.toNext, RANKS[r].xp - xp);
    else assert.equal(p.toNext, null);
  }
  assert.equal(progressOf(1e12).fraction, 1);
  assert.equal(rankOf(NaN), 1);
  assert.equal(rankInfo(99).rank, MAX_RANK);
  assert.equal(rankInfo(-1).rank, 1);
});

test('a brand-new farm can plant what it was handed', () => {
  assert.equal(rankForSeed(TUNING.starterTree), 1);
  assert.equal(rankForSeed(TUNING.starterCrop), 1);
  for (const level of Object.keys(TUNING.starterSeeds)) assert.equal(rankForSeed(Number(level)), 1);
});

test('everything the shop sells is opened by exactly one rank on the ladder', () => {
  const seen = new Map();
  for (let r = 1; r <= MAX_RANK; r++) {
    for (const u of unlocksAt(r)) {
      const key = `${u.type}:${u.key}`;
      assert.ok(!seen.has(key), `${key} is unlocked twice`);
      seen.set(key, r);
    }
  }
  for (let level = 1; level <= MAX_LEVEL; level++) {
    assert.equal(seen.get(`seed:${level}`), rankForSeed(level), FRUITS[level - 1].name);
  }
  for (let i = 1; i < MAX_TERRACES; i++) assert.equal(seen.get(`terrace:${i}`), rankForTerrace(i));
  for (const kind of STRUCTURE_KINDS) assert.equal(seen.get(`structure:${kind}`), rankForStructure(kind));
  assert.equal(seen.get('sprinkler:sprinkler'), rankForEquipment('sprinkler'));
  assert.equal(seen.get('irrigation:irrigation'), rankForEquipment('irrigation'));
  for (const r of seen.values()) assert.ok(r >= 1 && r <= MAX_RANK, 'something unlocks off the ladder');
});

test('the bigger the fruit, the later its seed — the chain is the ladder', () => {
  for (let level = 2; level <= MAX_LEVEL; level++) {
    assert.ok(FARM[level - 1].rank >= FARM[level - 2].rank,
      `${FRUITS[level - 1].name} opens before ${FRUITS[level - 2].name}`);
  }
});

test('every rank short of the top opens something — no empty rungs', () => {
  for (let r = 2; r < MAX_RANK; r++) assert.ok(unlocksAt(r).length > 0, `rank ${r} opens nothing`);
});

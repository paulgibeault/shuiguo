// The campaign's ledger, seed drawer and crate. Everything here is arithmetic
// the player never sees performed, which is exactly the kind of thing that goes
// quietly wrong — so the promises get pinned: cash never goes negative, seeds
// are earned only by merging in campaign, and `seedDripChance: 0` means never.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCampaign, STARTER_SEED,
  earn, spend, seedCount, isUnlocked, addSeeds, takeSeed, unlockedLevels,
  crateSize, harvestInto, drawFromCrate, countOf, totalCount, levelsIn,
  makeRunTally, noteMerges, rollSeedDrip,
  finishFirstRun, canBuyFarm, buyFarm, canGoToMarket, hasFarm, couldUseAHand,
  serialize, restore,
} from '../js/campaign.js';
import { TUNING, MAX_LEVEL, PINEAPPLE_LEVEL } from '../js/constants.js';
import { appraise } from '../js/economy.js';
import { makeRng } from '../js/arcade-rng.js';
import { plotAt, isRipe, eachPlot, evaluateFarm, harvest } from '../js/farm.js';

const T0 = 1_700_000_000_000;
const merge = (level) => ({ type: 'merge', level });

// A campaign past the opening, with money in the till.
function openCampaign(cash = 10_000) {
  const c = makeCampaign();
  finishFirstRun(c, TUNING.starterFarmCost);
  buyFarm(c, T0);
  c.crate = Object.create(null);
  earn(c, cash);
  return c;
}

// ── the till ───────────────────────────────────────────────────────────────

test('cash can never go negative, however hard the shop is pushed', () => {
  const c = makeCampaign();
  earn(c, 100);
  assert.equal(c.cash, 100);
  assert.ok(!spend(c, 101), 'overdrew the till');
  assert.equal(c.cash, 100);
  assert.ok(spend(c, 100), 'exact change was refused');
  assert.equal(c.cash, 0);
  assert.ok(!spend(c, 1));
  assert.equal(c.cash, 0);
});

test('the till only takes real money, and only ever whole 元', () => {
  const c = makeCampaign();
  for (const junk of [-50, 0, NaN, Infinity, null, undefined, '100']) {
    assert.equal(earn(c, junk), 0, `earned something from ${junk}`);
  }
  assert.equal(c.cash, 0);
  assert.equal(earn(c, 10.9), 10);
  assert.equal(c.cash, 10);
  for (const junk of [-1, NaN, Infinity, null, '5']) {
    assert.ok(!spend(c, junk), `spent something on ${junk}`);
  }
  assert.equal(c.cash, 10);
  assert.ok(spend(c, 0), 'a free thing should still be takeable');
});

// ── unlocks ────────────────────────────────────────────────────────────────

test('the cherry is the only seed nobody has to earn', () => {
  const c = makeCampaign();
  assert.deepEqual(unlockedLevels(c), [STARTER_SEED]);
  for (let level = 2; level <= MAX_LEVEL; level++) {
    assert.ok(!isUnlocked(c, level), `level ${level} was unlocked for free`);
  }
});

test('the first campaign merge of a level unlocks it and pays a free packet', () => {
  const c = makeCampaign();
  const tally = makeRunTally();
  const found = noteMerges(c, tally, [merge(2), merge(3), merge(2)]);
  assert.deepEqual(found, [2, 3], 'each level is celebrated once, in the order it happened');
  assert.ok(isUnlocked(c, 2) && isUnlocked(c, 3));
  assert.equal(seedCount(c, 2), TUNING.firstUnlockSeeds);
  assert.equal(seedCount(c, 3), TUNING.firstUnlockSeeds);
  // the second strawberry of the run is not a discovery, it is drip stock
  assert.equal(countOf(tally.dripEligible, 2), 1);
});

test('a level already unlocked is never re-celebrated across runs', () => {
  const c = makeCampaign();
  noteMerges(c, makeRunTally(), [merge(4)]);
  const later = makeRunTally();
  assert.deepEqual(noteMerges(c, later, [merge(4), merge(4)]), []);
  assert.equal(seedCount(c, 4), TUNING.firstUnlockSeeds, 'a second run paid the packet again');
  assert.equal(countOf(later.dripEligible, 4), 2);
});

test('dropped fruit is not a discovery — only merges unlock seeds', () => {
  const c = makeCampaign();
  const tally = makeRunTally();
  const found = noteMerges(c, tally, [
    { type: 'drop', level: 5 },
    { type: 'bounce', level: 5 },
    { type: 'annihilate', level: MAX_LEVEL },
    merge(1),                                  // a merge never makes a level 1
  ]);
  assert.deepEqual(found, []);
  assert.deepEqual(unlockedLevels(c), [STARTER_SEED]);
  assert.equal(totalCount(tally.dripEligible), 0, 'the cherry counted itself as drip stock');
});

// ── the seed drip ──────────────────────────────────────────────────────────

test('the drip pays out at roughly its stated chance over many merges', () => {
  const c = makeCampaign();
  noteMerges(c, makeRunTally(), [merge(6)]);        // unlock it first
  const tally = makeRunTally();
  noteMerges(c, tally, Array.from({ length: 4000 }, () => merge(6)));

  const before = seedCount(c, 6);
  const found = rollSeedDrip(c, tally, makeRng(20260731));
  const rate = countOf(found, 6) / 4000;
  assert.ok(Math.abs(rate - TUNING.seedDripChance) < 0.03, `drip rate ${rate} is nowhere near the knob`);
  assert.equal(seedCount(c, 6), before + countOf(found, 6), 'the drawer disagrees with the receipt');
});

test('a zero drip chance produces EXACTLY zero seeds, not almost none', () => {
  const real = TUNING.seedDripChance;
  try {
    TUNING.seedDripChance = 0;
    const c = makeCampaign();
    noteMerges(c, makeRunTally(), [merge(7)]);
    const tally = makeRunTally();
    noteMerges(c, tally, Array.from({ length: 20000 }, () => merge(7)));
    const before = seedCount(c, 7);
    const found = rollSeedDrip(c, tally, makeRng(1));
    assert.equal(totalCount(found), 0, 'the drip leaked with the knob at zero');
    assert.equal(seedCount(c, 7), before);
    // and a generator pinned at its own floor still cannot beat it
    assert.equal(totalCount(rollSeedDrip(c, tally, () => 0)), 0);
  } finally {
    TUNING.seedDripChance = real;
  }
});

test('the drip only rolls over merges that were eligible when they happened', () => {
  const c = makeCampaign();
  const tally = makeRunTally();
  noteMerges(c, tally, [merge(8)]);          // the run's first peach: an unlock
  assert.equal(totalCount(tally.dripEligible), 0);
  // a generator that always wins still cannot drip the unlocking merge itself
  assert.equal(totalCount(rollSeedDrip(c, tally, () => 0)), 0);
});

// ── the crate ──────────────────────────────────────────────────────────────

test('a harvest lands in the crate and the crate counts it', () => {
  const c = openCampaign();
  assert.equal(crateSize(c), 0);
  harvestInto(c, { level: 2, count: 6 });
  harvestInto(c, { level: 2, count: 6 });
  harvestInto(c, { level: 5, count: 5 });
  assert.equal(crateSize(c), 17);
  assert.equal(countOf(c.crate, 2), 12);
  assert.deepEqual(levelsIn(c.crate), [2, 5]);
});

test('a nonsense harvest is dropped rather than crated', () => {
  const c = openCampaign();
  for (const junk of [null, {}, { level: 0, count: 1 }, { level: 2, count: 0 },
    { level: 2, count: -3 }, { level: MAX_LEVEL + 1, count: 1 }, { level: 2, count: 1.5 }]) {
    assert.equal(harvestInto(c, junk), null, `crated ${JSON.stringify(junk)}`);
  }
  assert.equal(crateSize(c), 0);
});

test('the pineapple pays a bonus seed of something the player can actually plant', () => {
  const c = openCampaign();
  noteMerges(c, makeRunTally(), [merge(3)]);       // so there is more than one choice
  const got = harvestInto(c, { level: PINEAPPLE_LEVEL, count: 2 }, makeRng(7));
  assert.equal(got.count, 2);
  assert.ok(unlockedLevels(c).includes(got.bonusSeed), 'the bonus seed is not plantable');
  assert.ok(seedCount(c, got.bonusSeed) > 0);
  // every other fruit is just fruit
  assert.equal(harvestInto(c, { level: 2, count: 6 }, makeRng(7)).bonusSeed, null);
});

test('the crate empties exactly, one fruit per draw', () => {
  const c = makeCampaign();
  const expected = crateSize(c);
  assert.ok(expected > 0, 'the gift crate is empty');
  const rng = makeRng(99);
  const drawn = [];
  for (let i = 0; i < expected; i++) {
    const level = drawFromCrate(c.crate, rng);
    assert.ok(level != null, `the crate ran dry ${expected - i} fruit early`);
    drawn.push(level);
  }
  assert.equal(crateSize(c), 0);
  assert.equal(drawFromCrate(c.crate, rng), null, 'the empty crate kept giving');
  assert.equal(drawFromCrate(c.crate, rng), null);

  // and what came out is exactly what went in
  const tally = {};
  for (const level of drawn) tally[level] = (tally[level] || 0) + 1;
  for (const [level, n] of Object.entries(TUNING.giftCrate)) assert.equal(tally[level], n, `level ${level}`);
});

test('draws are weighted by what is left in the crate', () => {
  const crate = Object.create(null);
  crate[1] = 9000;
  crate[5] = 1000;
  const rng = makeRng(4242);
  let ones = 0;
  for (let i = 0; i < 10000; i++) if (drawFromCrate(crate, rng) === 1) ones++;
  assert.equal(ones, 9000, 'every fruit in the crate must come out exactly once');

  // a crate of one thing draws that thing
  const solo = Object.create(null);
  solo[11] = 2;
  assert.equal(drawFromCrate(solo, makeRng(1)), 11);
});

test('a broken generator still draws a real fruit rather than corrupting the crate', () => {
  for (const bad of [() => -1, () => 1, () => 2, () => NaN, () => 0]) {
    const crate = Object.create(null);
    crate[2] = 1;
    crate[4] = 1;
    const first = drawFromCrate(crate, bad);
    assert.ok([2, 4].includes(first), `drew ${first}`);
    assert.equal(totalCount(crate), 1);
    assert.ok([2, 4].includes(drawFromCrate(crate, bad)));
    assert.equal(totalCount(crate), 0);
  }
});

// ── the opening ────────────────────────────────────────────────────────────

test('the campaign opens on a gift run with a crate and no farm', () => {
  const c = makeCampaign();
  assert.equal(c.phase, 'gift-run');
  assert.equal(c.farm, null);
  assert.equal(c.cash, 0);
  assert.ok(crateSize(c) > 0);
  assert.ok(canGoToMarket(c), 'the gift run has nowhere to go');
  assert.ok(!canBuyFarm(c), 'the farm was for sale before the first appraisal');
});

test('the first appraisal always buys the farm, and the farm opens the game', () => {
  const c = makeCampaign();
  assert.ok(finishFirstRun(c, TUNING.firstRunFloor));
  assert.equal(c.phase, 'buy-farm');
  assert.ok(canBuyFarm(c), 'the floored first appraisal did not cover the farm');

  assert.ok(buyFarm(c, T0));
  assert.equal(c.phase, 'open');
  assert.equal(c.cash, TUNING.firstRunFloor - TUNING.starterFarmCost);
  assert.ok(c.farm, 'no farm was handed over');
  assert.equal(plotAt(c.farm, 0, 0).level, TUNING.starterTree);
  for (const [level, n] of Object.entries(TUNING.starterSeeds)) {
    assert.equal(seedCount(c, Number(level)), n, `starter seeds for level ${level}`);
  }
  assert.ok(!buyFarm(c, T0), 'bought a second starter farm');
  assert.ok(!finishFirstRun(c, 999), 'the gift run happened twice');
});

test('the market needs something to sell, and that is the whole rule', () => {
  const c = makeCampaign();
  finishFirstRun(c, TUNING.firstRunFloor);
  buyFarm(c, T0);
  c.crate = Object.create(null);
  assert.ok(!canGoToMarket(c), 'took an empty crate to market');
  harvestInto(c, { level: 1, count: 1 });
  assert.ok(canGoToMarket(c));
});

// The crate decides, in every phase. `buy-farm` used to be excluded, which left
// a player who came up short of the farm holding unsellable fruit and looking
// at a lit-up Market button that did nothing.
test('a full crate can go to market in every phase, and an empty one in none', () => {
  for (const phase of ['gift-run', 'buy-farm', 'open']) {
    const c = makeCampaign();
    c.phase = phase;
    assert.ok(canGoToMarket(c), `a full crate could not be sold in ${phase}`);
    c.crate = Object.create(null);
    assert.ok(!canGoToMarket(c), `an empty crate went to market in ${phase}`);
  }
});

test('a second market day before the farm earns cash but never re-floors', () => {
  const c = makeCampaign();
  // the gift run: floored, and it is the only run that ever is
  const gift = appraise({ score: 10, reason: 'packed', isFirstRun: c.phase === 'gift-run' });
  assert.ok(gift.floorTopUp > 0, 'the gift run was not floored');
  assert.ok(finishFirstRun(c, gift.total));
  assert.equal(c.phase, 'buy-farm');
  assert.equal(c.cash, TUNING.firstRunFloor);

  // still short of nothing in particular — go and sell the rest of the crate
  const second = appraise({ score: 10, reason: 'packed', isFirstRun: c.phase === 'gift-run' });
  assert.equal(second.floorTopUp, 0, 'the floor fired twice');
  assert.ok(!finishFirstRun(c, 99999), 'the gift run was finished a second time');
  earn(c, second.total);
  assert.equal(c.cash, TUNING.firstRunFloor + second.total);
  assert.equal(c.phase, 'buy-farm', 'a second market day moved the opening along by itself');
});

test('the seed drawer hands out one seed at a time and refuses what it lacks', () => {
  const c = makeCampaign();
  assert.ok(!takeSeed(c, 2), 'planted a seed the player never had');
  addSeeds(c, 2, 2);
  assert.ok(takeSeed(c, 2));
  assert.ok(takeSeed(c, 2));
  assert.ok(!takeSeed(c, 2));
  assert.equal(seedCount(c, 2), 0);
  for (const junk of [0, MAX_LEVEL + 1, 1.5, NaN, '2']) {
    assert.ok(!addSeeds(c, junk, 1), `added a seed for level ${junk}`);
  }
});

// ── save / restore ─────────────────────────────────────────────────────────

test('a campaign round-trips through a save unchanged', () => {
  const c = openCampaign(1234);
  noteMerges(c, makeRunTally(), [merge(2), merge(6)]);
  harvestInto(c, { level: 1, count: 12 });
  const back = restore(serialize(c));
  assert.deepEqual(serialize(back), serialize(c));
  assert.equal(back.cash, 1234);
  assert.deepEqual(unlockedLevels(back), [1, 2, 6]);
  assert.equal(crateSize(back), 12);
  assert.ok(back.farm, 'the farm did not ride along in the campaign save');
  assert.equal(plotAt(back.farm, 0, 0).level, TUNING.starterTree);
});

test('a farm mid-growth survives the save it was written in', () => {
  const c = openCampaign();
  const back = restore(serialize(c));
  // the starter tree was planted dry, so it is still waiting for its first drink
  assert.ok(!isRipe(plotAt(back.farm, 0, 0)));
  assert.equal(plotAt(back.farm, 0, 0).kind, 'tree');
});

test('a save from another version restores nothing', () => {
  assert.equal(restore(null), null);
  assert.equal(restore(undefined), null);
  assert.equal(restore({}), null);
  assert.equal(restore({ v: 99, cash: 1e9 }), null);
});

test('a hostile save cannot mint cash, seeds, or unlocks out of nothing', () => {
  const c = restore({
    v: 1,
    phase: 'president',
    cash: -1e9,
    seeds: { 2: -5, 3: 1e9, 0: 10, 12: 10, '__proto__': 7, 'toString': 3, 4: 2 },
    unlocked: [0, 12, 'all', 3.5, null, 5],
    crate: { 2: 'lots', 11: 3 },
    farm: 'a big one',
    firstRunDone: 'sure',
  });
  assert.ok(c);
  assert.equal(c.cash, 0, 'a negative save became money');
  assert.equal(seedCount(c, 2), 0);
  assert.equal(seedCount(c, 3), 0, 'a billion seeds got through the cap');
  assert.equal(seedCount(c, 4), 2, 'the one plausible entry should survive');
  assert.deepEqual(unlockedLevels(c), [1, 5]);
  assert.equal(crateSize(c), 3);
  assert.equal(c.farm, null, 'a string became a farm');
  assert.equal(({}).toString, Object.prototype.toString, 'the prototype was polluted');
  assert.equal(typeof {}.__proto__, 'object');
});

test('the phase and the farm always agree — the farm is the evidence', () => {
  // claiming the game is open with no farm behind it falls back to the opening
  const noFarm = restore({ v: 1, phase: 'open', cash: 5000, farm: null, firstRunDone: false });
  assert.equal(noFarm.phase, 'gift-run');
  assert.ok(noFarm.farm === null);

  const paidUp = restore({ v: 1, phase: 'open', cash: 5000, farm: null, firstRunDone: true });
  assert.equal(paidUp.phase, 'buy-farm', 'a paid-up player was sent back to the gift run');
  assert.ok(canBuyFarm(paidUp));

  // and a farm in hand means the opening is over, whatever the phase claims
  const farmed = serialize(openCampaign());
  const back = restore({ ...farmed, phase: 'gift-run' });
  assert.equal(back.phase, 'open');
});

test('a restored gift run still has its crate and can still be played', () => {
  const back = restore(serialize(makeCampaign()));
  assert.equal(back.phase, 'gift-run');
  assert.ok(canGoToMarket(back));
  assert.equal(crateSize(back), crateSize(makeCampaign()));
});

// ── the two questions the hosts used to answer for themselves ──────────────
// Both of these are campaign POLICY. They lived in hosts — one as a `c.phase
// === 'open'` string comparison in two places, one as three conditions
// assembled beside a DOM write — and being here is what makes them testable
// without booting a game.

test('hasFarm is the whole of "is the opening over"', () => {
  const c = makeCampaign();
  assert.ok(!hasFarm(c), 'the gift run already had a farm');
  finishFirstRun(c, TUNING.firstRunFloor);
  assert.ok(!hasFarm(c), 'coming up short of the farm counted as owning one');
  buyFarm(c, T0);
  assert.ok(hasFarm(c));
  assert.ok(!hasFarm(null));
  assert.ok(!hasFarm({}));
});

test('a friend could use a hand only when there is genuinely nothing to do here', () => {
  const c = makeCampaign();
  finishFirstRun(c, TUNING.firstRunFloor);
  // no farm yet: there is plenty to do, and it is buying one
  assert.ok(!couldUseAHand(c, T0), 'a player who has not bought the farm was sent away');

  buyFarm(c, T0);
  // the starter farm arrives with a bed half grown and a crate of gift fruit
  assert.ok(!couldUseAHand(c, T0), 'a farm with a crop coming was sent away');

  c.crate = Object.create(null);
  assert.ok(!couldUseAHand(c, T0), 'a crop landing inside the nudge window was ignored');

  // everything picked and sold, and the orchard partway through its cycle
  const later = T0 + 30 * 60 * 1000;
  evaluateFarm(c.farm, later);
  for (const { ti, pi, plot } of eachPlot(c.farm)) if (isRipe(plot)) harvest(c.farm, ti, pi, later);
  c.crate = Object.create(null);
  assert.ok(couldUseAHand(c, later), 'the quiet farm offered the player nothing at all');

  // …and anything in the crate retires it at once: there is a trip to make
  harvestInto(c, { level: 1, count: 1 });
  assert.ok(!couldUseAHand(c, later), 'a full crate still pointed away from the farm');
});

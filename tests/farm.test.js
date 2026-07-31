// The farm is the half of the game that runs while nobody is looking, so
// almost every rule in it is invisible in review and only observable by handing
// the module a clock and jumping it forward. That is exactly what this file
// does: no DOM, no timers, just epochs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeFarm, makeStarterFarm, evaluateFarm, evaluatePlot, plotAt, eachPlot,
  canPlant, plant, water, needsWater, harvest, fertilize, buildTrellis,
  addTerrace, nextTerraceIndex, installSprinkler, installIrrigation,
  isRipe, stageMsOf, progressOf, msUntilRipe, msUntilNextRipe, ripeCount,
  serialize, restore,
} from '../js/farm.js';
import { TUNING, MAX_TERRACES, MAX_LEVEL, growthOf, cycleOf, yieldOf } from '../js/constants.js';

const T0 = 1_700_000_000_000;      // a plausible wall-clock epoch
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const CHERRY = 1, STRAWBERRY = 2, GRAPE = 3, PINEAPPLE = 9;
const TREE_PLOT = 0, BED_PLOT = 1;

// A farm with `level` planted in the right kind of plot, watered, at T0.
function planted(level, plotIndex) {
  const farm = makeFarm();
  const pi = plotIndex != null ? plotIndex : (level === STRAWBERRY ? BED_PLOT : TREE_PLOT);
  if (level === GRAPE) buildTrellis(farm, 0, pi);
  assert.ok(plant(farm, 0, pi, level, T0), `could not plant level ${level}`);
  assert.ok(water(farm, 0, pi, T0));
  return { farm, pi };
}

// ── shape ──────────────────────────────────────────────────────────────────

test('a fresh farm is one terrace of beds around a single bench', () => {
  const farm = makeFarm();
  assert.equal(farm.terraces.length, 1);
  const plots = farm.terraces[0].plots;
  assert.equal(plots.length, TUNING.plotsPerTerrace);
  assert.equal(plots.filter((p) => p.slot === 'tree').length, TUNING.treePlotsPerTerrace);
  assert.ok(plots.every((p) => p.kind === null), 'the ground came pre-planted');
  assert.equal(farm.irrigation, false);
});

test('the starter farm arrives with a cherry tree in the bench, and thirsty', () => {
  const farm = makeStarterFarm(T0);
  const plot = plotAt(farm, 0, TREE_PLOT);
  assert.equal(plot.level, TUNING.starterTree);
  assert.equal(plot.kind, 'tree');
  assert.ok(needsWater(farm, 0, TREE_PLOT, T0), 'the tutorial has nothing to teach');
  // and it stays exactly where it was until someone waters it
  evaluateFarm(farm, T0 + DAY);
  assert.equal(progressOf(plot), 0);
  assert.ok(!isRipe(plot));
});

// ── growth is gated by water, and by nothing else ──────────────────────────

test('growth accrues only inside the watered window', () => {
  const { farm, pi } = planted(STRAWBERRY);
  const plot = plotAt(farm, 0, pi);
  const grow = growthOf(STRAWBERRY);

  evaluateFarm(farm, T0 + grow / 3);
  assert.equal(plot.progressMs, grow / 3);
  assert.ok(!isRipe(plot));

  evaluateFarm(farm, T0 + grow);
  assert.ok(isRipe(plot));
  assert.equal(progressOf(plot), 1);
});

test('dry soil pauses growth — and nothing wilts while it waits', () => {
  const { farm, pi } = planted(PINEAPPLE, BED_PLOT);
  const plot = plotAt(farm, 0, pi);

  // one watering covers waterMs; the pineapple needs far longer than that
  evaluateFarm(farm, T0 + TUNING.waterMs + 10 * DAY);
  assert.equal(plot.progressMs, TUNING.waterMs, 'growth ran on dry soil');
  assert.ok(!isRipe(plot));
  assert.equal(plot.level, PINEAPPLE, 'the crop died of neglect');
  assert.equal(plot.kind, 'bed');

  // water it again a fortnight later and it picks up exactly where it stopped
  const t1 = T0 + TUNING.waterMs + 10 * DAY;
  assert.ok(water(farm, 0, pi, t1));
  evaluateFarm(farm, t1 + HOUR);
  assert.equal(plot.progressMs, TUNING.waterMs + HOUR);
});

test('a week away leaves everything ripe and nothing hoarded', () => {
  const farm = makeFarm();
  plant(farm, 0, TREE_PLOT, CHERRY, T0);
  plant(farm, 0, BED_PLOT, STRAWBERRY, T0);
  installIrrigation(farm, T0);          // watered forever, so time is the only gate

  evaluateFarm(farm, T0 + 7 * DAY);
  assert.equal(ripeCount(farm), 2);
  // the tree held ONE crop rather than banking a week of cycles behind it
  const tree = plotAt(farm, 0, TREE_PLOT);
  assert.equal(tree.progressMs, stageMsOf(tree));
  const got = harvest(farm, 0, TREE_PLOT, T0 + 7 * DAY);
  assert.equal(got.count, yieldOf(CHERRY));
  assert.ok(!isRipe(tree), 'a week away banked a second crop behind the first');
});

test('a sprinkler waters its own terrace forever, and only its own', () => {
  const farm = makeFarm();
  addTerrace(farm, T0);
  plant(farm, 0, BED_PLOT, STRAWBERRY, T0);
  plant(farm, 1, BED_PLOT, STRAWBERRY, T0);
  assert.ok(installSprinkler(farm, 0, T0));
  assert.ok(!installSprinkler(farm, 0, T0), 'bought the same sprinkler twice');

  evaluateFarm(farm, T0 + growthOf(STRAWBERRY));
  assert.ok(isRipe(plotAt(farm, 0, BED_PLOT)), 'the sprinkler terrace did not grow');
  assert.ok(!isRipe(plotAt(farm, 1, BED_PLOT)), 'the sprinkler watered the whole mountain');
  assert.ok(!needsWater(farm, 0, BED_PLOT, T0), 'a sprinklered plot still begs for water');
  assert.ok(!water(farm, 0, BED_PLOT, T0), 'watering a sprinklered plot did something');
});

test('irrigation waters the mountain, including terraces bought later', () => {
  const farm = makeFarm();
  assert.ok(installIrrigation(farm, T0));
  assert.ok(!installIrrigation(farm, T0));
  addTerrace(farm, T0);
  plant(farm, 1, BED_PLOT, STRAWBERRY, T0);
  evaluateFarm(farm, T0 + growthOf(STRAWBERRY));
  assert.ok(isRipe(plotAt(farm, 1, BED_PLOT)));
});

test('equipment does not retroactively water the dry stretch before it', () => {
  const farm = makeFarm();
  plant(farm, 0, BED_PLOT, STRAWBERRY, T0);          // planted dry, never watered
  const late = T0 + 10 * DAY;
  installSprinkler(farm, 0, late);
  evaluateFarm(farm, late);
  assert.equal(plotAt(farm, 0, BED_PLOT).progressMs, 0, 'the sprinkler grew the past');

  const farm2 = makeFarm();
  plant(farm2, 0, BED_PLOT, STRAWBERRY, T0);
  installIrrigation(farm2, late);
  evaluateFarm(farm2, late);
  assert.equal(plotAt(farm2, 0, BED_PLOT).progressMs, 0, 'irrigation grew the past');
});

test('watering moves the window rather than stacking it', () => {
  const { farm, pi } = planted(PINEAPPLE, BED_PLOT);
  const plot = plotAt(farm, 0, pi);
  water(farm, 0, pi, T0 + MIN);
  assert.equal(plot.wateredUntilMs, T0 + MIN + TUNING.waterMs);
  evaluateFarm(farm, T0 + 3 * TUNING.waterMs);
  assert.equal(plot.progressMs, MIN + TUNING.waterMs, 'a second can watered twice as long');
});

// ── perennials ─────────────────────────────────────────────────────────────

test('a tree matures once, then fruits on the shorter cycle forever', () => {
  const { farm, pi } = planted(CHERRY);
  const plot = plotAt(farm, 0, pi);
  assert.equal(stageMsOf(plot), growthOf(CHERRY));
  assert.ok(cycleOf(CHERRY) <= growthOf(CHERRY), 'the cycle should not be slower than the maturing');

  let t = T0 + growthOf(CHERRY);
  evaluateFarm(farm, t);
  assert.ok(isRipe(plot));
  assert.deepEqual(harvest(farm, 0, pi, t), { level: CHERRY, count: yieldOf(CHERRY) });
  assert.equal(plot.mature, true);
  assert.equal(plot.kind, 'tree', 'the tree was uprooted by its own harvest');
  assert.equal(stageMsOf(plot), cycleOf(CHERRY), 'a mature tree re-matured');

  // and again, and again — the tree is capital, free forever
  for (let i = 0; i < 3; i++) {
    water(farm, 0, pi, t);
    t += cycleOf(CHERRY);
    evaluateFarm(farm, t);
    assert.ok(isRipe(plot), `cherry crop ${i + 2} never came`);
    assert.equal(harvest(farm, 0, pi, t).count, yieldOf(CHERRY));
  }
});

test('an annual dies at its harvest and leaves bare, still-trellised ground', () => {
  const { farm, pi } = planted(STRAWBERRY);
  const plot = plotAt(farm, 0, pi);
  evaluateFarm(farm, T0 + growthOf(STRAWBERRY));
  assert.deepEqual(harvest(farm, 0, pi, T0 + growthOf(STRAWBERRY)),
    { level: STRAWBERRY, count: yieldOf(STRAWBERRY) });
  assert.equal(plot.kind, null);
  assert.equal(plot.level, 0);
  assert.equal(plot.progressMs, 0);
  assert.equal(plot.slot, 'bed', 'harvesting re-cut the ground');
});

test('harvesting a trellised vine keeps the trellis standing', () => {
  const { farm, pi } = planted(GRAPE);
  const plot = plotAt(farm, 0, pi);
  evaluateFarm(farm, T0 + growthOf(GRAPE));
  assert.ok(harvest(farm, 0, pi, T0 + growthOf(GRAPE)));
  assert.equal(plot.trellis, true);
  assert.equal(plot.kind, 'vine', 'the vine is a perennial and should still be there');
});

test('harvesting unripe or bare ground takes nothing', () => {
  const { farm, pi } = planted(STRAWBERRY);
  assert.equal(harvest(farm, 0, pi, T0 + MIN), null);
  assert.equal(harvest(farm, 0, 2, T0), null, 'harvested bare earth');
  assert.equal(harvest(farm, 9, 9, T0), null, 'harvested a plot that does not exist');
});

// ── planting rules ─────────────────────────────────────────────────────────

test('beds take seeds, benches take trees, and neither takes the other', () => {
  const farm = makeFarm();
  assert.equal(canPlant(farm, 0, BED_PLOT, STRAWBERRY), null);
  assert.ok(canPlant(farm, 0, TREE_PLOT, STRAWBERRY), 'a strawberry went into the tree bench');
  assert.equal(canPlant(farm, 0, TREE_PLOT, CHERRY), null);
  assert.ok(canPlant(farm, 0, BED_PLOT, CHERRY), 'a cherry tree went into a shallow bed');
  assert.ok(!plant(farm, 0, BED_PLOT, CHERRY, T0));
});

test('a vine needs its trellis first, and the trellis only goes on a bench', () => {
  const farm = makeFarm();
  assert.equal(canPlant(farm, 0, TREE_PLOT, GRAPE), 'needs a trellis');
  assert.ok(!plant(farm, 0, TREE_PLOT, GRAPE, T0));
  assert.ok(!buildTrellis(farm, 0, BED_PLOT), 'a trellis went up over a shallow bed');
  assert.ok(buildTrellis(farm, 0, TREE_PLOT));
  assert.ok(!buildTrellis(farm, 0, TREE_PLOT), 'built the same trellis twice');
  assert.equal(canPlant(farm, 0, TREE_PLOT, GRAPE), null);
});

test('occupied ground and nonsense seeds are refused with a reason', () => {
  const { farm, pi } = planted(STRAWBERRY);
  assert.equal(canPlant(farm, 0, pi, STRAWBERRY), 'already planted');
  assert.equal(canPlant(farm, 0, 99, STRAWBERRY), 'no such plot');
  assert.equal(canPlant(farm, 9, 0, STRAWBERRY), 'no such plot');
  for (const junk of [0, -1, 1.5, MAX_LEVEL + 1, NaN, null, '2', undefined]) {
    assert.equal(canPlant(farm, 0, 2, junk), 'no such seed', `level ${junk} was plantable`);
  }
});

// ── fertilizer ─────────────────────────────────────────────────────────────

test('fertilizer halves what is left, and stacks', () => {
  const { farm, pi } = planted(PINEAPPLE, BED_PLOT);
  const plot = plotAt(farm, 0, pi);
  const full = growthOf(PINEAPPLE);

  assert.ok(fertilize(farm, 0, pi, T0));
  assert.equal(plot.progressMs, full / 2);
  assert.ok(fertilize(farm, 0, pi, T0));
  assert.equal(plot.progressMs, full * 3 / 4);
  assert.ok(!isRipe(plot), 'fertilizer alone should never finish the job');
});

test('fertilizer is useless on bare earth and on fruit already ripe', () => {
  const { farm, pi } = planted(STRAWBERRY);
  assert.ok(!fertilize(farm, 0, 2, T0), 'fertilized bare earth');
  evaluateFarm(farm, T0 + growthOf(STRAWBERRY));
  assert.ok(!fertilize(farm, 0, pi, T0 + growthOf(STRAWBERRY)), 'fertilized a ripe crop');
});

test('fertilizer banks the dry stretch before it as growth it never earned', () => {
  // planted dry: fertilizer halves the remaining time, it does not water
  const farm = makeFarm();
  plant(farm, 0, BED_PLOT, STRAWBERRY, T0);
  fertilize(farm, 0, BED_PLOT, T0 + DAY);
  assert.equal(plotAt(farm, 0, BED_PLOT).progressMs, growthOf(STRAWBERRY) / 2);
  evaluateFarm(farm, T0 + 2 * DAY);
  assert.ok(!isRipe(plotAt(farm, 0, BED_PLOT)), 'fertilizer watered the plot');
});

// ── the mountainside ───────────────────────────────────────────────────────

test('terraces are bought up the hill until the mountain runs out', () => {
  const farm = makeFarm();
  assert.equal(nextTerraceIndex(farm), 1);
  for (let i = 1; i < MAX_TERRACES; i++) {
    assert.equal(nextTerraceIndex(farm), i);
    assert.ok(addTerrace(farm, T0), `terrace ${i} would not buy`);
  }
  assert.equal(nextTerraceIndex(farm), null);
  assert.ok(!addTerrace(farm, T0), 'bought a terrace off the top of the mountain');
  assert.equal(farm.terraces.length, MAX_TERRACES);
  assert.equal(eachPlot(farm).length, MAX_TERRACES * TUNING.plotsPerTerrace);
});

test('the soonest ripening is what a returning session opens to', () => {
  const farm = makeFarm();
  assert.equal(msUntilNextRipe(farm, T0), null, 'an empty farm promised a harvest');

  plant(farm, 0, TREE_PLOT, CHERRY, T0);
  plant(farm, 0, BED_PLOT, STRAWBERRY, T0);
  installIrrigation(farm, T0);
  assert.equal(msUntilNextRipe(farm, T0), Math.min(growthOf(CHERRY), growthOf(STRAWBERRY)));

  evaluateFarm(farm, T0 + DAY);
  assert.equal(msUntilNextRipe(farm, T0 + DAY), 0);
});

test('a dry plot is not on its way to anything', () => {
  const farm = makeFarm();
  plant(farm, 0, BED_PLOT, PINEAPPLE, T0);
  water(farm, 0, BED_PLOT, T0);
  // one can of water cannot see a pineapple through, so it has no ripening date
  assert.equal(msUntilRipe(plotAt(farm, 0, BED_PLOT), T0, false), null);
  assert.equal(msUntilRipe(plotAt(farm, 0, BED_PLOT), T0, true), growthOf(PINEAPPLE));
});

// ── clocks behaving badly ──────────────────────────────────────────────────

test('a clock that jumps backwards earns nothing and cannot rewind the plot', () => {
  const { farm, pi } = planted(STRAWBERRY);
  const plot = plotAt(farm, 0, pi);
  evaluateFarm(farm, T0 + MIN);
  const banked = plot.progressMs;

  evaluateFarm(farm, T0 - 30 * DAY);           // user set the clock back a month
  assert.equal(plot.progressMs, banked, 'growth ran backwards');
  assert.ok(plot.lastEvalMs >= T0 + MIN, 'the plot rewound its own bookkeeping');

  // …and the month it "gains" on the way back is not free growth
  evaluateFarm(farm, T0 + MIN);
  assert.equal(plot.progressMs, banked);
});

test('a nonsense clock is ignored rather than propagated into the save', () => {
  const { farm, pi } = planted(STRAWBERRY);
  const plot = plotAt(farm, 0, pi);
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'now']) {
    evaluatePlot(plot, junk, false);
    assert.ok(Number.isFinite(plot.progressMs), `progress went to ${plot.progressMs} on ${junk}`);
    assert.ok(Number.isFinite(plot.lastEvalMs), `lastEval went to ${plot.lastEvalMs} on ${junk}`);
  }
});

// ── save / restore ─────────────────────────────────────────────────────────

test('a farm round-trips through a save unchanged', () => {
  const farm = makeStarterFarm(T0);
  buildTrellis(farm, 0, TREE_PLOT);
  addTerrace(farm, T0);
  plant(farm, 1, BED_PLOT, PINEAPPLE, T0);
  water(farm, 1, BED_PLOT, T0);
  installSprinkler(farm, 1, T0);
  evaluateFarm(farm, T0 + HOUR);

  const back = restore(serialize(farm));
  assert.deepEqual(serialize(back), serialize(farm));
  assert.equal(back.terraces.length, 2);
  assert.equal(back.terraces[1].sprinkler, true);
  assert.equal(plotAt(back, 1, BED_PLOT).level, PINEAPPLE);
});

test('a mid-cycle mature tree comes back mid-cycle, not re-planted', () => {
  const { farm, pi } = planted(CHERRY);
  evaluateFarm(farm, T0 + growthOf(CHERRY));
  harvest(farm, 0, pi, T0 + growthOf(CHERRY));
  water(farm, 0, pi, T0 + growthOf(CHERRY));
  evaluateFarm(farm, T0 + growthOf(CHERRY) + cycleOf(CHERRY) / 2);

  const back = restore(serialize(farm));
  const plot = plotAt(back, 0, pi);
  assert.equal(plot.mature, true);
  assert.equal(stageMsOf(plot), cycleOf(CHERRY));
  assert.equal(progressOf(plot), 0.5);
});

test('a save from another game, or no save at all, restores nothing', () => {
  assert.equal(restore(null), null);
  assert.equal(restore(undefined), null);
  assert.equal(restore({}), null);
  assert.equal(restore({ v: 2, terraces: [] }), null);
  assert.equal(restore({ v: 1, terraces: 'lots' }), null);
  assert.equal(restore({ v: 1, terraces: [] }), null, 'a farm with no terraces is not a farm');
  assert.equal(restore({ v: 1, terraces: new Array(MAX_TERRACES + 1).fill({}) }), null);
});

test('a hostile save yields bare earth, never an impossible plant', () => {
  const hostile = {
    v: 1,
    irrigation: 'yes please',
    terraces: [{
      sprinkler: 1,
      plots: [
        // a watermelon claiming to be a tree — no such plant has ever existed
        { slot: 'tree', kind: 'tree', level: 11, progressMs: 1e12, lastEvalMs: T0, mature: true },
        { slot: 'bed', kind: 'bed', level: 999, progressMs: 0, lastEvalMs: T0 },
        { slot: 'bed', kind: 'bed', level: 2, progressMs: -5000, lastEvalMs: -1, wateredUntilMs: NaN },
        null,
      ],
    }],
  };
  const farm = restore(hostile);
  assert.ok(farm, 'a hostile save should be survived, not rejected outright');
  assert.equal(farm.irrigation, false, 'a truthy string bought the irrigation');
  assert.equal(farm.terraces[0].sprinkler, false, 'a truthy number bought the sprinkler');

  const plots = farm.terraces[0].plots;
  assert.equal(plots.length, TUNING.plotsPerTerrace, 'the save reshaped the terrace');
  assert.equal(plots[0].kind, null, 'a watermelon tree took root');
  assert.equal(plots[1].kind, null, 'a level-999 fruit took root');
  // the one plausible plant survives, with its impossible numbers discarded
  assert.equal(plots[2].level, STRAWBERRY);
  assert.equal(plots[2].progressMs, 0);
  assert.equal(plots[2].wateredUntilMs, 0);
  assert.equal(plots[3].kind, null);
  assert.deepEqual(plots.map((p) => p.slot), ['tree', 'bed', 'bed', 'bed']);
});

test('a save cannot smuggle a vine in without its trellis, or grow past ripe', () => {
  const sneaky = restore({
    v: 1,
    terraces: [{
      plots: [{ slot: 'tree', trellis: false, kind: 'vine', level: GRAPE, progressMs: 0, lastEvalMs: T0 }],
    }],
  });
  assert.equal(plotAt(sneaky, 0, TREE_PLOT).kind, null, 'a vine grew on nothing');

  const overgrown = restore({
    v: 1,
    terraces: [{
      plots: [null, { slot: 'bed', kind: 'bed', level: STRAWBERRY, progressMs: 1e15, lastEvalMs: T0 }],
    }],
  });
  const plot = plotAt(overgrown, 0, BED_PLOT);
  assert.equal(plot.progressMs, growthOf(STRAWBERRY), 'progress ran past the stage it belongs to');
  assert.ok(isRipe(plot), 'an overgrown save should simply be ripe');
});

test('every plot in a restored farm is a legal plot the host can act on', () => {
  const junkValues = [undefined, null, 0, -1, 1.5, 1e18, NaN, 'x', {}, [], true];
  for (const junk of junkValues) {
    const farm = restore({
      v: 1,
      irrigation: junk,
      terraces: [{ sprinkler: junk, plots: [junk, junk, junk, junk] }, junk],
    });
    assert.ok(farm, `restore threw away a survivable save on ${String(junk)}`);
    for (const { ti, pi, plot } of eachPlot(farm)) {
      assert.ok(['bed', 'tree'].includes(plot.slot));
      assert.ok(plot.kind === null || ['bed', 'tree', 'vine'].includes(plot.kind));
      assert.ok(Number.isFinite(plot.progressMs) && plot.progressMs >= 0);
      // and the host's verbs are all safe to call on it
      evaluateFarm(farm, T0);
      water(farm, ti, pi, T0);
      fertilize(farm, ti, pi, T0);
      harvest(farm, ti, pi, T0);
    }
    assert.ok(serialize(farm), 'a restored farm must be re-serializable');
  }
});

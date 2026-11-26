// The farm is the half of the game that runs while nobody is looking, so
// almost every rule in it is invisible in review and only observable by handing
// the module a clock and jumping it forward. That is exactly what this file
// does: no DOM, no timers, just epochs.
//
// Growth speed depends on WHERE a plant stands (js/terrain.js), so any test
// about time asks the farm how fast the plot in question grows rather than
// assuming 1× — a test that hard-coded the speed would stop testing the moment
// the terrain table moved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeFarm, makeStarterFarm, evaluateFarm, evaluatePlot, plotAt, eachPlot, bareTiles,
  canPlace, anchorFor, plant, placeStructure, water, needsWater, harvest, fertilize, dig, move,
  addTerrace, nextTerraceIndex, installSprinkler, installIrrigation, speedOf,
  isRipe, isPlant, stageMsOf, progressOf, msUntilRipe, msUntilRipeAt, msUntilNextRipe, soonestRipening, ripeCount,
  serialize, restore,
} from '../js/farm.js';
import { fitOf } from '../js/terrain.js';
import {
  TUNING, MAX_TERRACES, MAX_LEVEL, farmOf, growthOf, cycleOf, yieldOf, spanOf, STRUCTURE_KINDS,
} from '../js/constants.js';

const T0 = 1_700_000_000_000;      // a plausible wall-clock epoch
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const COLS = TUNING.tilesPerTerrace;

const CHERRY = 1, STRAWBERRY = 2, GRAPE = 3, APPLE = 6, PINEAPPLE = 9, WATERMELON = 11;

// A farm with `level` planted at (0, col), watered, at T0.
function planted(level, col = 0) {
  const farm = makeFarm();
  assert.ok(plant(farm, 0, col, level, T0), `could not plant level ${level}`);
  assert.ok(water(farm, 0, col, T0));
  return { farm, col, plot: plotAt(farm, 0, col) };
}

// Wall-clock ms the current stage of the plot at (ti, col) takes, where it stands.
function wallStage(farm, ti, col) {
  const plot = plotAt(farm, ti, col);
  return stageMsOf(plot) / speedOf(farm, ti, plot);
}

// ── shape ──────────────────────────────────────────────────────────────────

test('a fresh farm is one terrace of bare ground', () => {
  const farm = makeFarm();
  assert.equal(farm.terraces.length, 1);
  assert.equal(farm.terraces[0].plots.length, 0);
  assert.equal(bareTiles(farm).length, COLS);
  assert.equal(farm.irrigation, false);
});

test('the starter farm arrives with a cherry tree mid-shelf, and thirsty', () => {
  const farm = makeStarterFarm(T0);
  const tree = plotAt(farm, 0, TUNING.starterTreeCol);
  assert.equal(tree.level, TUNING.starterTree);
  assert.equal(tree.kind, 'tree');
  assert.equal(tree.span, 2);
  // the first thing the mountain says is that trees are not a stream thing
  assert.ok(tree.col >= 2, 'the starter tree was planted beside the stream again');
  assert.ok(needsWater(farm, 0, tree.col, T0), 'the starter tree arrived pre-watered');
  assert.equal(plotAt(farm, 0, tree.col + 1), tree, 'a tree did not cover both its tiles');
});

test('the starter farm also arrives with a bed half grown and watered', () => {
  const farm = makeStarterFarm(T0);
  const bed = plotAt(farm, 0, TUNING.starterCropCol);
  assert.equal(bed.level, TUNING.starterCrop);
  assert.equal(progressOf(bed), TUNING.starterCropProgress);
  assert.ok(!needsWater(farm, 0, bed.col, T0));
});

test('the new farm pays off before the player can get bored of it', () => {
  const farm = makeStarterFarm(T0);
  const tree = TUNING.starterTreeCol;
  water(farm, 0, tree, T0);
  const bedLeft = msUntilRipeAt(farm, 0, TUNING.starterCropCol, T0);
  const treeLeft = msUntilRipeAt(farm, 0, tree, T0);
  assert.ok(bedLeft <= 90_000, `the half-grown bed takes ${bedLeft / 1000}s`);
  assert.ok(treeLeft <= 3 * MIN, `the starter tree takes ${treeLeft / MIN} minutes`);
});

// ── placement: anything, anywhere it fits ──────────────────────────────────

test('every fruit can be planted on any tile it fits on', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const span = spanOf(level);
    for (let col = 0; col + span <= COLS; col++) {
      const farm = makeFarm();
      assert.ok(plant(farm, 0, col, level, T0), `level ${level} would not go in at ${col}`);
      for (let c = col; c < col + span; c++) assert.equal(plotAt(farm, 0, c).level, level);
    }
  }
});

test('a two-tile plant tapped onto the end of a shelf grows leftward instead of refusing', () => {
  const farm = makeFarm();
  assert.equal(canPlace(farm, 0, COLS - 1, APPLE), 'not enough room');
  assert.equal(anchorFor(farm, 0, COLS - 1, APPLE), COLS - 2);
  plant(farm, 0, 2, STRAWBERRY, T0);
  // tile 3 tapped for an apple: 3–4 is clear, so it starts there
  assert.equal(anchorFor(farm, 0, 3, APPLE), 3);
  // tile 2 is the strawberry; nothing covering it fits
  assert.equal(anchorFor(farm, 0, 2, APPLE), null);
  // tile 1 tapped: 1–2 is blocked by the strawberry, 0–1 is clear
  assert.equal(anchorFor(farm, 0, 1, APPLE), 0);
});

test('occupied ground, ground off the shelf and nonsense seeds are refused with a reason', () => {
  const { farm } = planted(APPLE, 0);
  assert.equal(canPlace(farm, 0, 1, STRAWBERRY), 'not enough room', 'planted under a tree');
  assert.ok(!plant(farm, 0, 1, STRAWBERRY, T0));
  assert.equal(canPlace(farm, 0, COLS, STRAWBERRY), 'no such tile');
  assert.equal(canPlace(farm, 3, 0, STRAWBERRY), 'no such terrace');
  for (const junk of [0, MAX_LEVEL + 1, 1.5, NaN, '2', null]) {
    assert.equal(canPlace(farm, 0, 4, junk), 'no such seed', `level ${junk}`);
  }
});

test('ponds, hives and compost stand on one tile, and are never crops', () => {
  const farm = makeFarm();
  STRUCTURE_KINDS.forEach((kind, i) => {
    assert.ok(placeStructure(farm, 0, i, kind, T0), kind);
    const p = plotAt(farm, 0, i);
    assert.equal(p.kind, kind);
    assert.ok(!isPlant(p));
    assert.ok(!isRipe(p));
    assert.ok(!water(farm, 0, i, T0), `watered a ${kind}`);
    assert.equal(harvest(farm, 0, i, T0), null, `harvested a ${kind}`);
    assert.equal(msUntilRipe(p, T0, true), null);
  });
  assert.ok(!placeStructure(farm, 0, 0, 'pond', T0), 'two things on one tile');
  assert.ok(!placeStructure(farm, 0, 4, 'windmill', T0), 'placed a structure nobody sells');
  assert.ok(!plant(farm, 0, 4, 'pond', T0), 'planted a structure as a seed');
});

// ── growth ─────────────────────────────────────────────────────────────────

test('growth accrues only inside the watered window', () => {
  const farm = makeFarm();
  plant(farm, 0, 0, STRAWBERRY, T0);
  evaluateFarm(farm, T0 + 10 * MIN);
  assert.equal(plotAt(farm, 0, 0).progressMs, 0, 'dry ground grew something');
  water(farm, 0, 0, T0 + 10 * MIN);
  evaluateFarm(farm, T0 + 10 * MIN + 30_000);
  const speed = speedOf(farm, 0, plotAt(farm, 0, 0));
  assert.equal(plotAt(farm, 0, 0).progressMs, 30_000 * speed);
});

test('dry soil pauses growth — and nothing wilts while it waits', () => {
  const { farm } = planted(PINEAPPLE, 5);
  const plot = plotAt(farm, 0, 5);
  plot.wateredUntilMs = T0 + HOUR;              // as if an old short watering ran out
  evaluateFarm(farm, T0 + 5 * DAY);
  const banked = plot.progressMs;
  assert.ok(banked > 0 && banked < stageMsOf(plot));
  evaluateFarm(farm, T0 + 50 * DAY);
  assert.equal(plot.progressMs, banked, 'dry ground kept growing');
  assert.equal(plot.level, PINEAPPLE, 'something wilted');
  assert.ok(needsWater(farm, 0, 5, T0 + 50 * DAY));
});

test('one watering always sees the current stage through, however slow the spot', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const { farm, col } = planted(level, 0);
    const wall = wallStage(farm, 0, col);
    evaluateFarm(farm, T0 + wall + 1000);
    assert.ok(isRipe(plotAt(farm, 0, col)), `level ${level} needed a second watering`);
  }
});

test('a week away leaves everything ripe and nothing hoarded', () => {
  const { farm } = planted(CHERRY, 2);
  evaluateFarm(farm, T0 + 7 * DAY);
  const tree = plotAt(farm, 0, 2);
  assert.ok(isRipe(tree));
  assert.equal(tree.progressMs, stageMsOf(tree), 'a tree banked a second crop behind the first');
  const got = harvest(farm, 0, 2, T0 + 7 * DAY);
  assert.equal(got.count, fitOf(farm, 0, 2, CHERRY, tree).yield);
});

test('a sprinkler waters its own terrace forever, and only its own', () => {
  const farm = makeFarm();
  addTerrace(farm, T0);
  plant(farm, 0, 0, STRAWBERRY, T0);
  plant(farm, 1, 0, STRAWBERRY, T0);
  installSprinkler(farm, 1, T0);
  evaluateFarm(farm, T0 + DAY);
  assert.ok(isRipe(plotAt(farm, 1, 0)));
  assert.equal(plotAt(farm, 0, 0).progressMs, 0);
  assert.ok(!needsWater(farm, 1, 0, T0));
  assert.ok(!water(farm, 1, 0, T0), 'watered a sprinklered plot');
});

test('irrigation waters the mountain, including terraces bought later', () => {
  const farm = makeFarm();
  installIrrigation(farm, T0);
  addTerrace(farm, T0);
  plant(farm, 1, 3, STRAWBERRY, T0);
  evaluateFarm(farm, T0 + DAY);
  assert.ok(isRipe(plotAt(farm, 1, 3)));
  assert.ok(!installIrrigation(farm, T0), 'irrigated twice');
  assert.ok(!installSprinkler(farm, 0, T0), 'a sprinkler on an irrigated farm');
});

test('equipment does not retroactively water the dry stretch before it', () => {
  const farm = makeFarm();
  plant(farm, 0, 0, PINEAPPLE, T0);
  installSprinkler(farm, 0, T0 + 5 * HOUR);
  evaluateFarm(farm, T0 + 6 * HOUR);
  const speed = speedOf(farm, 0, plotAt(farm, 0, 0));
  assert.equal(plotAt(farm, 0, 0).progressMs, HOUR * speed, 'the dry five hours were watered after the fact');
});

test('watering again can only extend the window, never cut it short', () => {
  const { farm } = planted(PINEAPPLE, 0);
  const until = plotAt(farm, 0, 0).wateredUntilMs;
  water(farm, 0, 0, T0 + MIN);
  assert.ok(plotAt(farm, 0, 0).wateredUntilMs >= until);
});

test('a tree matures once, then fruits on its cycle forever', () => {
  const { farm } = planted(APPLE, 0);
  const first = wallStage(farm, 0, 0);
  evaluateFarm(farm, T0 + first);
  assert.ok(isRipe(plotAt(farm, 0, 0)));
  let t = T0 + first;
  assert.ok(harvest(farm, 0, 0, t));
  const tree = plotAt(farm, 0, 0);
  assert.ok(tree.mature);
  assert.equal(stageMsOf(tree), cycleOf(APPLE));
  for (let i = 0; i < 3; i++) {
    water(farm, 0, 0, t);
    t += wallStage(farm, 0, 0);
    evaluateFarm(farm, t);
    assert.ok(isRipe(tree), `cycle ${i}`);
    assert.ok(harvest(farm, 0, 0, t));
  }
  assert.equal(plotAt(farm, 0, 0), tree, 'the tree went somewhere');
});

test('an annual is gone at its harvest and leaves bare ground', () => {
  const { farm } = planted(WATERMELON, 2);
  evaluateFarm(farm, T0 + 2 * DAY);
  const got = harvest(farm, 0, 2, T0 + 2 * DAY);
  assert.equal(got.level, WATERMELON);
  assert.ok(got.count >= yieldOf(WATERMELON));
  assert.equal(plotAt(farm, 0, 2), null);
  assert.equal(plotAt(farm, 0, 3), null);
  assert.equal(bareTiles(farm).length, COLS);
});

test('harvesting unripe or bare ground takes nothing', () => {
  const { farm } = planted(STRAWBERRY, 0);
  assert.equal(harvest(farm, 0, 0, T0), null);
  assert.equal(harvest(farm, 0, 4, T0), null);
});

// ── the lie of the land ────────────────────────────────────────────────────
// Where something stands changes how fast it grows and how much it bears —
// and never whether it grows at all.

test('the same crop grows faster in a spot it likes', () => {
  // strawberries like wet hillside: the stream tiles beat the far dry end
  const farm = makeFarm();
  plant(farm, 0, 0, STRAWBERRY, T0);
  plant(farm, 0, 5, STRAWBERRY, T0);
  const wet = fitOf(farm, 0, 0, STRAWBERRY, plotAt(farm, 0, 0));
  const dry = fitOf(farm, 0, 5, STRAWBERRY, plotAt(farm, 0, 5));
  assert.ok(wet.grade > dry.grade);
  assert.ok(speedOf(farm, 0, plotAt(farm, 0, 0)) > speedOf(farm, 0, plotAt(farm, 0, 5)));
  water(farm, 0, 0, T0);
  water(farm, 0, 5, T0);
  assert.ok(msUntilRipeAt(farm, 0, 0, T0) < msUntilRipeAt(farm, 0, 5, T0));
});

test('the worst spot on the mountain is slower, never barren', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    for (let col = 0; col + spanOf(level) <= COLS; col++) {
      const farm = makeFarm();
      plant(farm, 0, col, level, T0);
      const fit = fitOf(farm, 0, col, level, plotAt(farm, 0, col));
      assert.ok(fit.speed > 0.5, `level ${level} at ${col} grows at ${fit.speed}`);
      assert.ok(fit.yield >= yieldOf(level), `level ${level} at ${col} bears less than the table`);
    }
  }
});

test('a pond wets the ground either side of it, wherever it is dug', () => {
  const farm = makeFarm();
  plant(farm, 0, 4, STRAWBERRY, T0);
  const before = fitOf(farm, 0, 4, STRAWBERRY, plotAt(farm, 0, 4));
  assert.equal(before.moisture, 'dry');
  placeStructure(farm, 0, 5, 'pond', T0);
  const after = fitOf(farm, 0, 4, STRAWBERRY, plotAt(farm, 0, 4));
  assert.equal(after.moisture, 'wet');
  assert.ok(after.speed > before.speed);
});

test('a beehive makes its neighbours bear more, and compost makes them grow faster', () => {
  const farm = makeFarm();
  plant(farm, 0, 0, CHERRY, T0);                 // cherry: ten to a harvest
  const plain = fitOf(farm, 0, 0, CHERRY, plotAt(farm, 0, 0));
  placeStructure(farm, 0, 2, 'beehive', T0);
  const bees = fitOf(farm, 0, 0, CHERRY, plotAt(farm, 0, 0));
  assert.ok(bees.bees);
  assert.ok(bees.yield > plain.yield, 'the bees did nothing');
  assert.equal(bees.speed, plain.speed, 'bees made it grow faster rather than bear more');

  const f2 = makeFarm();
  plant(f2, 0, 0, STRAWBERRY, T0);
  const slow = speedOf(f2, 0, plotAt(f2, 0, 0));
  placeStructure(f2, 0, 1, 'compost', T0);
  assert.ok(speedOf(f2, 0, plotAt(f2, 0, 0)) > slow, 'compost did nothing');
  // and only next door: two tiles away it is out of reach
  const f3 = makeFarm();
  plant(f3, 0, 0, STRAWBERRY, T0);
  placeStructure(f3, 0, 2, 'compost', T0);
  assert.equal(speedOf(f3, 0, plotAt(f3, 0, 0)), slow);
});

test('a different crop next door grows a little faster than a row of the same', () => {
  const same = makeFarm();
  plant(same, 0, 0, STRAWBERRY, T0);
  plant(same, 0, 1, STRAWBERRY, T0);
  const mixed = makeFarm();
  plant(mixed, 0, 0, STRAWBERRY, T0);
  plant(mixed, 0, 1, GRAPE, T0);
  assert.ok(speedOf(mixed, 0, plotAt(mixed, 0, 0)) > speedOf(same, 0, plotAt(same, 0, 0)));
});

test('a new neighbour speeds a plant up from now on, never retroactively', () => {
  const { farm } = planted(PINEAPPLE, 0);
  const plot = plotAt(farm, 0, 0);
  const before = speedOf(farm, 0, plot);
  placeStructure(farm, 0, 1, 'compost', T0 + HOUR);
  evaluateFarm(farm, T0 + 2 * HOUR);
  const after = speedOf(farm, 0, plot);
  assert.ok(after > before);
  assert.ok(Math.abs(plot.progressMs - (HOUR * before + HOUR * after)) < 1,
    'the hour before the compost arrived was credited at the compost speed');
});

// ── tearing down and laying out again ──────────────────────────────────────

test('digging something up hands back what it was, and leaves bare ground', () => {
  const { farm } = planted(APPLE, 2);
  const dug = dig(farm, 0, 3, T0 + MIN);          // either of its tiles will do
  assert.deepEqual(dug, { kind: 'tree', level: APPLE, harvested: null });
  assert.equal(plotAt(farm, 0, 2), null);
  assert.equal(plotAt(farm, 0, 3), null);
  placeStructure(farm, 0, 0, 'beehive', T0);
  assert.deepEqual(dig(farm, 0, 0, T0), { kind: 'beehive', level: 0, harvested: null });
  assert.equal(dig(farm, 0, 5, T0), null, 'dug up bare ground');
});

test('digging up a ripe crop picks it first — nothing is ever lost', () => {
  const { farm } = planted(STRAWBERRY, 0);
  evaluateFarm(farm, T0 + DAY);
  const dug = dig(farm, 0, 0, T0 + DAY);
  assert.equal(dug.level, STRAWBERRY);
  assert.equal(dug.harvested.level, STRAWBERRY);
  assert.ok(dug.harvested.count >= yieldOf(STRAWBERRY));
});

test('moving a grown tree keeps it grown, mid-cycle and watered', () => {
  const { farm } = planted(APPLE, 0);
  let t = T0 + wallStage(farm, 0, 0);
  evaluateFarm(farm, t);
  harvest(farm, 0, 0, t);
  water(farm, 0, 0, t);
  t += 10 * MIN;
  evaluateFarm(farm, t);
  const tree = plotAt(farm, 0, 0);
  const banked = tree.progressMs;
  const watered = tree.wateredUntilMs;
  assert.equal(move(farm, 0, 0, 0, 4, t), 4);
  assert.equal(plotAt(farm, 0, 0), null);
  assert.equal(plotAt(farm, 0, 4), tree);
  assert.equal(plotAt(farm, 0, 5), tree);
  assert.ok(tree.mature, 'moving it un-grew it');
  assert.equal(tree.progressMs, banked);
  assert.equal(tree.wateredUntilMs, watered);
});

test('things move between terraces, and refuse to land on each other', () => {
  const farm = makeFarm();
  addTerrace(farm, T0);
  plant(farm, 0, 0, APPLE, T0);
  plant(farm, 1, 1, STRAWBERRY, T0);
  assert.equal(move(farm, 0, 0, 1, 0, T0), null, 'a tree landed on a strawberry');
  assert.equal(move(farm, 0, 0, 1, 2, T0), 2);
  assert.equal(plotAt(farm, 1, 3).level, APPLE);
  assert.equal(farm.terraces[0].plots.length, 0);
  assert.equal(move(farm, 1, 2, 1, 2, T0), null, 'moving onto itself counted as a move');
  // overlapping its own old footprint is fine: it is moving out of the way
  assert.equal(move(farm, 1, 2, 1, 3, T0), 3);
  assert.equal(move(farm, 0, 0, 5, 0, T0), null, 'moved onto a terrace nobody owns');
});

test('a whole terrace can be cleared and laid out again from scratch', () => {
  const farm = makeStarterFarm(T0);
  placeStructure(farm, 0, 5, 'beehive', T0);
  const back = [];
  while (farm.terraces[0].plots.length) back.push(dig(farm, 0, farm.terraces[0].plots[0].col, T0));
  assert.equal(bareTiles(farm).length, COLS);
  assert.deepEqual(back.map((d) => d.kind).sort(), ['bed', 'beehive', 'tree']);
  for (let col = 0; col < COLS; col++) assert.ok(plant(farm, 0, col, STRAWBERRY, T0));
});

// ── fertilizer ─────────────────────────────────────────────────────────────

test('fertilizer halves what is left, and stacks', () => {
  const { farm } = planted(PINEAPPLE, 0);
  const plot = plotAt(farm, 0, 0);
  const stage = stageMsOf(plot);
  assert.ok(fertilize(farm, 0, 0, T0));
  assert.equal(plot.progressMs, stage / 2);
  assert.ok(fertilize(farm, 0, 0, T0));
  assert.equal(plot.progressMs, stage * 0.75);
});

test('fertilizer is useless on bare earth, structures and fruit already ripe', () => {
  const { farm } = planted(STRAWBERRY, 0);
  assert.ok(!fertilize(farm, 0, 5, T0));
  placeStructure(farm, 0, 4, 'compost', T0);
  assert.ok(!fertilize(farm, 0, 4, T0));
  evaluateFarm(farm, T0 + DAY);
  assert.ok(!fertilize(farm, 0, 0, T0 + DAY));
});

// ── the mountainside ───────────────────────────────────────────────────────

test('terraces are bought up the hill until the mountain runs out', () => {
  const farm = makeFarm();
  for (let i = 1; i < MAX_TERRACES; i++) {
    assert.equal(nextTerraceIndex(farm), i);
    assert.ok(addTerrace(farm, T0));
  }
  assert.equal(nextTerraceIndex(farm), null);
  assert.ok(!addTerrace(farm, T0));
  assert.equal(farm.terraces.length, MAX_TERRACES);
  assert.equal(bareTiles(farm).length, MAX_TERRACES * COLS);
});

test('the soonest ripening is the plot still on its way, at its own speed', () => {
  const farm = makeFarm();
  plant(farm, 0, 0, STRAWBERRY, T0);
  plant(farm, 0, 2, APPLE, T0);
  water(farm, 0, 0, T0);
  water(farm, 0, 2, T0);
  const s = soonestRipening(farm, T0);
  assert.deepEqual(s, { ti: 0, col: 0, ms: msUntilRipeAt(farm, 0, 0, T0) });
  assert.equal(msUntilNextRipe(farm, T0), s.ms);
  evaluateFarm(farm, T0 + s.ms);
  assert.equal(ripeCount(farm), 1);
  assert.equal(msUntilNextRipe(farm, T0 + s.ms), 0);
  assert.equal(soonestRipening(farm, T0 + s.ms).col, 2, 'a ripe plot counted as next');
});

test('a plot nobody watered is not on its way to anything', () => {
  const farm = makeFarm();
  plant(farm, 0, 0, STRAWBERRY, T0);
  assert.equal(msUntilRipeAt(farm, 0, 0, T0), null);
  assert.equal(soonestRipening(farm, T0), null);
  assert.equal(msUntilNextRipe(farm, T0), null);
});

test('a clock that jumps backwards earns nothing and cannot rewind the plot', () => {
  const { farm } = planted(PINEAPPLE, 0);
  evaluateFarm(farm, T0 + HOUR);
  const plot = plotAt(farm, 0, 0);
  const banked = plot.progressMs;
  evaluateFarm(farm, T0 - DAY);
  assert.equal(plot.progressMs, banked);
  assert.equal(plot.lastEvalMs, T0 + HOUR);
});

test('a nonsense clock is ignored rather than propagated into the save', () => {
  const { farm } = planted(STRAWBERRY, 0);
  for (const junk of [NaN, Infinity, undefined, 'soon']) evaluateFarm(farm, junk);
  const s = serialize(farm);
  assert.ok(Number.isFinite(s.terraces[0].plots[0].lastEvalMs));
  assert.ok(Number.isFinite(s.terraces[0].plots[0].progressMs));
});

// ── save / restore ─────────────────────────────────────────────────────────

test('a farm round-trips through a save unchanged', () => {
  const farm = makeStarterFarm(T0);
  addTerrace(farm, T0);
  plant(farm, 1, 0, GRAPE, T0);
  placeStructure(farm, 1, 1, 'beehive', T0);
  plant(farm, 1, 3, WATERMELON, T0);
  installSprinkler(farm, 1, T0);
  evaluateFarm(farm, T0 + 20 * MIN);
  const s = serialize(farm);
  assert.deepEqual(serialize(restore(JSON.parse(JSON.stringify(s)))), s);
});

test('a mid-cycle mature tree comes back mid-cycle, not re-planted', () => {
  const { farm } = planted(APPLE, 0);
  let t = T0 + wallStage(farm, 0, 0);
  evaluateFarm(farm, t);
  harvest(farm, 0, 0, t);
  const back = restore(serialize(farm));
  assert.ok(plotAt(back, 0, 0).mature);
  assert.equal(stageMsOf(plotAt(back, 0, 0)), cycleOf(APPLE));
});

test('a save from another game, or no save at all, restores nothing', () => {
  for (const junk of [null, undefined, {}, { v: 99, terraces: [] }, { v: 2 }, { v: 2, terraces: [] }]) {
    assert.equal(restore(junk), null, JSON.stringify(junk));
  }
  assert.equal(restore({ v: 2, terraces: new Array(MAX_TERRACES + 1).fill({}) }), null);
});

test('a hostile save yields bare earth, never an impossible plant', () => {
  const plots = [
    { col: 0, kind: 'tree', level: STRAWBERRY },           // a strawberry tree
    { col: 1, kind: 'bed', level: 99 },                    // a fruit that does not exist
    { col: 2, kind: 'bed', level: STRAWBERRY, progressMs: -5 },
    { col: 5, kind: 'tree', level: APPLE },                // a tree hanging off the shelf
    { col: -1, kind: 'bed', level: STRAWBERRY },
    { col: 3, kind: 'windmill' },
    'a string',
    null,
  ];
  const farm = restore({ v: 2, terraces: [{ plots }] });
  assert.ok(farm);
  const kept = farm.terraces[0].plots;
  assert.equal(kept.length, 1, `kept ${JSON.stringify(kept)}`);
  assert.equal(kept[0].col, 2);
  assert.equal(kept[0].progressMs, 0, 'negative progress was believed');
});

test('two saved plots claiming the same ground keep the first, lose the second', () => {
  const farm = restore({ v: 2, terraces: [{ plots: [
    { col: 0, kind: 'tree', level: APPLE },
    { col: 1, kind: 'bed', level: STRAWBERRY },
    { col: 1, kind: 'pond' },
    { col: 2, kind: 'pond' },
  ] }] });
  assert.equal(plotAt(farm, 0, 1).level, APPLE);
  assert.equal(plotAt(farm, 0, 2).kind, 'pond');
  assert.equal(farm.terraces[0].plots.length, 2);
});

test('a save cannot grow a plot past ripe', () => {
  const farm = restore({ v: 2, terraces: [{ plots: [
    { col: 0, kind: 'bed', level: STRAWBERRY, progressMs: 1e12, lastEvalMs: T0, wateredUntilMs: T0 },
  ] }] });
  assert.equal(plotAt(farm, 0, 0).progressMs, growthOf(STRAWBERRY));
});

// Players who farmed before the mountain went free-form come back to the same
// crops in the same left-to-right order, with their growth intact.
test('a version-1 farm is carried forward with every crop where it was', () => {
  const v1 = {
    v: 1, irrigation: false,
    terraces: [
      { sprinkler: true, plots: [
        { slot: 'tree', trellis: false, kind: 'tree', level: CHERRY, progressMs: 1000, lastEvalMs: T0, wateredUntilMs: T0 + HOUR, mature: true },
        { slot: 'bed', trellis: false, kind: 'bed', level: STRAWBERRY, progressMs: 2000, lastEvalMs: T0, wateredUntilMs: 0, mature: false },
        { slot: 'bed', trellis: false, kind: null, level: 0, progressMs: 0, lastEvalMs: T0, wateredUntilMs: 0, mature: false },
        { slot: 'bed', trellis: false, kind: 'bed', level: PINEAPPLE, progressMs: 3000, lastEvalMs: T0, wateredUntilMs: 0, mature: false },
      ] },
      { sprinkler: false, plots: [
        { slot: 'tree', trellis: true, kind: 'vine', level: GRAPE, progressMs: 0, lastEvalMs: T0, wateredUntilMs: 0, mature: false },
        { slot: 'bed' }, { slot: 'bed' }, { slot: 'bed' },
      ] },
    ],
  };
  const farm = restore(v1);
  assert.ok(farm, 'a v1 farm was thrown away');
  assert.equal(farm.terraces.length, 2);
  assert.ok(farm.terraces[0].sprinkler);
  const tree = plotAt(farm, 0, 0);
  assert.equal(tree.level, CHERRY);
  assert.ok(tree.mature);
  assert.equal(tree.progressMs, 1000);
  assert.equal(plotAt(farm, 0, 1), tree);
  assert.equal(plotAt(farm, 0, 2).level, STRAWBERRY);
  assert.equal(plotAt(farm, 0, 2).progressMs, 2000);
  assert.equal(plotAt(farm, 0, 3), null);
  assert.equal(plotAt(farm, 0, 4).level, PINEAPPLE);
  assert.equal(plotAt(farm, 1, 0).level, GRAPE);
  assert.equal(serialize(farm).v, 2);
});

test('every plot in a restored farm is a legal plot the host can act on', () => {
  const farm = makeStarterFarm(T0);
  addTerrace(farm, T0);
  plant(farm, 1, 4, APPLE, T0);
  placeStructure(farm, 1, 0, 'pond', T0);
  const back = restore(JSON.parse(JSON.stringify(serialize(farm))));
  evaluateFarm(back, T0 + DAY);
  for (const { ti, col, plot } of eachPlot(back)) {
    assert.equal(plotAt(back, ti, col), plot);
    assert.ok(col >= 0 && col + plot.span <= COLS);
    if (isPlant(plot)) assert.equal(plot.kind, farmOf(plot.level).kind);
    else assert.ok(STRUCTURE_KINDS.includes(plot.kind));
  }
});

test('evaluatePlot on its own is the same rule the farm applies', () => {
  const plot = { col: 0, span: 1, kind: 'bed', level: STRAWBERRY, progressMs: 0, lastEvalMs: T0, wateredUntilMs: T0 + MIN, mature: false };
  evaluatePlot(plot, T0 + 2 * MIN, false, 2);
  assert.equal(plot.progressMs, Math.min(2 * MIN, growthOf(STRAWBERRY)));
});

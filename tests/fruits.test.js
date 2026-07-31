// The fruit table IS the game spec — pin it so a casual edit can't silently
// reshape scoring or sizes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRUITS, FACES, MAX_LEVEL, MAX_SPAWN_LEVEL, ANNIHILATE_SCORE, radiusOf, scoreOf, bounceOf, WORLD,
  FARM, TUNING, PINEAPPLE_LEVEL, MAX_TERRACES, farmOf, isPerennial, needsTrellis, seedCostOf, yieldOf,
} from '../js/constants.js';

test('eleven fruit levels, cherry through watermelon', () => {
  assert.equal(MAX_LEVEL, 11);
  assert.equal(FRUITS[0].name, 'Cherry');
  assert.equal(FRUITS[10].name, 'Watermelon');
});

test('scores double up the chain: 1,2,4,...,1024; annihilation continues it', () => {
  FRUITS.forEach((f, i) => assert.equal(f.score, 2 ** i, f.name));
  assert.equal(ANNIHILATE_SCORE, 2048);
});

test('radii grow strictly and follow the GRD relative scale', () => {
  const expected = [1.0, 1.4, 1.8, 2.2, 2.6, 3.0, 3.5, 4.0, 4.6, 5.2, 6.0];
  FRUITS.forEach((f, i) => assert.equal(f.scale, expected[i], f.name));
  for (let l = 2; l <= MAX_LEVEL; l++) assert.ok(radiusOf(l) > radiusOf(l - 1));
});

test('every fruit has a bounce personality; big fruit never out-bounces small', () => {
  FRUITS.forEach((f) => {
    assert.equal(typeof f.bounce, 'number', f.name);
    assert.ok(f.bounce > 0 && f.bounce < 1, `${f.name} bounce ${f.bounce} in (0,1)`);
    assert.equal(bounceOf(FRUITS.indexOf(f) + 1), f.bounce);
  });
  for (let l = 2; l <= MAX_LEVEL; l++) {
    assert.ok(bounceOf(l) <= bounceOf(l - 1), `${FRUITS[l - 1].name} is not bouncier than its parent`);
  }
  assert.ok(bounceOf(1) > bounceOf(MAX_LEVEL) * 2, 'the cherry/watermelon contrast is legible');
});

test('every fruit carries its whole palette — the painter has no hex of its own', () => {
  for (const f of FRUITS) {
    for (const k of ['color', 'rind', 'face', 'accent', 'leaf']) {
      assert.match(f[k] || '', /^#[0-9a-f]{6}$/i, `${f.name}.${k} is not a #rrggbb colour`);
    }
  }
  // one row of face parameters per fruit, or a level paints a blank face
  assert.equal(FACES.length, FRUITS.length);
});

test('only levels 1-5 spawn; the watermelon fits the box with room to work', () => {
  assert.equal(MAX_SPAWN_LEVEL, 5);
  // two watermelons must be able to coexist side by side, or the ultimate
  // merge could never be set up
  assert.ok(2 * (2 * radiusOf(11)) < WORLD.width + 2 * radiusOf(11) * 0.35);
  assert.ok(scoreOf(11) === 1024);
});

// ── the farm table (campaign) ────────────────────────────────────────────────
// Structure is what's pinned here, not balance — the numbers are WP11's to
// move. What must never drift is that every fruit is growable and that growing
// one can never cost more than it can ever return.

test('every fruit is growable: one FARM row per FRUITS row', () => {
  assert.equal(FARM.length, FRUITS.length);
  FRUITS.forEach((f, i) => {
    const row = farmOf(i + 1);
    assert.ok(['bed', 'tree', 'vine'].includes(row.kind), `${f.name} has no growing kind`);
    assert.ok(Number.isInteger(row.yield) && row.yield > 0, `${f.name} yields nothing`);
    assert.ok(Number.isInteger(row.cost) && row.cost > 0, `${f.name} seed is free`);
    assert.ok(row.growthMs > 0 && isFinite(row.growthMs), `${f.name} grows in no time`);
  });
});

test('perennials cycle, annuals do not — and only the grape needs a trellis', () => {
  FRUITS.forEach((f, i) => {
    const level = i + 1;
    const row = farmOf(level);
    if (isPerennial(level)) {
      assert.ok(row.cycleMs > 0, `${f.name} is perennial but never fruits again`);
    } else {
      assert.equal(row.cycleMs, null, `${f.name} is an annual with a regrow cycle`);
    }
    assert.equal(needsTrellis(level), row.kind === 'vine');
  });
  assert.deepEqual(FRUITS.filter((_, i) => needsTrellis(i + 1)).map((f) => f.name), ['Grape']);
});

// Generosity-first, and the two halves of it are different promises: an annual
// dies at its one harvest so that harvest must clear the seed outright, while a
// perennial is capital — dear once, then free forever. Both are floors, not
// balance: the numbers move in WP11, the promise does not.
test('an annual always clears its seed in the single harvest it lives for', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    if (isPerennial(level)) continue;
    const revenue = yieldOf(level) * scoreOf(level);
    assert.ok(revenue > seedCostOf(level),
      `${FRUITS[level - 1].name}: ${revenue}元 a harvest against a ${seedCostOf(level)}元 seed`);
  }
});

test('a perennial pays its sapling back inside a handful of cycles', () => {
  const PAYBACK_LIMIT = 6;
  for (let level = 1; level <= MAX_LEVEL; level++) {
    if (!isPerennial(level)) continue;
    const harvests = seedCostOf(level) / (yieldOf(level) * scoreOf(level));
    assert.ok(harvests <= PAYBACK_LIMIT,
      `${FRUITS[level - 1].name} needs ${harvests.toFixed(1)} harvests to break even`);
  }
});

// Monotonicity is a claim WITHIN a growing kind — a tree's mature-once time and
// a bed's grow time measure different things, so the strawberry beating the
// cherry tree to ripeness is not an inversion, it is the starter crop doing its
// job. Inside each kind the chain does order itself, with one exception.
test('grow times rise with the chain, kind by kind', () => {
  const inversions = (levels) => levels.filter(
    (level, i) => i > 0 && farmOf(level).growthMs < farmOf(levels[i - 1]).growthMs);
  const byKind = { bed: [], tree: [], vine: [] };
  for (let level = 1; level <= MAX_LEVEL; level++) byKind[farmOf(level).kind].push(level);

  assert.deepEqual(inversions(byKind.tree), [], 'the orchard is out of order');
  assert.deepEqual(inversions(byKind.vine), []);
  // The one sanctioned outlier: the melon "regresses" only because the
  // pineapple above it is the joke. Excise the joke and the beds order too.
  assert.deepEqual(inversions(byKind.bed), [PINEAPPLE_LEVEL + 1],
    `unexpected bed inversions at levels ${inversions(byKind.bed).join(', ')}`);
  assert.deepEqual(inversions(byKind.bed.filter((l) => l !== PINEAPPLE_LEVEL)), []);
});

test('the pineapple is the joke it is meant to be: the longest wait on the farm', () => {
  assert.equal(FRUITS[PINEAPPLE_LEVEL - 1].name, 'Pineapple');
  for (let level = 1; level <= MAX_LEVEL; level++) {
    if (level === PINEAPPLE_LEVEL) continue;
    assert.ok(farmOf(PINEAPPLE_LEVEL).growthMs > farmOf(level).growthMs,
      `${FRUITS[level - 1].name} out-waits the pineapple, which ruins the gag`);
  }
});

test('TUNING keeps the player solvent: the first appraisal always buys the farm', () => {
  assert.ok(TUNING.firstRunFloor > TUNING.starterFarmCost,
    'the floored first run must cover the farm and leave a seed budget');
  const seedBudget = TUNING.firstRunFloor - TUNING.starterFarmCost;
  assert.ok(seedBudget >= seedCostOf(2), 'no room left to plant anything');
  // the gift crate must actually be droppable stock
  for (const [level, n] of Object.entries(TUNING.giftCrate)) {
    assert.ok(Number(level) >= 1 && Number(level) <= MAX_SPAWN_LEVEL, `gift level ${level} is not spawnable`);
    assert.ok(Number.isInteger(n) && n > 0, `gift level ${level} has no fruit`);
  }
});

test('TUNING knobs are in range, and seedDripChance can be switched clean off', () => {
  assert.ok(TUNING.seedDripChance >= 0 && TUNING.seedDripChance <= 1);
  assert.ok(TUNING.tidyBonus > 0 && TUNING.tidyBonus < 1);
  assert.ok(Number.isInteger(TUNING.plotsPerTerrace) && TUNING.plotsPerTerrace > 0);
  assert.ok(TUNING.treePlotsPerTerrace > 0 && TUNING.treePlotsPerTerrace < TUNING.plotsPerTerrace,
    'every terrace needs both a tree plot and beds');
  assert.equal(MAX_TERRACES, TUNING.terraceCosts.length);
  assert.equal(TUNING.terraceCosts[0], 0, 'terrace 1 is the starter farm, bought as a farm');
  for (let i = 2; i < TUNING.terraceCosts.length; i++) {
    assert.ok(TUNING.terraceCosts[i] > TUNING.terraceCosts[i - 1], `terrace ${i + 1} is not dearer than the last`);
  }
  assert.ok(TUNING.waterMs > 0);
  assert.ok(TUNING.irrigationCost > TUNING.sprinklerCost, 'the whole farm must cost more than one terrace');
});

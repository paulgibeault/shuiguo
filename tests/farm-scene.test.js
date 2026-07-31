// The mountainside and the plants growing on it. Both are pure painters, and
// both fail in ways that are invisible in review — a stage that only draws in
// dark theme, a plot whose hit box has drifted off the plot it belongs to. Same
// treatment as js/scene.js and js/fruit-art.js: draw against a stub and assert
// the parts that are rules rather than taste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FARM_SCENE, FARM_THEMES, farmThemeOf, terraceGeom, plotGeom, plotAtPoint, forSaleBox,
  paintFarmSky, paintRidges, paintHillside, paintTerrace, paintForSale,
  paintStream, paintFog, paintLanterns,
} from '../js/farm-scene.js';
import {
  FARM_PALETTE, PLANT, STAGES, stageOf, paintPlant, paintSoil, paintTrellis, paintGlint, describeSeed,
} from '../js/plant-art.js';
import { WORLD, TUNING, MAX_LEVEL, MAX_TERRACES, FARM } from '../js/constants.js';

const N = TUNING.plotsPerTerrace;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function stubCtx() {
  const calls = [];
  let depth = 0;
  const api = {
    calls, get depth() { return depth; },
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    save() { depth++; }, restore() { depth--; },
    translate() {}, rotate() {}, scale() {}, clip() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, arc() {}, ellipse() {}, rect() {},
    fillRect() { calls.push('fill'); }, strokeRect() { calls.push('stroke'); },
    fill() { calls.push('fill'); }, stroke() { calls.push('stroke'); },
    fillText() { calls.push('text'); }, strokeText() { calls.push('text'); },
    measureText() { return { width: 10 }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  return api;
}

// Every describable plot state: each kind at each of its stages.
function everyPlantState() {
  const out = [];
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const kind = FARM[level - 1].kind;
    for (const progress of [0, 0.1, 0.3, 0.5, 0.8, 1]) {
      for (const mature of [false, true]) {
        for (const ripe of [false, true]) out.push({ kind, level, progress, mature, ripe });
      }
    }
  }
  return out;
}

// ── the scene ──────────────────────────────────────────────────────────────

test('both themes paint a full mountainside and leave the context balanced', () => {
  for (const theme of ['light', 'dark']) {
    const ctx = stubCtx();
    const th = farmThemeOf({ theme });
    paintFarmSky(ctx, th, 400, 700);
    paintRidges(ctx, th);
    paintHillside(ctx, th);
    for (let i = 0; i < FARM_SCENE.bands; i++) paintTerrace(ctx, th, i, i < 2);
    paintStream(ctx, th, 5000, 1);
    paintFog(ctx, th, 5000, 1);
    paintLanterns(ctx, th, 5000, 1);
    paintForSale(ctx, th, 3);
    assert.ok(ctx.calls.filter((c) => c === 'fill').length > 20, `${theme} barely fills anything`);
    assert.ok(ctx.calls.includes('stroke'), `${theme} strokes nothing`);
    assert.ok(ctx.calls.includes('text'), `${theme} never writes 出售`);
    assert.equal(ctx.depth, 0, `${theme} leaks a save()`);
  }
});

test('an unknown or missing theme falls back to the morning rather than throwing', () => {
  assert.equal(farmThemeOf({ theme: 'monsoon' }), FARM_THEMES.light);
  assert.equal(farmThemeOf({}), FARM_THEMES.light);
  assert.equal(farmThemeOf(undefined), FARM_THEMES.light);
  assert.equal(farmThemeOf({ theme: 'dark' }), FARM_THEMES.dark);
});

test('every theme defines every colour the painters reach for', () => {
  const keys = Object.keys(FARM_THEMES.light);
  for (const [name, th] of Object.entries(FARM_THEMES)) {
    for (const k of keys) assert.ok(k in th, `${name} theme is missing ${k}`);
    assert.equal(th.sky.length, 2, `${name} sky needs two stops`);
  }
});

test('only the evening farm is lantern-lit', () => {
  assert.equal(FARM_THEMES.light.lantern, null);
  assert.ok(FARM_THEMES.dark.lantern);
  const day = stubCtx();
  paintLanterns(day, FARM_THEMES.light, 5000, 1);
  assert.equal(day.calls.length, 0, 'lanterns burning at breakfast');
});

test('the whole mountain fits the world with sky to spare — the farm never scrolls', () => {
  const bottom = terraceGeom(0);
  const top = terraceGeom(FARM_SCENE.bands - 1);
  assert.ok(bottom.groundY + FARM_SCENE.wallH <= WORLD.height,
    'the bottom terrace hangs off the world');
  assert.ok(top.groundY - FARM_SCENE.plantH > 0, 'the top terrace grows off the top of the sky');
  assert.equal(FARM_SCENE.bands, MAX_TERRACES, 'the mountain and the shop disagree on how many terraces exist');
});

test('terraces stack upward and narrow with distance', () => {
  for (let i = 1; i < FARM_SCENE.bands; i++) {
    const below = terraceGeom(i - 1);
    const here = terraceGeom(i);
    assert.ok(here.groundY < below.groundY, `terrace ${i} is not above terrace ${i - 1}`);
    assert.ok(here.width < below.width, `terrace ${i} is not narrower than terrace ${i - 1}`);
  }
  assert.ok(terraceGeom(FARM_SCENE.bands - 1).width > 120, 'the top terrace is too narrow to farm');
});

test('plots tile their terrace without overlapping or spilling off it', () => {
  for (let ti = 0; ti < FARM_SCENE.bands; ti++) {
    const t = terraceGeom(ti);
    let prevRight = -Infinity;
    for (let pi = 0; pi < N; pi++) {
      const g = plotGeom(ti, pi, N);
      assert.ok(g.w > 0, `terrace ${ti} plot ${pi} has no width`);
      assert.ok(g.cx - g.w / 2 >= t.left - 0.01, `terrace ${ti} plot ${pi} spills off the left`);
      assert.ok(g.cx + g.w / 2 <= t.right + 0.01, `terrace ${ti} plot ${pi} spills off the right`);
      assert.ok(g.cx - g.w / 2 >= prevRight - 0.01, `terrace ${ti} plots ${pi - 1} and ${pi} overlap`);
      prevRight = g.cx + g.w / 2;
      assert.equal(g.groundY, t.groundY);
      assert.ok(g.h > 0);
    }
  }
});

test('a plot is big enough to hit with a thumb, even at the top of the mountain', () => {
  // the world is 360 units across a phone's ~390 CSS px, so a world unit is
  // roughly a pixel and change — 44 units clears the 44px touch-target floor
  const smallest = plotGeom(FARM_SCENE.bands - 1, 0, N);
  assert.ok(smallest.w >= 44, `the top terrace's plots are only ${smallest.w.toFixed(0)} units wide`);
});

test('tapping a plot finds the plot that was drawn there, and nothing else', () => {
  for (let ti = 0; ti < FARM_SCENE.bands; ti++) {
    for (let pi = 0; pi < N; pi++) {
      const g = plotGeom(ti, pi, N);
      // the strip itself, and the airspace above it where the plant is drawn
      for (const y of [g.groundY - 1, g.groundY - FARM_SCENE.plantH]) {
        assert.deepEqual(plotAtPoint(g.cx, y, FARM_SCENE.bands, N), { ti, pi },
          `a tap at (${g.cx.toFixed(0)}, ${y.toFixed(0)}) missed terrace ${ti} plot ${pi}`);
      }
    }
  }
  // the sky above the mountain and the road below it belong to nobody
  assert.equal(plotAtPoint(180, 4, FARM_SCENE.bands, N), null);
  assert.equal(plotAtPoint(180, WORLD.height - 2, FARM_SCENE.bands, N), null);
  // and an unbought terrace is not tappable as a plot
  assert.equal(plotAtPoint(plotGeom(3, 0, N).cx, terraceGeom(3).groundY - 1, 2, N), null);
});

test('the 出售 sign sits on the terrace it is selling, and reports its own hit box', () => {
  for (let i = 1; i < FARM_SCENE.bands; i++) {
    const painted = paintForSale(stubCtx(), FARM_THEMES.light, i);
    assert.deepEqual(painted, forSaleBox(i), 'the sign is drawn somewhere other than its hit box');
    const t = terraceGeom(i);
    assert.ok(painted.x >= t.left && painted.x + painted.w <= t.right, `sign ${i} hangs off its terrace`);
    assert.ok(painted.y + painted.h <= t.groundY, `sign ${i} is buried in the wall`);
    assert.ok(painted.w >= 44 && painted.h >= 28, 'the sign is too small to tap');
  }
});

test('an unbought terrace is visibly the same terrace, gone to seed', () => {
  const bought = stubCtx(); paintTerrace(bought, FARM_THEMES.light, 2, true);
  const weedy = stubCtx(); paintTerrace(weedy, FARM_THEMES.light, 2, false);
  assert.ok(bought.calls.length > 0 && weedy.calls.length > 0);
  assert.ok(weedy.calls.filter((c) => c === 'stroke').length >
    bought.calls.filter((c) => c === 'stroke').length, 'the weeds never grew');
});

test('the ambient layers hold perfectly still under reduced motion', () => {
  for (const paint of [paintFog, paintStream]) {
    const a = stubCtx(); paint(a, FARM_THEMES.light, 0, 0);
    const b = stubCtx(); paint(b, FARM_THEMES.light, 987654, 0);
    assert.deepEqual(a.calls, b.calls, `${paint.name} drifted under reduced motion`);
    const moving = stubCtx(); paint(moving, FARM_THEMES.light, 987654, 1);
    assert.ok(moving.calls.length >= a.calls.length, `${paint.name} draws less when it is allowed to move`);
  }
  // the water still reads as water when it cannot shimmer
  const still = stubCtx();
  paintStream(still, FARM_THEMES.light, 0, 0);
  assert.ok(still.calls.includes('fill'));
});

// ── the plants ─────────────────────────────────────────────────────────────

test('every fruit at every stage in both themes paints without throwing', () => {
  let painted = 0;
  for (const desc of everyPlantState()) {
    for (const motion of [0, 1]) {
      const ctx = stubCtx();
      paintSoil(ctx, 40, 8, { wet: motion === 1 });
      if (desc.kind === 'vine') paintTrellis(ctx, 40, 46);
      const stage = paintPlant(ctx, desc, 46, { tMs: 5000, motion });
      assert.ok(STAGES.includes(stage), `unknown stage ${stage}`);
      assert.equal(ctx.depth, 0, `level ${desc.level} at ${stage} leaks a save()`);
      assert.ok(ctx.calls.length > 0, `level ${desc.level} at ${stage} drew nothing at all`);
      painted++;
    }
  }
  assert.ok(painted > 200, `only ${painted} plant states were exercised`);
});

test('bare ground draws no plant, and says so', () => {
  const ctx = stubCtx();
  assert.equal(paintPlant(ctx, { kind: null, level: 0 }, 46, {}), 'empty');
  assert.equal(paintPlant(ctx, null, 46, {}), 'empty');
  assert.equal(ctx.calls.length, 0, 'something grew on nothing');
});

test('a plant only gets bigger as it grows, and only carries fruit when ripe', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const kind = FARM[level - 1].kind;
    const perennial = kind !== 'bed';
    const at = (progress, mature, ripe) => stageOf({ kind, level, progress, mature, ripe });

    if (perennial) {
      assert.equal(at(0, false, false), 'seed');
      assert.equal(at(0.3, false, false), 'sapling');
      assert.equal(at(0.9, false, false), 'young');
      // a mature tree between crops is a full tree, however far into the cycle
      assert.equal(at(0, true, false), 'grown');
      assert.equal(at(0.9, true, false), 'grown');
    } else {
      assert.equal(at(0, false, false), 'seed');
      assert.equal(at(0.3, false, false), 'sprout');
      assert.equal(at(0.9, false, false), 'grown');
    }
    // ripe outranks everything: it is the state the player has to notice
    for (const mature of [false, true]) assert.equal(at(0, mature, true), 'ripe');
  }
});

test('a nonsense description is drawn as something rather than crashing', () => {
  for (const junk of [
    { kind: 'bed', level: 0, progress: NaN, ripe: true },
    { kind: 'tree', level: 999, progress: -5, mature: true, ripe: true },
    { kind: 'vine', level: null, progress: 'lots', ripe: true },
    { kind: 'bed', level: 2.5, progress: Infinity, ripe: false },
  ]) {
    const ctx = stubCtx();
    const stage = paintPlant(ctx, junk, 46, { tMs: 0, motion: 1 });
    assert.ok(STAGES.includes(stage));
    assert.equal(ctx.depth, 0);
  }
});

test('the glint is how ripe is announced, and it stays lit under reduced motion', () => {
  const a = stubCtx(); paintGlint(a, 46, 0, 0);
  const b = stubCtx(); paintGlint(b, 46, 12345, 0);
  assert.deepEqual(a.calls, b.calls, 'the glint twinkled under reduced motion');
  assert.ok(a.calls.includes('fill'), 'the glint went out under reduced motion');
  const moving = stubCtx(); paintGlint(moving, 46, 12345, 1);
  assert.ok(moving.calls.includes('fill'));
  assert.ok(PLANT.glintMs > 0);
});

test('nothing but a ripe plant glints', () => {
  const bare = { kind: 'bed', level: 2, progress: 0.9, ripe: false };
  const ripe = { ...bare, ripe: true };
  const dull = stubCtx(); paintPlant(dull, bare, 46, { tMs: 0, motion: 1 });
  const lit = stubCtx(); paintPlant(lit, ripe, 46, { tMs: 0, motion: 1 });
  assert.ok(lit.calls.length > dull.calls.length, 'a ripe plant looks no different');
});

test('watering leaves a mark: wet soil is drawn differently from dry', () => {
  const dry = stubCtx(); paintSoil(dry, 40, 8, { wet: false });
  const wet = stubCtx(); paintSoil(wet, 40, 8, { wet: true });
  assert.deepEqual(dry.calls, wet.calls, 'wet soil should differ in colour, not in geometry');
  assert.notEqual(FARM_PALETTE.mound, FARM_PALETTE.moundWet);
});

test('the shop can describe a seed it has no plot for', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const desc = describeSeed(level);
    assert.equal(desc.level, level);
    assert.equal(desc.kind, FARM[level - 1].kind);
    assert.equal(stageOf(desc), 'ripe', 'the shop should show the seed at its best');
  }
  assert.equal(describeSeed(999).level, 1, 'a nonsense seed still previews something');
});

// ── the palette rule ───────────────────────────────────────────────────────

test('the plant painter has no colour of its own outside FARM_PALETTE', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/plant-art.js'), 'utf8');
  const table = src.slice(src.indexOf('FARM_PALETTE = {'), src.indexOf('};', src.indexOf('FARM_PALETTE = {')));
  const known = new Set(Object.values(FARM_PALETTE).map((c) => c.toLowerCase()));
  for (const m of src.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    if (table.includes(m[0])) continue;
    assert.ok(known.has(m[0].toLowerCase()), `js/plant-art.js paints with a loose hex literal ${m[0]}`);
  }
});

test('the mountainside has no colour of its own outside FARM_THEMES', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/farm-scene.js'), 'utf8');
  const end = src.indexOf('export function farmThemeOf');
  const table = src.slice(0, end);
  for (const m of src.slice(end).matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    assert.ok(table.includes(m[0]), `js/farm-scene.js paints with a loose hex literal ${m[0]}`);
  }
});

// The plants, the ground they stand in, and the furniture between them. All
// pure painters, and all fail in ways that are invisible in review — a stage
// that leaks a save(), a sway that keeps going under reduced motion, a colour
// that slipped in from outside the palette. Same treatment as js/scene.js and
// js/fruit-art.js: draw against a stub and assert the parts that are rules
// rather than taste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FARM_PALETTE, PLANT, STAGES, stageOf, paintPlant, paintSoil, paintTrellis, paintGlint,
  paintProgressRing, paintCountdown, paintPlantHint, describeSeed, paintStructure, paintFitBadge,
} from '../js/plant-art.js';
import { MAX_LEVEL, FARM, STRUCTURE_KINDS } from '../js/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The drawing state a real context saves and restores. Modelled here because
// leaking one of these is the classic canvas bug and it is invisible in review:
// a painter that dims itself and forgets to put globalAlpha back dims whatever
// is drawn after it, on a screen that may not be the one being worked on.
const STATE = ['globalAlpha', 'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap',
  'font', 'textAlign', 'textBaseline'];

function stubCtx() {
  const calls = [];
  const fills = [];          // the fillStyle of every fill, for colour assertions
  const stack = [];
  const api = {
    calls, fills, get depth() { return stack.length; },
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    save() { stack.push(STATE.map((k) => api[k])); },
    restore() {
      const was = stack.pop();
      if (was) STATE.forEach((k, i) => { api[k] = was[i]; });
    },
    translate() {}, rotate() {}, scale() {}, clip() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, arc() {}, ellipse() {}, rect() {},
    fillRect() { calls.push('fill'); }, strokeRect() { calls.push('stroke'); },
    fill() { calls.push('fill'); fills.push(api.fillStyle); }, stroke() { calls.push('stroke'); },
    fillText() { calls.push('text'); }, strokeText() { calls.push('text'); },
    measureText() { return { width: 10 }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  return api;
}

// A context that records every path coordinate as well, for the "it moved"
// questions a call list cannot answer.
function tracingCtx() {
  const ctx = stubCtx();
  const trace = [];
  for (const k of ['translate', 'rotate', 'scale', 'moveTo', 'lineTo', 'quadraticCurveTo',
    'bezierCurveTo', 'arc', 'ellipse', 'rect']) {
    ctx[k] = (...a) => { trace.push(k, ...a.map((v) => Math.round(v * 1000) / 1000)); };
  }
  ctx.trace = trace;
  return ctx;
}

// The progress values that land a description on each stage it can show.
const BED_STAGES = { seed: [0.05], sprout: [0.3], grown: [0.6], bloom: [0.9] };
const PERENNIAL_STAGES = { seed: [0.05], sapling: [0.3], young: [0.6], bloom: [0.9] };

// Every describable plot state: each kind at each of its stages, at both spans
// and with and without an explicit width budget.
function everyPlantState() {
  const out = [];
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const { kind, span } = FARM[level - 1];
    for (const progress of [0, 0.1, 0.3, 0.5, 0.6, 0.8, 1]) {
      for (const mature of [false, true]) {
        for (const ripe of [false, true]) {
          out.push({ kind, level, progress, mature, ripe });
          out.push({ kind, level, progress, mature, ripe, span, w: span === 2 ? 100 : 48 });
        }
      }
    }
  }
  return out;
}

const hOf = (desc) => (FARM[desc.level - 1].span === 2 ? 104 : 70);

// ── the plants ─────────────────────────────────────────────────────────────

test('every fruit at every stage in both motion modes paints without throwing', () => {
  let painted = 0;
  const seen = new Set();
  for (const desc of everyPlantState()) {
    for (const motion of [0, 1]) {
      const ctx = stubCtx();
      paintSoil(ctx, 40, 8, { wet: motion === 1 });
      const stage = paintPlant(ctx, desc, hOf(desc), { tMs: 5000, motion, seed: 3 });
      assert.ok(STAGES.includes(stage), `unknown stage ${stage}`);
      assert.equal(stage, stageOf(desc), 'paintPlant and stageOf disagree');
      assert.equal(ctx.depth, 0, `level ${desc.level} at ${stage} leaks a save()`);
      assert.equal(ctx.globalAlpha, 1, `level ${desc.level} at ${stage} left the context dimmed`);
      assert.ok(ctx.calls.length > 0, `level ${desc.level} at ${stage} drew nothing at all`);
      seen.add(`${desc.level}:${stage}`);
      painted++;
    }
  }
  assert.ok(painted > 400, `only ${painted} plant states were exercised`);
  // and every level reaches every one of its stages
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const want = FARM[level - 1].kind === 'bed'
      ? ['seed', 'sprout', 'grown', 'bloom', 'ripe']
      : ['seed', 'sapling', 'young', 'grown', 'bloom', 'ripe'];
    for (const stage of want) assert.ok(seen.has(`${level}:${stage}`), `level ${level} never shows ${stage}`);
  }
});

test('every plant stays within a sane number of fills per frame', () => {
  // Painted every frame for up to ~60 plots. The fruit are paintFruit's own
  // cost; the plant around them has to stay cheap.
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const kind = FARM[level - 1].kind;
    for (const [mature, progress] of [[false, 0.6], [true, 0.9], [true, 0.2]]) {
      const ctx = stubCtx();
      paintPlant(ctx, { kind, level, progress, mature }, hOf({ level }), { tMs: 0, motion: 1 });
      const n = ctx.calls.filter((c) => c === 'fill' || c === 'stroke').length;
      assert.ok(n <= 60, `level ${level} at ${progress}${mature ? ' (mature)' : ''} costs ${n} paths without fruit`);
    }
  }
});

test('bare ground draws no plant, and says so', () => {
  const ctx = stubCtx();
  assert.equal(paintPlant(ctx, { kind: null, level: 0 }, 70, {}), 'empty');
  assert.equal(paintPlant(ctx, null, 70, {}), 'empty');
  assert.equal(ctx.calls.length, 0, 'something grew on nothing');
});

test('a plant only gets bigger as it grows, flowers before it fruits, and only carries fruit when ripe', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const kind = FARM[level - 1].kind;
    const perennial = kind !== 'bed';
    const at = (progress, mature, ripe) => stageOf({ kind, level, progress, mature, ripe });

    if (perennial) {
      assert.equal(at(0, false, false), 'seed');
      assert.equal(at(0.3, false, false), 'sapling');
      assert.equal(at(0.6, false, false), 'young');
      assert.equal(at(0.9, false, false), 'bloom', 'a young tree blossoms before its first crop');
      // a mature tree between crops is a full tree, and flowers late in each cycle
      assert.equal(at(0, true, false), 'grown');
      assert.equal(at(0.3, true, false), 'grown');
      assert.equal(at(0.9, true, false), 'bloom');
    } else {
      assert.equal(at(0, false, false), 'seed');
      assert.equal(at(0.3, false, false), 'sprout');
      assert.equal(at(0.6, false, false), 'grown');
      assert.equal(at(0.9, false, false), 'bloom');
    }
    // ripe outranks everything: it is the state the player has to notice
    for (const mature of [false, true]) assert.equal(at(0, mature, true), 'ripe');
  }
  // the thresholds are ordered, so the sequence can only go forward
  assert.ok(PLANT.seedUntil < PLANT.sproutUntil && PLANT.sproutUntil <= PLANT.bloomFrom);
  assert.ok(PLANT.seedUntil < PLANT.saplingUntil && PLANT.saplingUntil < PLANT.youngUntil);
  assert.ok(STAGES.includes('bloom'));
});

test('stageOf is a pure function of the description', () => {
  for (const desc of everyPlantState()) {
    assert.equal(stageOf(desc), stageOf({ ...desc }));
  }
  for (const [stages, kind] of [[BED_STAGES, 'bed'], [PERENNIAL_STAGES, 'tree'], [PERENNIAL_STAGES, 'vine']]) {
    for (const [stage, ps] of Object.entries(stages)) {
      for (const progress of ps) assert.equal(stageOf({ kind, level: 1, progress }), stage);
    }
  }
});

test('a nonsense description is drawn as something rather than crashing', () => {
  for (const junk of [
    { kind: 'bed', level: 0, progress: NaN, ripe: true },
    { kind: 'tree', level: 999, progress: -5, mature: true, ripe: true },
    { kind: 'vine', level: null, progress: 'lots', ripe: true },
    { kind: 'bed', level: 2.5, progress: Infinity, ripe: false },
    { kind: 'tree', level: 2, progress: 0.9, mature: true, ripe: true },   // a strawberry tree
    { kind: 'bed', level: 6, progress: 0.9, ripe: true },                   // an apple bed
    { kind: 'vine', level: 10, progress: 1, mature: true, ripe: true },     // a melon vine
    { kind: 'bed', level: 10, progress: 1, ripe: true, span: 7, w: -3 },
    { kind: 'tree', level: 1, progress: 1, ripe: true, w: NaN },
  ]) {
    for (const h of [70, 0, NaN]) {
      const ctx = stubCtx();
      const stage = paintPlant(ctx, junk, h, { tMs: 0, motion: 1 });
      assert.ok(STAGES.includes(stage));
      assert.equal(ctx.depth, 0);
    }
  }
});

test('vines bring their own trellis, at every stage', () => {
  for (const progress of [0, 0.3, 0.6, 0.9]) {
    const ctx = stubCtx();
    paintPlant(ctx, { kind: 'vine', level: 3, progress }, 70, { tMs: 0, motion: 0 });
    assert.ok(ctx.fills.includes(FARM_PALETTE.wood), `no trellis timber at ${progress}`);
  }
  // and the stand-alone export still works for anyone still calling it
  const ctx = stubCtx();
  paintTrellis(ctx, 48, 70);
  assert.ok(ctx.calls.includes('fill'));
  assert.equal(ctx.depth, 0);
});

test('a plant in bloom is drawn differently from the same plant in leaf', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const kind = FARM[level - 1].kind;
    const mature = kind !== 'bed';
    const leaf = stubCtx();
    paintPlant(leaf, { kind, level, progress: mature ? 0.2 : 0.6, mature }, hOf({ level }), {});
    const bloom = stubCtx();
    paintPlant(bloom, { kind, level, progress: 0.9, mature }, hOf({ level }), {});
    assert.ok(bloom.calls.length > leaf.calls.length, `level ${level} has no flowers`);
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
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const kind = FARM[level - 1].kind;
    const bare = { kind, level, progress: 0.2, mature: true, ripe: false };
    const ripe = { ...bare, ripe: true };
    const dull = stubCtx(); paintPlant(dull, bare, hOf(bare), { tMs: 0, motion: 1 });
    const lit = stubCtx(); paintPlant(lit, ripe, hOf(ripe), { tMs: 0, motion: 1 });
    assert.ok(!dull.fills.includes(FARM_PALETTE.glint), `level ${level} glints before it is ripe`);
    assert.ok(lit.fills.includes(FARM_PALETTE.glint), `level ${level} is ripe and says nothing`);
    assert.ok(lit.calls.length > dull.calls.length, 'a ripe plant looks no different');
  }
});

test('the shop can describe a seed it has no plot for', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const desc = describeSeed(level);
    assert.equal(desc.level, level);
    assert.equal(desc.kind, FARM[level - 1].kind);
    assert.equal(desc.span, FARM[level - 1].span);
    assert.equal(stageOf(desc), 'ripe', 'the shop should show the seed at its best');
    const ctx = stubCtx();
    paintPlant(ctx, desc, 70, {});
    assert.equal(ctx.depth, 0);
  }
  assert.equal(describeSeed(999).level, 1, 'a nonsense seed still previews something');
});

// ── the ground ─────────────────────────────────────────────────────────────

test('watering leaves a mark: watered soil is darker and wears a sheen', () => {
  for (const moisture of ['dry', 'damp', 'wet']) {
    const dry = stubCtx(); paintSoil(dry, 40, 8, { wet: false, moisture });
    const wet = stubCtx(); paintSoil(wet, 40, 8, { wet: true, moisture });
    assert.ok(wet.fills.length > dry.fills.length, `${moisture}: watering left no trace`);
    assert.ok(wet.fills.includes(FARM_PALETTE.sheen), `${moisture}: watered soil has no sheen`);
    assert.ok(!dry.fills.includes(FARM_PALETTE.sheen), `${moisture}: unwatered soil is shining`);
    assert.equal(wet.depth, 0);
    assert.equal(wet.globalAlpha, 1, 'the sheen left the context dimmed');
  }
});

test('the lie of the land shows: dry, damp and wet ground are different colours', () => {
  const look = (moisture) => { const c = stubCtx(); paintSoil(c, 40, 8, { moisture }); return c.fills.join(','); };
  const dry = look('dry');
  const damp = look('damp');
  const wet = look('wet');
  assert.notEqual(dry, damp);
  assert.notEqual(damp, wet);
  assert.notEqual(dry, wet);
  assert.equal(look(undefined), damp, 'unspecified ground should be the ordinary damp earth');
  assert.equal(look('swamp'), damp, 'nonsense moisture should fall back rather than throw');
  // and the geometry is the same, only the colour changes
  const a = stubCtx(); paintSoil(a, 40, 8, { moisture: 'dry' });
  const b = stubCtx(); paintSoil(b, 40, 8, { moisture: 'wet' });
  assert.deepEqual(a.calls, b.calls);
});

test('bare earth is drawn differently from earth with something in it', () => {
  const planted = stubCtx(); paintSoil(planted, 40, 8, { wet: false });
  const bare = stubCtx(); paintSoil(bare, 40, 8, { wet: false, bare: true });
  assert.ok(bare.calls.length > planted.calls.length, 'bare ground still reads as a floorboard');
  const none = stubCtx(); paintSoil(none, 40, 8);
  assert.equal(none.depth, 0, 'soil with no options leaked a save()');
});

// ── things that are not plants ─────────────────────────────────────────────

test('every structure paints, balanced, in both motion modes', () => {
  assert.deepEqual([...STRUCTURE_KINDS].sort(), ['beehive', 'compost', 'pond']);
  for (const kind of STRUCTURE_KINDS) {
    for (const motion of [0, 1]) {
      for (const [w, h] of [[48, 70], [48, 104], [100, 104]]) {
        const ctx = stubCtx();
        paintStructure(ctx, kind, w, h, { tMs: 4321, motion, seed: 2 });
        assert.ok(ctx.calls.includes('fill'), `${kind} drew nothing`);
        assert.equal(ctx.depth, 0, `${kind} leaks a save()`);
        assert.equal(ctx.globalAlpha, 1, `${kind} left the context dimmed`);
      }
    }
  }
  // an unknown kind, or no options at all, is a no-op rather than a crash
  const ctx = stubCtx();
  paintStructure(ctx, 'windmill', 48, 70);
  paintStructure(ctx, 'pond', 48, 70);
  assert.equal(ctx.depth, 0);
});

test('the pond ripples and the bees fly only when motion is on', () => {
  for (const kind of ['pond', 'beehive']) {
    const a = tracingCtx(); paintStructure(a, kind, 48, 70, { tMs: 0, motion: 0, seed: 1 });
    const b = tracingCtx(); paintStructure(b, kind, 48, 70, { tMs: 98765, motion: 0, seed: 1 });
    assert.deepEqual(a.trace, b.trace, `${kind} moved under reduced motion`);
    const c = tracingCtx(); paintStructure(c, kind, 48, 70, { tMs: 0, motion: 1, seed: 1 });
    const d = tracingCtx(); paintStructure(d, kind, 48, 70, { tMs: 1300, motion: 1, seed: 1 });
    assert.notDeepEqual(c.trace, d.trace, `${kind} is still with motion on`);
  }
});

// ── the fit badge ──────────────────────────────────────────────────────────

test('the fit badge shows every grade, more stars and a warmer colour the better the spot', () => {
  const tints = [];
  for (let grade = -2; grade <= 2; grade++) {
    const ctx = stubCtx();
    paintFitBadge(ctx, grade, 14);
    assert.equal(ctx.depth, 0);
    assert.equal(ctx.globalAlpha, 1);
    assert.ok(ctx.calls.includes('fill'));
    tints.push(ctx.fills.filter((f) => f !== FARM_PALETTE.chip && f !== FARM_PALETTE.fitOff));
  }
  // every grade wears its own colour, and the ideal one is the gold
  const lit = tints.map((t) => t[0] || null);
  assert.equal(lit[0], null, 'a poor spot should have no filled stars');
  assert.equal(new Set(lit.slice(1)).size, 4, 'two grades share a colour');
  assert.equal(lit[4], FARM_PALETTE.fitIdeal);
  // and junk grades are clamped rather than thrown
  for (const junk of [-9, 9, 0.4, NaN, undefined, 'good']) {
    const ctx = stubCtx();
    paintFitBadge(ctx, junk, 14);
    assert.equal(ctx.depth, 0, `grade ${String(junk)} leaked a save()`);
  }
  const big = tracingCtx(); paintFitBadge(big, 9, 14);
  const ideal = tracingCtx(); paintFitBadge(ideal, 2, 14);
  assert.deepEqual(big.trace, ideal.trace, 'a grade past ideal should draw as ideal');
});

// ── the ambient budget ─────────────────────────────────────────────────────
//
// The rule the whole farm screen is held to: INFORMATION holds still under
// reduced motion, DECORATION disappears. Getting that backwards is how a
// screen-reading player loses the only cue that a crop is ready, or how a
// motion-sensitive player is left with a dot sitting on a hillside.

test('a plant sways and a ripe one bobs, and both hold perfectly still on request', () => {
  for (const desc of everyPlantState()) {
    const h = hOf(desc);
    const a = tracingCtx(); paintPlant(a, desc, h, { tMs: 0, motion: 0, seed: 5 });
    const b = tracingCtx(); paintPlant(b, desc, h, { tMs: 987654, motion: 0, seed: 5 });
    assert.deepEqual(a.trace, b.trace, `level ${desc.level} moved under reduced motion`);
    const colours = (c) => c.fills.map((f) => (typeof f === 'string' ? f : 'gradient'));
    assert.deepEqual(colours(a), colours(b));
  }
  // and the glint is still lit, because it is information rather than decoration
  const ripe = { kind: 'bed', level: 2, progress: 1, ripe: true };
  const still = stubCtx(); paintPlant(still, ripe, 70, { tMs: 0, motion: 0, seed: 5 });
  assert.ok(still.fills.includes(FARM_PALETTE.glint));
  // with motion on, the same plant does move
  const m1 = tracingCtx(); paintPlant(m1, ripe, 70, { tMs: 0, motion: 1, seed: 5 });
  const m2 = tracingCtx(); paintPlant(m2, ripe, 70, { tMs: 1300, motion: 1, seed: 5 });
  assert.notDeepEqual(m1.trace, m2.trace, 'nothing sways with motion on');
  assert.equal(m2.depth, 0, 'the sway leaked a save()');
});

test('every plot gets the same picture from the same seed, and a seed is optional', () => {
  for (const level of [1, 2, 3, 6, 9, 11]) {
    const desc = { kind: FARM[level - 1].kind, level, progress: 0.9, mature: true, ripe: true };
    const once = tracingCtx(); paintPlant(once, desc, 70, { tMs: 4321, motion: 1, seed: 12 });
    const again = tracingCtx(); paintPlant(again, desc, 70, { tMs: 4321, motion: 1, seed: 12 });
    assert.deepEqual(once.trace, again.trace, 'the same plot drew itself two ways');
    for (const seed of [undefined, null, NaN, 'twelve', -3, 1e9]) {
      const ctx = stubCtx();
      paintPlant(ctx, desc, 70, { tMs: 4321, motion: 1, seed });
      assert.ok(ctx.calls.length > 0);
      assert.equal(ctx.depth, 0, `seed ${String(seed)} leaked a save()`);
    }
  }
});

test('the painter keeps no clock and rolls no dice of its own', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/plant-art.js'), 'utf8');
  assert.ok(!/Math\.random\s*\(/.test(src), 'plant-art.js rolls Math.random()');
  assert.ok(!/Date\.now\s*\(|performance\.now\s*\(/.test(src), 'plant-art.js reads the clock');
});

// ── time, made visible ─────────────────────────────────────────────────────

test('the progress ring shows a gauge, and nothing at all at zero', () => {
  const empty = stubCtx(); paintProgressRing(empty, 46, 0);
  assert.equal(empty.calls.length, 0, 'a bubble appeared around a fresh sprig');
  for (const p of [0.01, 0.5, 1]) {
    const ctx = stubCtx();
    paintProgressRing(ctx, 46, p);
    assert.equal(ctx.calls.filter((c) => c === 'stroke').length, 2, `${p}: track and sweep`);
    assert.equal(ctx.depth, 0);
  }
  // nonsense progress is clamped rather than thrown
  for (const junk of [NaN, -5, Infinity, 'half', null]) {
    const ctx = stubCtx();
    paintProgressRing(ctx, 46, junk);
    assert.equal(ctx.depth, 0, `progress ${String(junk)} leaked a save()`);
  }
});

test('the countdown chip draws its own background so it reads over any crop', () => {
  const ctx = stubCtx();
  paintCountdown(ctx, '2:31', 46);
  assert.ok(ctx.calls.includes('fill'), 'the chip has no chip');
  assert.ok(ctx.calls.includes('text'), 'the chip has no time on it');
  assert.equal(ctx.depth, 0);
  assert.equal(ctx.globalAlpha, 1, 'the chip left the context dimmed');
});

test('the 种 hint is a hint: it breathes, and it holds still on request', () => {
  const a = stubCtx(); paintPlantHint(a, 46, 0, 0);
  const b = stubCtx(); paintPlantHint(b, 46, 987654, 0);
  assert.deepEqual(a.calls, b.calls, 'the hint pulsed under reduced motion');
  assert.ok(a.calls.includes('text'), 'the hint says nothing');
  assert.equal(a.depth, 0);
  assert.equal(a.globalAlpha, 1);
});

// ── the palette rule ───────────────────────────────────────────────────────

test('the plant painter has no colour of its own outside FARM_PALETTE', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/plant-art.js'), 'utf8');
  const start = src.indexOf('FARM_PALETTE = {');
  const table = src.slice(start, src.indexOf('};', start));
  const rest = src.slice(0, start) + src.slice(src.indexOf('};', start));
  for (const m of rest.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    assert.fail(`js/plant-art.js paints with a loose hex literal ${m[0]}`);
  }
  for (const m of rest.matchAll(/\b(rgba?|hsla?)\s*\(/gi)) {
    assert.fail(`js/plant-art.js builds a colour of its own with ${m[0]}`);
  }
  assert.ok(table.length > 0);
  for (const [key, colour] of Object.entries(FARM_PALETTE)) {
    assert.match(colour, /^#[0-9a-f]{6}$/i, `FARM_PALETTE.${key} is not a plain hex colour`);
  }
});

test('everything a plant paints with is from the palette or the fruit tables', async () => {
  const { FRUITS } = await import('../js/constants.js');
  const known = new Set([
    ...Object.values(FARM_PALETTE),
    ...FRUITS.flatMap((f) => [f.color, f.rind, f.face, f.accent, f.leaf]),
  ].map((c) => c.toLowerCase()));
  const check = (ctx, what) => {
    for (const f of ctx.fills) {
      if (typeof f !== 'string') continue;          // paintFruit's own gradients
      if (/^rgba?\(/.test(f)) continue;              // paintFruit's own gloss
      assert.ok(known.has(f.toLowerCase()), `${what} filled with ${f}`);
    }
  };
  for (let level = 1; level <= MAX_LEVEL; level++) {
    for (const d of [{ progress: 0.6 }, { progress: 0.9, mature: true }, { progress: 1, ripe: true }]) {
      const ctx = stubCtx();
      paintPlant(ctx, { kind: FARM[level - 1].kind, level, ...d }, 70, {});
      check(ctx, `level ${level}`);
    }
  }
  for (const kind of STRUCTURE_KINDS) {
    const ctx = stubCtx(); paintStructure(ctx, kind, 48, 70, { motion: 1 }); check(ctx, kind);
  }
});

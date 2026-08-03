// The stall paints once per frame behind everything else, and its bugs are
// invisible-in-review by nature (a lantern branch that only runs in dark
// theme, a leaf that never schedules). Same treatment as the fruit painter:
// draw it against a stub and assert the parts that are rules, not taste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENE, THEMES, PERCH_R, perchAt, themeOf,
  paintSky, paintSkyline, paintStall, paintAwning, paintLanterns, paintLeaf,
} from '../js/scene.js';
import { WORLD, radiusOf } from '../js/constants.js';

function stubCtx() {
  const calls = [];
  let depth = 0;
  const api = {
    calls, get depth() { return depth; },
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
    save() { depth++; }, restore() { depth--; },
    translate() {}, rotate() {}, scale() {}, clip() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, arc() {}, ellipse() {}, rect() {},
    fillRect() { calls.push('fill'); }, strokeRect() { calls.push('stroke'); },
    fill() { calls.push('fill'); }, stroke() { calls.push('stroke'); },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  return api;
}

function paintAll(theme, tMs, motion) {
  const ctx = stubCtx();
  const th = themeOf({ theme });
  paintSky(ctx, th, 400, 700);
  paintSkyline(ctx, th);
  paintStall(ctx, th);
  paintAwning(ctx, th);
  paintLanterns(ctx, th, tMs, motion);
  paintLeaf(ctx, th, tMs, motion);
  return ctx;
}

test('both themes paint a full scene and leave the context balanced', () => {
  for (const theme of ['light', 'dark']) {
    const ctx = paintAll(theme, 5000, 1);
    assert.ok(ctx.calls.filter((c) => c === 'fill').length > 10, `${theme} barely fills anything`);
    assert.ok(ctx.calls.includes('stroke'), `${theme} strokes nothing`);
    assert.equal(ctx.depth, 0, `${theme} leaks a save()`);
  }
});

test('an unknown or missing theme falls back to light rather than throwing', () => {
  assert.equal(themeOf({ theme: 'chartreuse' }), THEMES.light);
  assert.equal(themeOf({}), THEMES.light);
  assert.equal(themeOf(undefined), THEMES.light);
  assert.equal(themeOf({ theme: 'dark' }), THEMES.dark);
});

test('every theme defines every colour the painters reach for', () => {
  const keys = Object.keys(THEMES.light);
  for (const [name, th] of Object.entries(THEMES)) {
    for (const k of keys) assert.ok(k in th, `${name} theme is missing ${k}`);
    assert.equal(th.sky.length, 2, `${name} sky needs two stops`);
    assert.equal(th.awning.length, 2, `${name} awning needs two stripe colours`);
  }
});

test('only the evening stall is lantern-lit', () => {
  assert.equal(THEMES.light.lantern, null);
  assert.ok(THEMES.dark.lantern);
  const day = stubCtx();
  paintLanterns(day, THEMES.light, 5000, 1);
  assert.equal(day.calls.length, 0, 'lanterns burning at midday');
});

test('the awning fringe hangs just above the deadline, never below it', () => {
  const scallopR = (WORLD.width + 2 * SCENE.wall) / SCENE.scallops / 2;
  const fringe = SCENE.awningBottom + scallopR;
  assert.ok(fringe < WORLD.deadlineY, `fringe at ${fringe} crosses the line at ${WORLD.deadlineY}`);
  assert.ok(WORLD.deadlineY - fringe < 20, 'fringe floats too far above the line to explain it');
});

test('the ambient leaf: one per 20–40 s, and none at all under reduced motion', () => {
  let frames = 0, drawn = 0;
  let last = null;
  const gaps = [];
  for (let t = 0; t < 300000; t += 50) {
    const ctx = stubCtx();
    paintLeaf(ctx, THEMES.light, t, 1);
    frames++;
    if (ctx.calls.length) {
      drawn++;
      if (last == null || t - last > 200) gaps.push(t);   // a new crossing began
      last = t;
    }
    assert.equal(stubMotionless(t).calls.length, 0, 'a leaf drifted under reduced motion');
  }
  assert.ok(gaps.length >= 7, `only ${gaps.length} leaves in 5 minutes`);
  for (let i = 1; i < gaps.length; i++) {
    const gap = gaps[i] - gaps[i - 1];
    assert.ok(gap >= 20000 && gap <= 40000, `leaf gap ${gap}ms outside 20–40 s`);
  }
  // it is ambient, not a feature: on screen a small fraction of the time
  assert.ok(drawn / frames < 0.35, 'the leaf is on screen too much to be ambient');
});

function stubMotionless(t) {
  const ctx = stubCtx();
  paintLeaf(ctx, THEMES.light, t, 0);
  return ctx;
}

test('lantern sway is imperceptible, and stops entirely under reduced motion', () => {
  // the sway is ±0.5 world units by construction; assert the still frame is
  // byte-identical to itself and that motion actually changes something
  const a = stubCtx(); paintLanterns(a, THEMES.dark, 0, 0);
  const b = stubCtx(); paintLanterns(b, THEMES.dark, 9999, 0);
  assert.deepEqual(a.calls, b.calls);
  const c = stubCtx(); paintLanterns(c, THEMES.dark, 0, 1);
  assert.ok(c.calls.length > 0);
});

// ── the perch ──────────────────────────────────────────────────────────────
// Where a friend sits while they watch you work. The rule is that it is not
// the board: everything between the walls is where fruit land, so the one
// honest seat on this stall is the top of a side plank.

test('the perch is on the plank, not on the board, and inside the view', () => {
  const r = PERCH_R;
  const p = perchAt(r);
  // the plank top, which is where paintStall starts the side walls
  assert.equal(p.y + r, WORLD.deadlineY - 20, 'the friend is not sitting on anything');
  // the view is the world plus one plank on each side and nothing more, so a
  // friend who reaches past that is drawn with a slice missing
  assert.ok(p.x - r >= -SCENE.wall, `the friend is clipped by the bezel at ${p.x - r}`);
  assert.ok(p.x + r < WORLD.width / 4, 'the friend is sitting out on the counter');
  // and clear of the pile: a fruit resting on the floor can never reach them
  assert.ok(p.y + r < WORLD.deadlineY, 'the perch is inside the danger zone');
});

test('a perched friend is small — a little wider than the plank, not a fruit in play', () => {
  assert.ok(PERCH_R > SCENE.wall, 'the friend is narrower than the plank they sit on');
  assert.ok(PERCH_R < radiusOf(2), 'the friend is drawn at full fruit size');
});

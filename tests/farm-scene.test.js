// The mountainside. A pure painter, and it fails in ways that are invisible in
// review — a stage that only draws in dark theme, a sign whose hit box has
// drifted off the sign, fog that crawls under reduced motion. Same treatment as
// js/scene.js and js/fruit-art.js: draw against a stub and assert the parts
// that are rules rather than taste. (Where things ARE is js/farm-layout.js and
// is tested there; the plants are js/plant-art.js and are tested there.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FARM_ART, FARM_THEMES, farmThemeOf, forSaleBox, terracePriceBox, altitudeMarkerBox,
  fogBands, lanternSpots,
  paintFarmSky, paintSky, paintRidges, paintHillside, paintStream, paintTerrace, paintFoot,
  paintForSale, paintTerracePrice, paintAltitudeMarkers, paintFog, paintFireflies, paintLanterns,
} from '../js/farm-scene.js';
import * as layout from '../js/farm-layout.js';
import { LAYOUT, groundYOf, worldHeight } from '../js/farm-layout.js';
import { altitudeOf } from '../js/terrain.js';
import { TUNING, MAX_TERRACES } from '../js/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES = ['light', 'dark'];

// The drawing state a real context saves and restores. Modelled here because
// leaking one of these is the classic canvas bug and it is invisible in review:
// a painter that dims itself and forgets to put globalAlpha back dims whatever
// is drawn after it.
const STATE = ['globalAlpha', 'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap',
  'font', 'textAlign', 'textBaseline'];

function stubCtx() {
  const calls = [];
  const stack = [];
  let gradientsMade = 0;
  const api = {
    calls, get depth() { return stack.length; }, get gradientsMade() { return gradientsMade; },
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
    fill() { calls.push('fill'); }, stroke() { calls.push('stroke'); },
    fillText(s) { calls.push('text'); calls.texts = [...(calls.texts || []), s]; },
    strokeText() { calls.push('text'); },
    measureText() { return { width: 10 }; },
    createRadialGradient() { gradientsMade++; return { addColorStop() {} }; },
    createLinearGradient() { gradientsMade++; return { addColorStop() {} }; },
  };
  return api;
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// The whole frame, in the order the host draws it.
function paintWorld(ctx, th, tMs, motion, view) {
  paintFarmSky(ctx, th, 400, 700);
  paintSky(ctx, th, tMs, motion);
  paintRidges(ctx, th);
  paintHillside(ctx, th, view);
  paintStream(ctx, th, tMs, motion, view);
  for (let i = MAX_TERRACES - 1; i >= 0; i--) {
    paintTerrace(ctx, th, i, i < 3, { sprinkler: i === 1, irrigated: i === 2 });
  }
  paintFoot(ctx, th, tMs, motion);
  paintForSale(ctx, th, 3, 2000, tMs, motion, 'Rank 4 needed');
  for (let i = 4; i < MAX_TERRACES; i++) paintTerracePrice(ctx, th, i, TUNING.terraceCosts[i]);
  paintAltitudeMarkers(ctx, th);
  paintFog(ctx, th, tMs, motion, view);
  paintFireflies(ctx, th, tMs, motion, view);
  paintLanterns(ctx, th, tMs, motion);
}

// ── the scene ──────────────────────────────────────────────────────────────

test('both themes paint a full mountainside and leave the context balanced', () => {
  for (const theme of THEMES) {
    const ctx = stubCtx();
    paintWorld(ctx, farmThemeOf({ theme }), 5000, 1);
    assert.ok(ctx.calls.filter((c) => c === 'fill').length > 100, `${theme} barely fills anything`);
    assert.ok(ctx.calls.includes('stroke'), `${theme} strokes nothing`);
    assert.ok(ctx.calls.includes('text'), `${theme} never writes 出售`);
    assert.equal(ctx.depth, 0, `${theme} leaks a save()`);
    assert.equal(ctx.globalAlpha, 1, `${theme} left the context dimmed`);
  }
});

// Painted every frame: the budget is a few hundred fills for the WHOLE world,
// and a phone-sized view should cost well under that.
test('a frame stays within its fill budget, and a view makes it cheaper', () => {
  for (const theme of THEMES) {
    const th = farmThemeOf({ theme });
    const all = stubCtx();
    paintWorld(all, th, 5000, 1);
    const fills = all.calls.filter((c) => c === 'fill').length;
    assert.ok(fills < 600, `${theme} costs ${fills} fills a frame`);
    const H = worldHeight();
    const bottom = stubCtx();
    paintWorld(bottom, th, 5000, 1, { top: H - 690, bottom: H });
    assert.ok(bottom.calls.length < all.calls.length, `${theme}: the view culled nothing`);
  }
});

test('gradients are built once per context, not once per frame', () => {
  for (const theme of THEMES) {
    const ctx = stubCtx();
    const th = farmThemeOf({ theme });
    paintWorld(ctx, th, 1000, 1);
    const first = ctx.gradientsMade;
    for (const tMs of [2000, 9000, 60000]) paintWorld(ctx, th, tMs, 1);
    assert.equal(ctx.gradientsMade, first, `${theme} rebuilt a gradient on a later frame`);
  }
});

test('an unknown or missing theme falls back to the morning rather than throwing', () => {
  assert.equal(farmThemeOf({ theme: 'monsoon' }), FARM_THEMES.light);
  assert.equal(farmThemeOf({}), FARM_THEMES.light);
  assert.equal(farmThemeOf(undefined), FARM_THEMES.light);
  assert.equal(farmThemeOf({ theme: 'dark' }), FARM_THEMES.dark);
});

test('every theme defines every colour the painters reach for', () => {
  const keys = new Set([...Object.keys(FARM_THEMES.light), ...Object.keys(FARM_THEMES.dark)]);
  for (const [name, th] of Object.entries(FARM_THEMES)) {
    for (const k of keys) assert.ok(k in th, `${name} theme is missing ${k}`);
    assert.equal(th.sky.length, 2, `${name} sky needs two stops`);
    assert.equal(th.skyWorld.length, 3, `${name} world sky needs three stops`);
    assert.equal(th.ridges.length, 3, `${name} needs three ridges`);
    assert.equal(th.flowers.length, 3);
    for (const band of ['low', 'mid', 'high']) assert.ok(band in th.tint, `${name} has no ${band} tint`);
  }
  // one of the two lights the sky; the morning has the sun, the dusk the moon
  assert.ok(FARM_THEMES.light.sun && !FARM_THEMES.light.moon);
  assert.ok(FARM_THEMES.dark.moon && !FARM_THEMES.dark.sun && FARM_THEMES.dark.star);
});

test('the valley is warm and the ridge is cool', () => {
  for (const th of Object.values(FARM_THEMES)) {
    const rgb = (s) => s.match(/[\d.]+/g).map(Number);
    const [lr, , lb] = rgb(th.tint.low);
    const [hr, , hb] = rgb(th.tint.high);
    assert.ok(lr > lb, 'the valley tint is not warm');
    assert.ok(hb > hr, 'the ridge tint is not cool');
  }
});

test('only the evening farm is lantern-lit, by the house and the bridge', () => {
  assert.equal(FARM_THEMES.light.lantern, null);
  assert.ok(FARM_THEMES.dark.lantern);
  const day = stubCtx();
  paintLanterns(day, FARM_THEMES.light, 5000, 1);
  assert.equal(day.calls.length, 0, 'lanterns burning at breakfast');
  const dusk = stubCtx();
  paintLanterns(dusk, FARM_THEMES.dark, 5000, 1);
  assert.ok(dusk.calls.includes('fill'));
  assert.equal(dusk.depth, 0);
  // down at the foot of the mountain, not up among the crops
  for (const s of lanternSpots()) assert.ok(s.y > groundYOf(0), 'a lantern is hanging over a shelf');
});

// ── the sky ───────────────────────────────────────────────────────────────

test('the sky holds still under reduced motion and drifts with it', () => {
  for (const th of Object.values(FARM_THEMES)) {
    const a = stubCtx(); paintSky(a, th, 0, 0);
    const b = stubCtx(); paintSky(b, th, 987654, 0);
    assert.deepEqual(a.calls, b.calls, 'the sky moved under reduced motion');
    assert.equal(a.depth, 0);
    assert.equal(a.globalAlpha, 1, 'the stars left the context dimmed');
    assert.ok(a.calls.filter((c) => c === 'fill').length >= 5, 'an empty sky');
  }
  const dusk = stubCtx(); paintSky(dusk, FARM_THEMES.dark, 0, 0);
  const day = stubCtx(); paintSky(day, FARM_THEMES.light, 0, 0);
  assert.ok(day.calls.includes('stroke'), 'no birds in the morning');
  assert.ok(!dusk.calls.includes('stroke'), 'birds out at dusk');
});

test('the ridges and hillside are static scenery', () => {
  for (const th of Object.values(FARM_THEMES)) {
    const r = stubCtx(); paintRidges(r, th);
    assert.ok(r.calls.filter((c) => c === 'fill').length >= 3, 'fewer than three ridges');
    const h = stubCtx(); paintHillside(h, th);
    assert.ok(h.calls.length > 20, 'a bare hillside');
    assert.equal(h.depth, 0);
  }
});

// ── the terraces ──────────────────────────────────────────────────────────

test('every terrace paints, bought or not, with and without its fixtures', () => {
  for (const th of Object.values(FARM_THEMES)) {
    for (let i = 0; i < MAX_TERRACES; i++) {
      for (const owned of [true, false]) {
        for (const opts of [undefined, {}, { sprinkler: true }, { irrigated: true }, { sprinkler: true, irrigated: true }]) {
          const ctx = stubCtx();
          paintTerrace(ctx, th, i, owned, opts);
          assert.ok(ctx.calls.length > 5);
          assert.equal(ctx.depth, 0);
        }
      }
    }
  }
});

test('an unbought terrace is visibly the same terrace, gone to seed', () => {
  const bought = stubCtx(); paintTerrace(bought, FARM_THEMES.light, 2, true);
  const weedy = stubCtx(); paintTerrace(weedy, FARM_THEMES.light, 2, false);
  assert.ok(bought.calls.length > 0 && weedy.calls.length > 0);
  assert.ok(weedy.calls.filter((c) => c === 'stroke').length >
    bought.calls.filter((c) => c === 'stroke').length, 'the weeds never grew');
});

test('a sprinkler and a channel each add something to a shelf', () => {
  const count = (opts) => { const c = stubCtx(); paintTerrace(c, FARM_THEMES.light, 1, true, opts); return c.calls.length; };
  const plain = count({});
  assert.ok(count({ sprinkler: true }) > plain, 'the sprinkler was not drawn');
  assert.ok(count({ irrigated: true }) > plain, 'the channel was not drawn');
  // …and only on a shelf the player owns
  const a = stubCtx(); paintTerrace(a, FARM_THEMES.light, 5, false, {});
  const b = stubCtx(); paintTerrace(b, FARM_THEMES.light, 5, false, { sprinkler: true, irrigated: true });
  assert.deepEqual(a.calls, b.calls, 'plumbing on a shelf nobody owns');
});

// ── the sign and the markers ──────────────────────────────────────────────

test('the 出售 sign sits on the terrace it is selling, and reports its own hit box', () => {
  for (let i = 1; i < MAX_TERRACES; i++) {
    const painted = paintForSale(stubCtx(), FARM_THEMES.light, i, TUNING.terraceCosts[i], 5000, 1);
    assert.deepEqual(painted, forSaleBox(i), 'the sign is drawn somewhere other than its hit box');
    assert.deepEqual(forSaleBox(i), layout.forSaleBox(i), 'the painter and the layout disagree on the box');
    assert.ok(painted.x >= LAYOUT.left && painted.x + painted.w <= LAYOUT.right, `sign ${i} hangs off its terrace`);
    assert.ok(painted.y + painted.h <= groundYOf(i), `sign ${i} is buried in the wall`);
    assert.ok(painted.w >= 44 && painted.h >= 28, 'the sign is too small to tap');
  }
});

// The sign is a destination, not set dressing: what it costs is painted on it,
// so the whole "buy a shelf" beat is legible from the road without a sheet.
test('the sign wears its price, an optional note, and is still a sign without either', () => {
  const priced = stubCtx(); paintForSale(priced, FARM_THEMES.light, 1, 500, 0, 0);
  const bare = stubCtx(); paintForSale(bare, FARM_THEMES.light, 1, null, 0, 0);
  const noted = stubCtx(); paintForSale(noted, FARM_THEMES.light, 1, 500, 0, 0, 'Rank 4 needed');
  const texts = (c) => c.calls.filter((x) => x === 'text').length;
  assert.equal(texts(priced), 2, 'the price never made it onto the board');
  assert.equal(texts(bare), 1, 'a priceless sign should still say 出售');
  assert.equal(texts(noted), 3, 'the note never made it onto the board');
  assert.ok(noted.calls.texts.includes('Rank 4 needed'));
  assert.equal(noted.depth, 0);
  // and the biggest number on the mountain still fits between the edges
  const dearest = Math.max(...TUNING.terraceCosts);
  assert.ok(String(`${dearest}元`).length * LAYOUT.signH * 0.28 * 0.6 < LAYOUT.signW,
    'the top terrace’s price overflows the sign it is painted on');
  assert.ok('Rank 10 needed'.length * LAYOUT.signH * 0.17 * 0.55 < LAYOUT.signW - 8, 'a note overflows the sign');
});

test('the sign leans in the breeze without taking its hit box with it', () => {
  const still = stubCtx();
  const a = paintForSale(still, FARM_THEMES.light, 2, 1200, 0, 0);
  const later = stubCtx();
  const b = paintForSale(later, FARM_THEMES.light, 2, 1200, 987654, 0);
  assert.deepEqual(still.calls, later.calls, 'the sign swayed under reduced motion');
  for (const tMs of [0, 900, 4200, 987654]) {
    assert.deepEqual(paintForSale(stubCtx(), FARM_THEMES.dark, 2, 1200, tMs, 1), forSaleBox(2),
      `the hit box drifted with the sway at ${tMs}ms`);
  }
  assert.deepEqual(a, b);
  assert.ok(FARM_ART.signSway > 0 && FARM_ART.signSway < 0.1, 'a pendulum, not a breeze');
});

// The ladder up the hill: one tappable offer, and every shelf above it wearing
// its price as set dressing. A marker must never sit under the sign.
test('every shelf above the offer wears its price, clear of the sign', () => {
  for (let i = 1; i < MAX_TERRACES; i++) {
    const painted = paintTerracePrice(stubCtx(), FARM_THEMES.light, i, TUNING.terraceCosts[i]);
    assert.deepEqual(painted, terracePriceBox(i), 'the marker is drawn somewhere other than its box');
    assert.ok(painted.x >= LAYOUT.left && painted.x + painted.w <= LAYOUT.right, `marker ${i} hangs off its terrace`);
    assert.ok(painted.y + painted.h <= groundYOf(i), `marker ${i} is buried in the wall`);
    assert.ok(!overlaps(painted, forSaleBox(i)), `marker ${i} sits under the sign`);
  }
});

test('a terrace with no price to quote gets no marker at all', () => {
  const ctx = stubCtx();
  assert.equal(paintTerracePrice(ctx, FARM_THEMES.light, 2, null), null);
  assert.equal(paintTerracePrice(ctx, FARM_THEMES.light, 2, undefined), null);
  assert.equal(ctx.calls.length, 0, 'a priceless shelf still got a board nailed to it');
});

// 0.8em per glyph is a deliberate over-estimate, so a marker that passes this
// has visible margin, not none.
test('the dearest shelf on the mountain fits inside its own marker', () => {
  const dearest = `${Math.max(...TUNING.terraceCosts)}元`;
  const width = dearest.length * LAYOUT.markerH * 0.56 * 0.8;
  assert.ok(width < LAYOUT.markerW - 4,
    `"${dearest}" needs ~${width.toFixed(0)} units in a ${LAYOUT.markerW}-unit marker`);
});

test('a price marker is scenery: quieter than the sign', () => {
  const marker = stubCtx();
  paintTerracePrice(marker, FARM_THEMES.dark, 2, 1200);
  const sign = stubCtx();
  paintForSale(sign, FARM_THEMES.dark, 2, 1200, 0, 0);
  assert.ok(marker.calls.length < sign.calls.length, 'the marker is as loud as the offer');
  assert.equal(marker.depth, 0);
  assert.equal(marker.globalAlpha, 1, 'the marker left the context dimmed');
});

test('only the evening lights the sign', () => {
  const day = stubCtx();
  paintForSale(day, FARM_THEMES.light, 1, 500, 0, 0);
  const dusk = stubCtx();
  paintForSale(dusk, FARM_THEMES.dark, 1, 500, 0, 0);
  assert.equal(FARM_THEMES.light.signGlow, null);
  assert.ok(dusk.calls.filter((c) => c === 'fill').length > day.calls.filter((c) => c === 'fill').length,
    'the dusk sign has no glow pooled behind it');
});

test('each altitude band is named once, at its lowest shelf, beside the stream', () => {
  const ctx = stubCtx();
  paintAltitudeMarkers(ctx, FARM_THEMES.light);
  assert.equal(ctx.depth, 0);
  assert.equal(ctx.globalAlpha, 1);
  // one marker per band, on the first shelf of that band
  const bands = FARM_ART.bandStarts.map(altitudeOf);
  assert.deepEqual(bands, ['low', 'mid', 'high']);
  for (const i of FARM_ART.bandStarts) {
    assert.ok(i === 0 || altitudeOf(i - 1) !== altitudeOf(i), `terrace ${i} is not where its band starts`);
    const b = altitudeMarkerBox(i);
    assert.ok(b.x + b.w <= layout.tileGeom(i, 0).x + 2, `the ${altitudeOf(i)} marker stands on a tile`);
    assert.ok(b.y + b.h <= groundYOf(i), 'the marker is buried');
  }
  assert.equal(ctx.calls.texts.join(''), FARM_ART.bandStarts.map((i) => FARM_ART.bandNames[altitudeOf(i)]).join(''));
});

// ── the foot of the mountain ──────────────────────────────────────────────

test('the road and the farmhouse sit below the bottom wall, and the chimney only smokes with motion', () => {
  for (const th of Object.values(FARM_THEMES)) {
    const a = stubCtx(); paintFoot(a, th, 0, 0);
    const b = stubCtx(); paintFoot(b, th, 987654, 0);
    assert.deepEqual(a.calls, b.calls, 'the foot moved under reduced motion');
    assert.ok(a.calls.filter((c) => c === 'fill').length > 20, 'no house at the foot of the hill');
    const moving = stubCtx(); paintFoot(moving, th, 987654, 1);
    assert.ok(moving.calls.length > a.calls.length, 'no smoke from the chimney');
    assert.equal(moving.depth, 0);
    assert.equal(moving.globalAlpha, 1);
  }
});

// ── the ambient budget ─────────────────────────────────────────────────────
//
// The rule the whole farm screen is held to: INFORMATION holds still under
// reduced motion, DECORATION disappears or stops.

test('the ambient layers hold perfectly still under reduced motion', () => {
  for (const th of Object.values(FARM_THEMES)) {
    for (const paint of [paintFog, paintStream, paintSky, paintFoot]) {
      const a = stubCtx(); paint(a, th, 0, 0);
      const b = stubCtx(); paint(b, th, 987654, 0);
      assert.deepEqual(a.calls, b.calls, `${paint.name} drifted under reduced motion`);
      const moving = stubCtx(); paint(moving, th, 987654, 1);
      assert.ok(moving.calls.length >= a.calls.length, `${paint.name} draws less when it is allowed to move`);
    }
  }
  // the water still reads as water when it cannot shimmer
  const still = stubCtx();
  paintStream(still, FARM_THEMES.light, 0, 0);
  assert.ok(still.calls.includes('fill'));
});

test('the fog lies where the bands meet, and nowhere else', () => {
  const ys = fogBands();
  assert.equal(ys.length, 2);
  for (const [k, y] of ys.entries()) {
    const upper = FARM_ART.bandStarts[k + 1];
    assert.ok(y > groundYOf(upper) && y < groundYOf(upper - 1), `fog ${k} is not between terraces ${upper - 1} and ${upper}`);
    assert.notEqual(altitudeOf(upper), altitudeOf(upper - 1));
  }
  // and a view that holds no boundary holds no fog
  const ctx = stubCtx();
  paintFog(ctx, FARM_THEMES.light, 0, 1, { top: groundYOf(1) - 40, bottom: groundYOf(0) });
  assert.equal(ctx.calls.length, 0, 'fog in the valley');
});

test('fireflies are the evening only, and are simply gone when motion is off', () => {
  assert.equal(FARM_THEMES.light.firefly, null);
  assert.ok(FARM_THEMES.dark.firefly);
  const day = stubCtx();
  paintFireflies(day, FARM_THEMES.light, 5000, 1);
  assert.equal(day.calls.length, 0, 'fireflies at breakfast');
  const still = stubCtx();
  paintFireflies(still, FARM_THEMES.dark, 5000, 0);
  assert.equal(still.calls.length, 0, 'a still firefly is a dot on a hill');
  const dusk = stubCtx();
  paintFireflies(dusk, FARM_THEMES.dark, 5000, 1);
  assert.ok(dusk.calls.includes('fill'), 'nothing is out in the evening');
  assert.equal(dusk.depth, 0);
});

test('fireflies are spread up the mountain and never stop moving', () => {
  const seen = new Set();
  for (const tMs of [0, 1500, 7000, 33000, 250000]) {
    const ctx = stubCtx();
    paintFireflies(ctx, FARM_THEMES.dark, tMs, 1);
    seen.add(ctx.calls.length);
    assert.ok(ctx.calls.length > 0, `nothing lit at ${tMs}ms`);
  }
  // a closed-form loop draws the same COUNT every frame; what changes is where
  assert.equal(seen.size, 1, 'the firefly count wobbles frame to frame');
  // and wherever the player has scrolled to, a few are out
  const H = worldHeight();
  for (const top of [0, H / 3, H - 690]) {
    const ctx = stubCtx();
    paintFireflies(ctx, FARM_THEMES.dark, 5000, 1, { top, bottom: top + 690 });
    assert.ok(ctx.calls.length >= 2, `no fireflies in the view at ${top}`);
  }
});

// ── the palette rule ───────────────────────────────────────────────────────

test('the mountainside has no colour of its own outside FARM_THEMES', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/farm-scene.js'), 'utf8');
  const end = src.indexOf('export function farmThemeOf');
  const table = src.slice(src.indexOf('export const FARM_THEMES'), end);
  for (const m of src.slice(end).matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi)) {
    assert.fail(`js/farm-scene.js paints with a loose colour literal ${m[0]}`);
  }
  assert.ok(table.length > 0);
  // and nothing random or clock-driven: every frame is a function of its arguments
  const code = src.replace(/\/\/.*$/gm, '');
  assert.ok(!/Math\.random|Date\.now|performance\.now/.test(code), 'the scene reads a clock or a die of its own');
});

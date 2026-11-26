// The mountainside: everything behind and around the plants.
//
// Sibling of js/scene.js and the same contract — a 2D context in, nothing
// global touched, everything static precomputed at module load, a handful of
// gently animated elements and all of them off under reduced motion. Tests
// under node against a stub.
//
// The picture is central Taiwan seen from the road below: stone-walled terraces
// stacked up a tall slope, a stream stepping down the left-hand side in little
// falls, the farmhouse and its red-tiled roof at the foot, fog lying where the
// valley gives way to the hillside and the hillside to the ridge, and three
// ranges of mountains behind. Light theme is a clear morning; dark is evening,
// lit by the same paper lanterns the stall hangs — the market and the farm are
// one place at two hours of the day.
//
// The world is TALL (js/farm-layout.js owns every number about where things
// are; this file only draws to them) and the host scrolls a window up and down
// it, so the painters that cover the whole height take an optional
// `view = { top, bottom }` in world y and skip what is off screen. Leave it out
// and they paint the lot — which is what the tests do.
//
// Budget: everything that shares a colour is batched into ONE path and filled
// once — a wall is forty stones but five fills — and every gradient is built
// once per context and reused, mostly at a translated origin so one gradient
// serves every terrace.

import { MAX_TERRACES } from './constants.js';
import {
  LAYOUT, worldHeight, groundYOf, groundYAt, terraceGeom, tileGeom,
  streamXAt, streamRightAt, streamCenterAt, streamWAt, forSaleBox, terracePriceBox,
} from './farm-layout.js';
import { altitudeOf } from './terrain.js';

export { forSaleBox, terracePriceBox };

// Timings and sizes that are about the ART rather than about where things are.
export const FARM_ART = {
  fogDriftMs: 26000, fogDrift: 16,
  shimmerMs: 2600,
  cloudMs: 240000,                       // one lap of the sky: you notice it, you do not watch it
  signSwayMs: 4200, signSway: 0.026,     // radians about the posts: a breeze, not a pendulum
  lanternPool: 96,
  // the lowest terrace of each altitude band carries a marker post
  bandStarts: [0, 3, 7],
  bandNames: { low: '谷地', mid: '山腰', high: '高山' },
};

export const FARM_THEMES = {
  light: {
    id: 'light',
    sky: ['#a9d6ee', '#fdf1d6'],          // device letterbox: clear morning, warm at the horizon
    skyWorld: ['#8fcbec', '#cbe8f3', '#fff3da'],
    sun: '#fff6d2', sunGlow: ['rgba(255, 244, 200, 0.75)', 'rgba(255, 244, 200, 0)'],
    moon: null, moonShade: null, star: null,
    cloud: '#ffffff', cloudShade: '#dcebf3',
    bird: 'rgba(70, 86, 104, 0.55)',
    // far → near; each fades into the haze at its foot
    ridges: ['#b4cde0', '#93b8c4', '#7ba693'],
    ridgeHaze: '#eef4ee',
    ridgeLight: 'rgba(255, 255, 255, 0.28)',
    hillHigh: '#7fae86', hillMid: '#8cbb68', hillLow: '#9cc25e',
    bankShadow: ['rgba(38, 70, 40, 0.26)', 'rgba(38, 70, 40, 0)'],
    patchLight: 'rgba(214, 240, 150, 0.26)', patchDark: 'rgba(60, 110, 50, 0.12)',
    shrub: '#5d9446', shrubLight: '#86bd5a',
    tree: '#4e8a4c', treeLight: '#74b25c', trunk: '#7a5a3c',
    bamboo: '#6f9e44', bambooLeaf: '#8fbf52',
    rock: '#c4bcab', rockDark: '#978e7e',
    soil: '#93693f', soilDark: '#6d4c2d', soilLight: '#b08556',
    stone: '#cdbfa5', stoneAlt: '#bfb197', stoneLight: '#e6dcc6', stoneShade: 'rgba(90, 74, 52, 0.30)',
    mortar: '#8a7d68', moss: '#86ac54',
    wallUnowned: 'rgba(60, 64, 40, 0.22)',
    grass: '#93c45c', grassDark: '#6f9f45',
    weeds: '#7d9f52', weedsTall: '#a3c46c', overgrown: '#78a04c',
    flowers: ['#f5a9bd', '#fff1a0', '#c8b5ee'],
    // the altitude bands, tinted over each terrace: warm valley, cool ridge
    tint: { low: 'rgba(255, 196, 110, 0.10)', mid: null, high: 'rgba(120, 165, 220, 0.14)' },
    fog: ['rgba(255, 253, 246, 0)', 'rgba(255, 253, 246, 0.5)'],
    stream: '#8ccbe3', streamDark: '#5d9fc0', streamLight: '#c8ecf6',
    foam: 'rgba(255, 255, 255, 0.85)', shimmer: 'rgba(255, 255, 255, 0.7)',
    bank: '#9a8a6e',
    pipe: '#7f8c94', pipeLight: '#b8c4ca',
    road: '#d6b98a', roadDark: '#b8966a', roadEdge: '#a7865c',
    house: '#f8f3e8', houseShade: '#ddd3c1',
    roof: '#c9573f', roofDark: '#9a3d2d', roofLight: '#e07a5d',
    door: '#7a4e30', window: '#6f8fa6', couplet: '#d23c50',
    crate: '#c9a06a', crateDark: '#94703f', fruit: '#f39a3a', fruitAlt: '#e8c23a',
    smoke: 'rgba(255, 255, 255, 0.55)',
    sign: '#dcbc8c', signDark: '#b8935e', signEdge: '#8a6742', signInk: '#8a2436',
    noteInk: 'rgba(90, 70, 50, 0.72)',
    text: '#5a4632',
    lantern: null,                        // morning: the lanterns are unlit
    lanternGlow: null,
    signGlow: null,                       // …and nothing needs lighting
    firefly: null,                        // …and nothing is out yet
  },
  // Dusk, and the same evening the stall is open in — which means WARM. The
  // first version of this table was a night table: near-black greens, cold blue
  // fog, and a mountainside that read as a void with nothing to do on it. Every
  // colour here has been walked a step toward the lantern it is standing under.
  dark: {
    id: 'dark',
    sky: ['#2c2550', '#6d4552'],          // dusk over the ridge, sunset at the horizon
    skyWorld: ['#29224e', '#5a3c63', '#b3675c'],
    sun: null, sunGlow: ['rgba(255, 230, 190, 0.30)', 'rgba(255, 230, 190, 0)'],
    moon: '#fbebc8', moonShade: 'rgba(120, 90, 120, 0.35)', star: '#fff4d8',
    cloud: '#86607a', cloudShade: '#5e4466',
    bird: null,
    ridges: ['#6d5784', '#524569', '#40394f'],
    ridgeHaze: '#a2625e',
    ridgeLight: 'rgba(255, 200, 170, 0.10)',
    hillHigh: '#44585e', hillMid: '#4b6449', hillLow: '#58694a',
    bankShadow: ['rgba(20, 14, 20, 0.34)', 'rgba(20, 14, 20, 0)'],
    patchLight: 'rgba(240, 200, 130, 0.10)', patchDark: 'rgba(30, 20, 20, 0.14)',
    shrub: '#3a4a2e', shrubLight: '#56663c',
    tree: '#33432f', treeLight: '#4f5f3a', trunk: '#4a3626',
    bamboo: '#4a5a32', bambooLeaf: '#61733e',
    rock: '#7a6e5e', rockDark: '#544b40',
    soil: '#5e4630', soilDark: '#3f2e1e', soilLight: '#76593b',
    stone: '#7a6a55', stoneAlt: '#6c5d4a', stoneLight: '#958267', stoneShade: 'rgba(20, 12, 8, 0.34)',
    mortar: '#3d3328', moss: '#56653a',
    wallUnowned: 'rgba(20, 16, 24, 0.28)',
    grass: '#5e7040', grassDark: '#46552f',
    weeds: '#4f5e36', weedsTall: '#667645', overgrown: '#46552f',
    flowers: ['#d98a9e', '#f0d890', '#a898d0'],
    tint: { low: 'rgba(255, 170, 90, 0.10)', mid: null, high: 'rgba(110, 120, 200, 0.14)' },
    // A thin warm haze rather than a cold band: evening air over turned earth,
    // not weather.
    fog: ['rgba(228, 202, 186, 0)', 'rgba(228, 202, 186, 0.16)'],
    stream: '#3f6178', streamDark: '#2a4356', streamLight: '#6d8fa6',
    foam: 'rgba(230, 236, 255, 0.55)', shimmer: 'rgba(255, 214, 160, 0.45)',
    bank: '#4f4334',
    pipe: '#5a5f62', pipeLight: '#848a8c',
    road: '#7d6448', roadDark: '#634d36', roadEdge: '#54412d',
    house: '#d9cdb8', houseShade: '#a99c88',
    roof: '#8e3a2e', roofDark: '#62271f', roofLight: '#a8503e',
    door: '#3e2a1c', window: '#ffc874', couplet: '#c23a48',
    crate: '#7a5e3e', crateDark: '#54402a', fruit: '#e08a38', fruitAlt: '#d0aa3a',
    smoke: 'rgba(230, 210, 200, 0.30)',
    sign: '#7a6040', signDark: '#5e4930', signEdge: '#3a2c1c', signInk: '#ef6478',
    noteInk: 'rgba(232, 220, 200, 0.70)',
    text: '#e8dcc8',
    lantern: '#ffb45a',                   // evening: lanterns by the house and the bridge
    lanternGlow: ['rgba(255, 190, 110, 0.34)', 'rgba(255, 178, 96, 0.13)', 'rgba(255, 190, 110, 0)'],
    // …and one over the sign, so the only writing on the mountain is the one
    // thing dusk cannot swallow. Inner stop then transparent, same shape as the
    // lantern pools.
    signGlow: ['rgba(255, 190, 110, 0.34)', 'rgba(255, 190, 110, 0)'],
    firefly: '#ffe08a',                   // …and the evening has something living in it
  },
};

export function farmThemeOf(settings) {
  return FARM_THEMES[settings && settings.theme === 'dark' ? 'dark' : 'light'];
}

// ── world facts this file keeps asking for ────────────────────────────────

const W = LAYOUT.width;
const H = worldHeight();
const TOP_G = groundYOf(MAX_TERRACES - 1);
const BOTTOM_WALL = groundYOf(0) + LAYOUT.wallH;   // nominal: the real foot wanders
const SPAN_L = -40, SPAN_R = W + 40;       // horizontal reach of "everything"
const ROAD_Y = H - 46;                     // top edge of the road
const ROAD_H = 26;

// The hill's crest above the top terrace: a gentle dome, highest just right of
// centre, so the slope reads as a mountain and not as a wall of green.
function crestY(x) {
  const u = (x - 210) / 220;
  return TOP_G - 96 + u * u * 96;
}

function inView(view, y0, y1) {
  return !view || (y1 >= view.top && y0 <= view.bottom);
}

// ── precomputed static geometry ────────────────────────────────────────────

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Three ranges behind the farm, built once. Per-frame noise would make the
// mountains crawl, which is the one thing mountains must never do.
function ridge(seed, base, amp, step, wobble) {
  const rnd = lcg(seed);
  const pts = [];
  for (let x = SPAN_L - 20; x <= SPAN_R + 20; x += step) {
    pts.push({ x, y: base - rnd() * amp - Math.sin(x / wobble + seed) * amp * 0.6 });
  }
  return pts;
}
const RIDGES = [
  { pts: ridge(7717, 84, 50, 30, 70), foot: 200 },
  { pts: ridge(3391, 112, 40, 24, 55), foot: 220 },
  { pts: ridge(5113, 138, 30, 16, 38), foot: 240 },
];
const CREST = (() => {
  const pts = [];
  for (let x = SPAN_L; x <= SPAN_R; x += 20) pts.push({ x, y: crestY(x) });
  return pts;
})();

// ── the shelves, along their contours ──────────────────────────────────────
//
// Every shelf follows its own ground line (farm-layout's groundYAt), which
// bows and tilts, and has its own ends: it starts against the stream's bank
// and runs out into the hillside at its own length. All of that is fixed, so
// it is all worked out here, once: the contour sampled every few units, the
// stones laid along it course by course, the grass lip, the weeds.

const STEP = 6;
const WALL_STONE_H = [7.6, 7.2, 7.2];

function sample(i, from, to) {
  const pts = [];
  for (let x = from; x < to; x += STEP) pts.push({ x, y: groundYAt(i, x) });
  pts.push({ x: to, y: groundYAt(i, to) });
  return pts;
}

const SHELVES = Array.from({ length: MAX_TERRACES }, (_, i) => {
  const t = terraceGeom(i);
  const L = t.left;
  const offEdge = t.right >= W - 1;          // runs off the world: no visible end
  const R = offEdge ? W + 30 : t.right;
  const top = sample(i, L, R);
  const rndB = lcg(1900 + i * 37);
  // the foot of the wall wanders a little: dry stone, not a ruler
  const bottom = top.map((p) => ({ x: p.x, y: p.y + LAYOUT.wallH + (rndB() - 0.5) * 1.6 }));
  const yL = top[0].y, yR = top[top.length - 1].y;

  // stones: three courses laid ALONG the contour, each skewed to it
  const rnd = lcg(1300 + i * 97);
  const stones = [];
  let off = 0.6;
  WALL_STONE_H.forEach((rh, row) => {
    let x = L - 4 - row * 3 - rnd() * 4;
    while (x < R + 4) {
      const w = 13 + rnd() * 17;
      stones.push({
        x, w, h: rh - 1.1,
        yl: groundYAt(i, x) + off, yr: groundYAt(i, x + w) + off,
        alt: rnd() < 0.42, moss: row === 0 && rnd() < 0.22,
      });
      x += w + 1.2;
    }
    off += rh;
  });

  // the grassy lip hanging over the wall top
  const rndL = lcg(2100 + i * 53);
  const lip = [];
  for (let x = L; x < R; x += 5 + rndL() * 5) lip.push({ x, y: groundYAt(i, x), d: 1.5 + rndL() * 3.2 });
  lip.push({ x: R, y: yR, d: 0 });

  // what an unbought shelf has gone to: tall grass, wildflowers, a bush or two
  const rndO = lcg(4400 + i * 31);
  const a = L + 4, b = Math.min(R, W) - 6, span = b - a;
  const at = (x, dy) => groundYAt(i, x) - LAYOUT.soilH - dy;
  const blades = Array.from({ length: 46 }, () => {
    const x = a + rndO() * span;
    return { x, y: at(x, 0), h: 8 + rndO() * 16, lean: (rndO() - 0.5) * 9, tall: rndO() < 0.45 };
  });
  const flowers = Array.from({ length: 14 }, () => {
    const x = a + 4 + rndO() * (span - 8);
    return { x, y: at(x, 6 + rndO() * 16), r: 1.3 + rndO() * 1.1, c: Math.floor(rndO() * 3) };
  });
  const bushes = Array.from({ length: 2 }, (__, k) => {
    const x = a + span * (0.18 + k * 0.55 + rndO() * 0.2);
    return { x, y: at(x, 0), r: 9 + rndO() * 5 };
  });

  // a few bank stones where the wall butts against the stream
  const rocks = [[L - 1, yL + 5, 5.5], [L + 2, yL + LAYOUT.wallH - 4, 6.5], [L - 3, yL - 2, 4], [L + 5, yL + 13, 3.6]];

  return { i, L, R, offEdge, top, bottom, yL, yR, stones, lip, blades, flowers, bushes, rocks };
});

// The outline of a shelf body from `up` above its ground line down to its
// wall's foot, with a rounded end on the right where the shelf runs out into
// the hillside. One path, used for the mortar, the clip and the tint.
function shelfBody(ctx, sh, up) {
  const { top, bottom, R, yR, offEdge } = sh;
  ctx.moveTo(top[0].x, top[0].y - up);
  for (const p of top) ctx.lineTo(p.x, p.y - up);
  const by = bottom[bottom.length - 1].y;
  if (offEdge) ctx.lineTo(R, by);
  else ctx.bezierCurveTo(R + 9, yR - up + 4, R + 7, by - 4, R - 6, by + 0.5);
  for (let k = bottom.length - 1; k >= 0; k--) ctx.lineTo(bottom[k].x, bottom[k].y);
  ctx.closePath();
}

// A stone skewed to the contour: its top edge runs yl→yr, its bottom h below.
function skewStone(ctx, x, w, yl, yr, h, r) {
  const yt = (px) => yl + (yr - yl) * (px - x) / w;
  ctx.moveTo(x + r, yt(x + r));
  ctx.lineTo(x + w - r, yt(x + w - r));
  ctx.quadraticCurveTo(x + w, yr, x + w, yr + r);
  ctx.lineTo(x + w, yr + h - r);
  ctx.quadraticCurveTo(x + w, yr + h, x + w - r, yt(x + w - r) + h);
  ctx.lineTo(x + r, yt(x + r) + h);
  ctx.quadraticCurveTo(x, yl + h, x, yl + h - r);
  ctx.lineTo(x, yl + r);
  ctx.quadraticCurveTo(x, yl, x + r, yt(x + r));
  ctx.closePath();
}

// Stroke-ready polyline along a shelf's contour, `dy` below it, from x0 to x1.
function alongContour(ctx, sh, dy, x0 = -Infinity, x1 = Infinity) {
  let started = false;
  for (const p of sh.top) {
    if (p.x < x0 || p.x > x1) continue;
    if (!started) { ctx.moveTo(p.x, p.y + dy); started = true; } else ctx.lineTo(p.x, p.y + dy);
  }
}

// The bank behind each shelf: a few soft patches of lighter and darker grass,
// so the slope has a texture rather than a colour.
const PATCHES = Array.from({ length: MAX_TERRACES }, (_, i) => {
  const rnd = lcg(5100 + i * 71);
  return Array.from({ length: 7 }, () => ({
    x: LAYOUT.left + rnd() * (W - LAYOUT.left), y: 20 + rnd() * 54, rx: 20 + rnd() * 34, ry: 2.5 + rnd() * 3.5, light: rnd() < 0.55,
  }));
});

// Framing on the right-hand edge, outside the shelves: a tree or a clump of
// bamboo per band, alternating, half off the world so they read as "the
// hillside carries on" rather than as things planted on the farm.
const FRAMING = Array.from({ length: MAX_TERRACES }, (_, i) => {
  const rnd = lcg(6200 + i * 13);
  if (i % 2 === 0) {
    return { kind: 'bamboo', culms: Array.from({ length: 4 }, (__, k) => ({ x: W - 6 + k * 6 + rnd() * 3, h: 58 + rnd() * 26, lean: 2 + rnd() * 5 })) };
  }
  return { kind: 'tree', x: W + 2 + rnd() * 6, r: 20 + rnd() * 6 };
});

// The crest: a row of rounded trees and tea bushes along the top of the hill.
const CREST_TREES = (() => {
  const rnd = lcg(7311);
  const out = [];
  for (let x = SPAN_L + 10; x < SPAN_R; x += 22 + rnd() * 26) {
    out.push({ x, r: 9 + rnd() * 9, y: crestY(x) + 4 });
  }
  return out;
})();

// The stream, sampled once: both banks every few units from the spring to the
// bottom of the world, so a frame walks an array rather than the meander.
const STREAM_TOP = crestY(streamCenterAt(TOP_G - 80)) - 6;
const BANK_STEP = 8;
const BANKS = (() => {
  const out = [];
  for (let y = STREAM_TOP; y < H + 10 + BANK_STEP; y += BANK_STEP) out.push({ y, l: streamXAt(y), r: streamRightAt(y) });
  return out;
})();

// Pebbles along both banks, wherever the banks happen to be.
const PEBBLES = (() => {
  const rnd = lcg(8800);
  const out = [];
  for (let y = STREAM_TOP + 20; y < H; y += 12 + rnd() * 18) {
    const side = rnd() < 0.5;
    out.push({ y, x: side ? streamRightAt(y) + 1.5 : streamXAt(y) - 1.5, r: 1.8 + rnd() * 2.2 });
  }
  return out;
})();

// Still ripples on the water: there with or without motion.
const RIPPLES = (() => {
  const rnd = lcg(9901);
  const out = [];
  for (let y = STREAM_TOP + 16; y < H; y += 22 + rnd() * 18) {
    out.push({ y, x: streamXAt(y) + streamWAt(y) * (0.2 + rnd() * 0.45), len: 4 + rnd() * 6 });
  }
  return out;
})();

// Where the stream steps down past each wall: level with the wall it runs
// beside, as wide as the water is there.
const FALLS = SHELVES.map((sh) => {
  const y = sh.yL - 2;
  const l = streamXAt(y + 10), w = streamWAt(y + 10);
  return { x: l + 2, y, w: w - 4, h: LAYOUT.wallH + 4 };
});

const STARS = (() => {
  const rnd = lcg(3003);
  return Array.from({ length: 26 }, (_, k) => ({ x: rnd() * W, y: 6 + rnd() * 150, r: 0.5 + rnd() * 0.9, g: k % 3 }));
})();

const CLOUDS = [
  { x: 40, y: 44, s: 1.0, lobes: [[0, 0, 13], [14, -6, 15], [30, -1, 12], [44, 3, 8], [-12, 4, 8]] },
  { x: 230, y: 92, s: 0.75, lobes: [[0, 0, 12], [14, -7, 14], [28, 0, 11], [-11, 3, 7]] },
  { x: 150, y: 18, s: 0.55, lobes: [[0, 0, 11], [13, -5, 12], [25, 1, 9]] },
];

// Fireflies, spread up the whole mountain. Each one is a closed-form Lissajous
// loop off its own period and phase, so nothing is simulated, nothing
// accumulates, and a dropped frame cannot leave one stranded.
const FIREFLIES = (() => {
  const rnd = lcg(8123);
  return Array.from({ length: 18 }, () => ({
    x: 50 + rnd() * (W - 90),
    y: TOP_G - 40 + rnd() * (BOTTOM_WALL + 60 - TOP_G),
    rx: 16 + rnd() * 30, ry: 10 + rnd() * 22,
    ms: 9000 + rnd() * 11000,
    phase: rnd() * Math.PI * 2,
    blinkMs: 2200 + rnd() * 2600,
    r: 1.1 + rnd() * 0.9,
  }));
})();

const gradients = new WeakMap();
function cached(ctx, key, make) {
  let byKey = gradients.get(ctx);
  if (!byKey) { byKey = new Map(); gradients.set(ctx, byKey); }
  let grad = byKey.get(key);
  if (grad === undefined) { grad = make(); byKey.set(key, grad); }
  return grad;
}

// ── drawing helpers (path building only: the caller fills) ────────────────

function smoothThrough(ctx, pts) {
  for (let k = 1; k < pts.length - 1; k++) {
    const mx = (pts[k].x + pts[k + 1].x) / 2, my = (pts[k].y + pts[k + 1].y) / 2;
    ctx.quadraticCurveTo(pts[k].x, pts[k].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

function roundBox(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function disc(ctx, x, y, r) {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function blob(ctx, x, y, rx, ry) {
  ctx.moveTo(x + rx, y);
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

// A soft round glow, cached at the origin and painted translated.
function glow(ctx, th, key, stops, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = cached(ctx, `farm-glow:${th.id}:${key}:${r}`, () => {
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
    stops.forEach((c, k) => g.addColorStop(k / (stops.length - 1), c));
    return g;
  });
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── the layers ─────────────────────────────────────────────────────────────

/** Sky. Drawn in DEVICE space so it fills the letterbox too. */
export function paintFarmSky(ctx, th, width, height) {
  ctx.fillStyle = cached(ctx, `farmsky:${th.id}:${height}`, () => {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(1, th.sky[1]);
    return g;
  });
  ctx.fillRect(0, 0, width, height);
}

/**
 * The sky over the top of the world, in world space: a gradient down to the
 * ridges, the sun (morning) or the moon and a scatter of stars (dusk), two or
 * three flat storybook clouds and, in the morning, a couple of far birds.
 * Clouds and birds drift only when `motion`; stars twinkle only when `motion`.
 */
export function paintSky(ctx, th, tMs, motion) {
  const t = motion ? tMs || 0 : 0;
  const bottom = 300;
  ctx.fillStyle = cached(ctx, `farm-skyworld:${th.id}`, () => {
    const g = ctx.createLinearGradient(0, 0, 0, bottom);
    g.addColorStop(0, th.skyWorld[0]);
    g.addColorStop(0.55, th.skyWorld[1]);
    g.addColorStop(1, th.skyWorld[2]);
    return g;
  });
  ctx.fillRect(SPAN_L, -400, SPAN_R - SPAN_L, bottom + 400);

  if (th.star) {
    ctx.save();
    ctx.fillStyle = th.star;
    for (let grp = 0; grp < 3; grp++) {
      ctx.globalAlpha = motion ? 0.45 + 0.4 * Math.sin(t / 1700 + grp * 2.1) : 0.6 + grp * 0.1;
      ctx.beginPath();
      for (const s of STARS) if (s.g === grp) disc(ctx, s.x, s.y, s.r);
      ctx.fill();
    }
    ctx.restore();
  }

  // the sun or the moon, up and to the right, with a halo
  const bx = 292, by = 58;
  glow(ctx, th, 'orb', th.sunGlow, bx, by, 64);
  if (th.sun) {
    ctx.fillStyle = th.sun;
    ctx.beginPath();
    disc(ctx, bx, by, 15);
    ctx.fill();
  } else if (th.moon) {
    ctx.fillStyle = th.moon;
    ctx.beginPath();
    disc(ctx, bx, by, 11);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = th.moonShade;
    ctx.beginPath();
    disc(ctx, bx + 6, by + 3, 11);
    ctx.fill();
    ctx.restore();
  }

  // clouds: a shadow body, then the lit body nudged up — two tones, no outline
  for (const [k, c] of CLOUDS.entries()) {
    const lap = W + 160;
    const x = ((c.x + (t / FARM_ART.cloudMs) * lap * (0.6 + k * 0.25)) % lap + lap) % lap - 80;
    for (const [fill, dy, shrink] of [[th.cloudShade, 2.5, 0], [th.cloud, -0.5, 1.6]]) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (const [lx, ly, r] of c.lobes) disc(ctx, x + lx * c.s, c.y + ly * c.s + dy, Math.max(1, r * c.s - shrink));
      ctx.fill();
    }
  }

  if (th.bird) {
    ctx.strokeStyle = th.bird;
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [k, [bx0, by0]] of [[70, 86], [84, 80], [196, 60]].entries()) {
      const x = bx0 + (motion ? ((t / 900 + k * 40) % 420) - 30 : 0);
      const y = by0 + (motion ? Math.sin(t / 1300 + k) * 2 : 0);
      const flap = motion ? Math.sin(t / 220 + k * 1.7) * 1.6 : 0;
      ctx.moveTo(x - 4, y - 1.5 - flap);
      ctx.quadraticCurveTo(x - 1.5, y - 2, x, y);
      ctx.quadraticCurveTo(x + 1.5, y - 2, x + 4, y - 1.5 - flap);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
}

/** Three ranges behind the farm, far to near, each fading into the haze at its foot. */
export function paintRidges(ctx, th) {
  for (const [k, r] of RIDGES.entries()) {
    const top = Math.min(...r.pts.map((p) => p.y));
    ctx.fillStyle = cached(ctx, `farm-ridge:${th.id}:${k}`, () => {
      const g = ctx.createLinearGradient(0, top, 0, r.foot);
      g.addColorStop(0, th.ridges[k]);
      g.addColorStop(1, th.ridgeHaze);
      return g;
    });
    ctx.beginPath();
    ctx.moveTo(r.pts[0].x, r.foot + 200);
    ctx.lineTo(r.pts[0].x, r.pts[0].y);
    smoothThrough(ctx, r.pts);
    ctx.lineTo(r.pts[r.pts.length - 1].x, r.foot + 200);
    ctx.closePath();
    ctx.fill();
  }
  // the morning (or the last of the sunset) catching the left-hand faces of
  // the nearest range: one pale wash, cheap, and the whole range gains a side
  const near = RIDGES[2].pts;
  ctx.fillStyle = th.ridgeLight;
  ctx.beginPath();
  for (let k = 1; k < near.length - 1; k++) {
    const a = near[k - 1], p = near[k], b = near[k + 1];
    if (p.y < a.y && p.y <= b.y) {          // a local peak: light its sunward slope
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(a.x, a.y);
      ctx.lineTo(a.x + 6, a.y + 22);
      ctx.closePath();
    }
  }
  ctx.fill();
}

/**
 * The slope the terraces are cut into, behind every shelf: one body of green
 * from the crest to the road, warm at the valley and cooling toward the ridge;
 * a shadow under every wall; soft patches of lighter and darker grass; trees
 * and bamboo off the right-hand edge for framing, and a line of trees along the
 * crest. `view` (optional, world y) skips bands that are off screen.
 */
export function paintHillside(ctx, th, view) {
  ctx.fillStyle = cached(ctx, `farm-hill:${th.id}`, () => {
    const g = ctx.createLinearGradient(0, TOP_G - 90, 0, BOTTOM_WALL);
    g.addColorStop(0, th.hillHigh);
    g.addColorStop(0.5, th.hillMid);
    g.addColorStop(1, th.hillLow);
    return g;
  });
  ctx.beginPath();
  ctx.moveTo(CREST[0].x, H + 40);
  ctx.lineTo(CREST[0].x, CREST[0].y);
  smoothThrough(ctx, CREST);
  ctx.lineTo(SPAN_R, H + 40);
  ctx.closePath();
  ctx.fill();

  if (inView(view, TOP_G - 140, TOP_G)) paintCrest(ctx, th);

  const shade = wallShade(ctx, th);

  for (let i = 0; i < MAX_TERRACES; i++) {
    const g = groundYOf(i);
    const bankTop = g - LAYOUT.bandH + LAYOUT.wallH;   // the foot of the wall above
    if (!inView(view, bankTop - 30, g + LAYOUT.wallH)) continue;

    // the wall above throws its shade down the bank (not on the top shelf,
    // which has no wall above it), following that wall's wandering foot
    if (i < MAX_TERRACES - 1) paintWallShadow(ctx, shade, SHELVES[i + 1]);

    for (const light of [true, false]) {
      ctx.fillStyle = light ? th.patchLight : th.patchDark;
      ctx.beginPath();
      for (const p of PATCHES[i]) if (p.light === light) blob(ctx, p.x, bankTop + p.y, p.rx, p.ry);
      ctx.fill();
    }

    paintFraming(ctx, th, FRAMING[i], i);
  }
}

function paintCrest(ctx, th) {
  for (const [fill, dx, dy, k] of [[th.tree, 0, 0, 1], [th.treeLight, -2.5, -3, 0.62]]) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (const t of CREST_TREES) {
      disc(ctx, t.x + dx, t.y - t.r * 0.6 + dy, t.r * k);
      disc(ctx, t.x + t.r * 0.7 + dx, t.y - t.r * 0.2 + dy, t.r * 0.7 * k);
    }
    ctx.fill();
  }
}

// The shade a wall throws on the slope below it. The gradient is cached at
// the origin and painted translated to the wall's nominal foot; the shape
// follows the real foot, which wanders a few units either side of it.
const SHADE_D = 34;
function wallShade(ctx, th) {
  return cached(ctx, `farm-wallshade:${th.id}`, () => {
    const g = ctx.createLinearGradient(0, -12, 0, SHADE_D);
    g.addColorStop(0, th.bankShadow[0]);
    g.addColorStop(0.3, th.bankShadow[0]);
    g.addColorStop(1, th.bankShadow[1]);
    return g;
  });
}

function paintWallShadow(ctx, shade, sh) {
  const base = groundYOf(sh.i) + LAYOUT.wallH;
  ctx.save();
  ctx.translate(0, base);
  ctx.fillStyle = shade;
  ctx.beginPath();
  const pts = sh.bottom;
  ctx.moveTo(pts[0].x - 6, pts[0].y - base);
  for (const p of pts) ctx.lineTo(p.x, p.y - base - 1);
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x + 10, last.y - base + SHADE_D * 0.4);
  for (let k = pts.length - 1; k >= 0; k -= 2) ctx.lineTo(pts[k].x, pts[k].y - base + SHADE_D);
  ctx.lineTo(pts[0].x - 6, pts[0].y - base + SHADE_D);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function paintFraming(ctx, th, f, i) {
  const foot = groundYAt(i, f.kind === 'tree' ? f.x : f.culms[0].x) - LAYOUT.soilH;
  if (f.kind === 'bamboo') {
    ctx.strokeStyle = th.bamboo;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (const c of f.culms) {
      ctx.moveTo(c.x, foot);
      ctx.quadraticCurveTo(c.x, foot - c.h * 0.6, c.x - c.lean, foot - c.h);
    }
    ctx.stroke();
    ctx.fillStyle = th.bambooLeaf;
    ctx.beginPath();
    for (const c of f.culms) {
      for (let k = 0; k < 4; k++) {
        const y = foot - c.h * (0.55 + k * 0.13);
        const x = c.x - c.lean * (0.4 + k * 0.18);
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x - 6, y - 3, x - 12, y + 1);
        ctx.quadraticCurveTo(x - 6, y + 1, x, y);
      }
    }
    ctx.fill();
  } else {
    ctx.fillStyle = th.trunk;
    ctx.fillRect(f.x - 2, foot - f.r * 1.6, 4, f.r * 1.6);
    for (const [fill, dx, dy, k] of [[th.tree, 0, 0, 1], [th.treeLight, -4, -4, 0.62]]) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      disc(ctx, f.x + dx, foot - f.r * 2 + dy, f.r * k);
      disc(ctx, f.x - f.r * 0.75 + dx, foot - f.r * 1.45 + dy, f.r * 0.7 * k);
      ctx.fill();
    }
  }
}

/**
 * The stream down the left of the mountain — the irrigation fantasy made
 * visible long before it is affordable. It steps down the slope in a little
 * fall beside every terrace wall. Under reduced motion the water is simply
 * still (ripples and falls are drawn, nothing slides); with motion a shimmer
 * slides down it and the falls run. `view` (optional, world y) clips the work.
 */
export function paintStream(ctx, th, tMs, motion, view) {
  const top = STREAM_TOP;
  const y0 = Math.max(top, view ? view.top - 20 : top);
  const y1 = Math.min(H + 10, view ? view.bottom + 20 : H + 10);
  if (y1 <= y0) return;
  const k0 = Math.max(0, Math.floor((y0 - top) / BANK_STEP));
  const k1 = Math.min(BANKS.length - 1, Math.ceil((y1 - top) / BANK_STEP));
  if (k1 <= k0) return;

  // left bank down, right bank up, `pad` outside the water
  const band = (pad) => {
    ctx.moveTo(BANKS[k0].l - pad, BANKS[k0].y);
    for (let k = k0; k <= k1; k++) ctx.lineTo(BANKS[k].l - pad, BANKS[k].y);
    for (let k = k1; k >= k0; k--) ctx.lineTo(BANKS[k].r + pad, BANKS[k].y);
    ctx.closePath();
  };

  // banks: a strip of earth and stone either side of the water
  ctx.fillStyle = th.bank;
  ctx.beginPath();
  band(3.5);
  ctx.fill();
  ctx.fillStyle = th.stream;
  ctx.beginPath();
  band(0);
  ctx.fill();
  // the deeper water along both banks, so the band has a shape and a depth
  ctx.strokeStyle = th.streamDark;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(BANKS[k0].l + 1.5, BANKS[k0].y);
  for (let k = k0; k <= k1; k++) ctx.lineTo(BANKS[k].l + 1.5, BANKS[k].y);
  ctx.moveTo(BANKS[k0].r - 1.5, BANKS[k0].y);
  for (let k = k0; k <= k1; k++) ctx.lineTo(BANKS[k].r - 1.5, BANKS[k].y);
  ctx.stroke();

  // the spring at its head: a little pool among bushes and rocks, so the
  // water comes from somewhere rather than out of a straight edge
  if (y0 === top) {
    const px = streamCenterAt(top), w = streamWAt(top);
    for (const [fill, dx, dy, k] of [[th.shrub, 0, 0, 1], [th.shrubLight, -2, -3, 0.6]]) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      disc(ctx, px - 12 + dx, top - 7 + dy, 11 * k);
      disc(ctx, px + 7 + dx, top - 9 + dy, 13 * k);
      disc(ctx, px + 24 + dx, top - 3 + dy, 8 * k);
      ctx.fill();
    }
    ctx.fillStyle = th.bank;
    ctx.beginPath();
    blob(ctx, px, top + 1, w * 0.95, 6);
    ctx.fill();
    ctx.fillStyle = th.stream;
    ctx.beginPath();
    blob(ctx, px, top + 1.5, w * 0.8, 3.8);
    ctx.fill();
    for (const [fill, dy, k] of [[th.rockDark, 0.8, 1], [th.rock, -0.4, 0.78]]) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      blob(ctx, px - w * 0.95, top + 3 + dy, 6 * k, 4 * k);
      blob(ctx, px + w * 0.92, top + 2 + dy, 7 * k, 4.5 * k);
      ctx.fill();
    }
  }

  // pebbles along both banks, two-tone
  for (const [fill, dy, k] of [[th.rockDark, 0.6, 1], [th.rock, -0.4, 0.75]]) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (const p of PEBBLES) {
      if (p.y < y0 || p.y > y1) continue;
      blob(ctx, p.x, p.y + dy, p.r * 1.3 * k, p.r * k);
    }
    ctx.fill();
  }

  // still ripples: present whatever the motion setting
  ctx.strokeStyle = th.streamLight;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const r of RIPPLES) {
    if (r.y < y0 || r.y > y1) continue;
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x + r.len, r.y + 1);
  }
  ctx.stroke();

  // a fall where the stream steps down past every terrace wall, foam at its foot
  const t = motion ? tMs || 0 : 0;
  const run = (t / 700) % 1;
  for (const f of FALLS) {
    if (f.y + f.h + 6 < y0 || f.y > y1) continue;
    ctx.fillStyle = th.streamLight;
    ctx.beginPath();
    roundBox(ctx, f.x, f.y, f.w, f.h, 3);
    ctx.fill();
    ctx.strokeStyle = th.foam;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const sx = f.x + 2.5 + k * (f.w - 5) / 3;
      const a = f.y + 2 + ((k * 0.37 + run) % 1) * (f.h - 10);
      ctx.moveTo(sx, a);
      ctx.lineTo(sx, a + 7);
    }
    ctx.stroke();
    ctx.fillStyle = th.foam;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) blob(ctx, f.x + 2 + k * (f.w - 4) / 3, f.y + f.h + 1, 3.6, 2.2);
    ctx.fill();
  }

  if (!motion) return;
  const u = ((tMs % FARM_ART.shimmerMs) / FARM_ART.shimmerMs);
  ctx.strokeStyle = th.shimmer;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < MAX_TERRACES; i++) {
    const g = groundYOf(i);
    for (const off of [0, 0.5]) {
      const y = g + LAYOUT.wallH + 8 + ((u + off) % 1) * (LAYOUT.bandH - LAYOUT.wallH - 18);
      if (y < y0 || y > y1) continue;
      const x = streamXAt(y), w = streamWAt(y);
      ctx.moveTo(x + w * 0.3, y);
      ctx.lineTo(x + w * 0.62, y + 2);
    }
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/**
 * One terrace: its dry-stone retaining wall and the shelf of earth on top.
 *
 * The wall is three staggered courses of dressed stone in two tones, lit from
 * above and shaded underneath, with moss on a few of the capstones; the shelf
 * is a strip of turned earth with grass hanging over its front edge. Plots are
 * NOT drawn here — the host lays soil per tile on top of this.
 *
 * An unbought terrace is the same shelf gone to seed — tall grass, wildflowers,
 * a bush or two, a wall gone darker — so the player can see exactly what they
 * are buying and where it will be. The 出售 sign is painted separately.
 *
 * `opts.sprinkler` lays a pipe with sprinkler heads along the back of the
 * shelf; `opts.irrigated` a little channel of water there.
 */
export function paintTerrace(ctx, th, i, owned, opts) {
  const sh = SHELVES[i] || SHELVES[0];
  const { soilH } = LAYOUT;

  // the wall: mortar in the shape of the shelf, then stones laid along the
  // contour inside it — clipped, so the courses end where the wall ends
  ctx.fillStyle = th.mortar;
  ctx.beginPath();
  shelfBody(ctx, sh, 0);
  ctx.fill();
  ctx.save();
  ctx.clip();
  for (const alt of [false, true]) {
    ctx.fillStyle = alt ? th.stoneAlt : th.stone;
    ctx.beginPath();
    for (const s of sh.stones) if (s.alt === alt) skewStone(ctx, s.x, s.w, s.yl, s.yr, s.h, 2.4);
    ctx.fill();
  }
  ctx.fillStyle = th.stoneShade;                // the underside of every stone
  ctx.beginPath();
  for (const s of sh.stones) skewStone(ctx, s.x + 0.5, s.w - 1, s.yl + s.h * 0.58, s.yr + s.h * 0.58, s.h * 0.42, 1.8);
  ctx.fill();
  ctx.strokeStyle = th.stoneLight;              // …and the top edge catching the sky
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (const s of sh.stones) {
    const k = (s.yr - s.yl) / s.w;
    ctx.moveTo(s.x + 2, s.yl + 1.4 + 2 * k);
    ctx.lineTo(s.x + s.w - 2, s.yr + 1.4 - 2 * k);
  }
  ctx.stroke();
  ctx.fillStyle = th.moss;
  ctx.beginPath();
  for (const s of sh.stones) if (s.moss) blob(ctx, s.x + s.w * 0.5, (s.yl + s.yr) / 2 + 1.2, s.w * 0.32, 1.9);
  ctx.fill();
  if (!owned) {
    ctx.fillStyle = th.wallUnowned;
    ctx.fillRect(sh.L - 10, sh.yL - 20, sh.R - sh.L + 30, 80);
  }
  ctx.restore();

  // the shelf: a band of earth (or of rough grass) riding the contour
  ctx.fillStyle = owned ? th.soil : th.overgrown;
  ctx.beginPath();
  alongContour(ctx, sh, -soilH);
  if (sh.offEdge) ctx.lineTo(sh.R, sh.yR);
  else ctx.quadraticCurveTo(sh.R + 4, sh.yR - soilH * 0.3, sh.R, sh.yR);
  for (let k = sh.top.length - 1; k >= 0; k--) ctx.lineTo(sh.top[k].x, sh.top[k].y);
  ctx.closePath();
  ctx.fill();
  if (owned) {
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = th.soilDark;              // the back of the shelf, in the bank's shade
    ctx.beginPath();
    alongContour(ctx, sh, -soilH + 1.25, -Infinity, sh.R - 4);
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = th.soilLight;             // …and its front edge in the light
    ctx.beginPath();
    alongContour(ctx, sh, -1.9, -Infinity, sh.R - 4);
    ctx.stroke();
  }

  // the grassy lip hanging over the top of the wall
  for (const [fill, dy] of [[th.grassDark, 1.2], [th.grass, 0]]) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    const lip = sh.lip;
    ctx.moveTo(lip[0].x, lip[0].y - 1.5 + dy);
    for (let k = 0; k < lip.length - 1; k++) {
      const a = lip[k], b = lip[k + 1];
      ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + a.d + dy, b.x, b.y - 0.5 + dy);
    }
    for (let k = lip.length - 1; k >= 0; k--) ctx.lineTo(lip[k].x, lip[k].y - 2.5 + dy);
    ctx.closePath();
    ctx.fill();
  }

  if (!owned) paintOvergrowth(ctx, th, sh);

  if (owned && opts && opts.irrigated) {
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = th.streamDark;
    ctx.beginPath();
    alongContour(ctx, sh, -soilH + 1.6, -Infinity, sh.R - 5);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = th.stream;
    ctx.beginPath();
    alongContour(ctx, sh, -soilH + 1.4, -Infinity, sh.R - 5);
    ctx.stroke();
  }
  if (owned && opts && opts.sprinkler) {
    const end = tileGeom(i, LAYOUT.cols - 1);
    const pipeEnd = end.x + end.w + 2;
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = th.pipe;
    ctx.beginPath();
    alongContour(ctx, sh, -soilH - 0.2, -Infinity, pipeEnd);
    ctx.stroke();
    ctx.fillStyle = th.pipe;
    ctx.beginPath();
    for (let col = 0; col < LAYOUT.cols; col++) {
      const t = tileGeom(i, col);
      const hx = t.x + t.w + LAYOUT.tileGap / 2;  // between tiles, out of the plants' way
      const py = groundYAt(i, hx) - soilH - 1.5;
      ctx.rect(hx - 0.7, py - 7, 1.4, 7);
      roundBox(ctx, hx - 2.4, py - 9.5, 4.8, 3, 1.2);
    }
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = th.pipeLight;
    ctx.beginPath();
    alongContour(ctx, sh, -soilH - 0.7, -Infinity, pipeEnd);
    ctx.stroke();
  }

  // the left end butts against the stream's bank stones; the right end, if it
  // is on screen, is a rounded tump of grass running into the hillside
  for (const [fill, dy, k] of [[th.rockDark, 0.8, 1], [th.rock, -0.5, 0.78]]) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (const [x, y, r] of sh.rocks) blob(ctx, x, y + dy, r * 1.25 * k, r * k);
    ctx.fill();
  }
  if (!sh.offEdge) {
    for (const [fill, dx, dy, k] of [[th.grassDark, 0, 0, 1], [th.grass, -1.5, -1.5, 0.7]]) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      disc(ctx, sh.R - 1 + dx, sh.yR - 2 + dy, 7 * k);
      disc(ctx, sh.R + 5 + dx, sh.yR + 5 + dy, 6 * k);
      disc(ctx, sh.R + 1 + dx, sh.yR + 13 + dy, 5.5 * k);
      ctx.fill();
    }
  }

  // the altitude band, tinted over the whole shelf: warm valley, cool ridge
  const tint = th.tint[altitudeOf(i)];
  if (tint) {
    ctx.fillStyle = tint;
    ctx.beginPath();
    shelfBody(ctx, sh, soilH);
    ctx.fill();
  }
}

function paintOvergrowth(ctx, th, sh) {
  for (const [fill, dx, dy, k] of [[th.shrub, 0, 0, 1], [th.shrubLight, -2, -3, 0.62]]) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (const b of sh.bushes) {
      disc(ctx, b.x + dx, b.y - b.r * 0.45 + dy, b.r * k);
      disc(ctx, b.x + b.r * 0.85 + dx, b.y - b.r * 0.2 + dy, b.r * 0.65 * k);
      disc(ctx, b.x - b.r * 0.8 + dx, b.y - b.r * 0.15 + dy, b.r * 0.55 * k);
    }
    ctx.fill();
  }
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  for (const tall of [false, true]) {
    ctx.strokeStyle = tall ? th.weedsTall : th.weeds;
    ctx.beginPath();
    for (const b of sh.blades) {
      if (b.tall !== tall) continue;
      ctx.moveTo(b.x, b.y + 3);
      ctx.quadraticCurveTo(b.x + b.lean * 0.3, b.y - b.h * 0.6, b.x + b.lean, b.y - b.h);
    }
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  for (let c = 0; c < 3; c++) {
    ctx.fillStyle = th.flowers[c];
    ctx.beginPath();
    for (const f of sh.flowers) if (f.c === c) disc(ctx, f.x, f.y, f.r);
    ctx.fill();
  }
}

/**
 * The bottom of the world, below terrace 0's wall: a dirt road along the foot
 * of the mountain, a plank bridge where the stream crosses it, and a small
 * Taiwanese farmhouse — white walls, red-tiled roof with the ridge swept up at
 * both ends, red couplets either side of the door — with a crate or two of
 * fruit by the step. With motion, a wisp rises from the chimney.
 */
export function paintFoot(ctx, th, tMs, motion) {
  const t = motion ? tMs || 0 : 0;

  // the verge under the bottom wall: its shade, following its foot
  paintWallShadow(ctx, wallShade(ctx, th), SHELVES[0]);

  // the road, gently curved, two-tone with wheel ruts
  const ry = ROAD_Y;
  ctx.fillStyle = th.roadEdge;
  ctx.beginPath();
  ctx.moveTo(SPAN_L, ry + 1);
  ctx.quadraticCurveTo(W / 2, ry - 5, SPAN_R, ry + 3);
  ctx.lineTo(SPAN_R, ry + ROAD_H + 4);
  ctx.quadraticCurveTo(W / 2, ry + ROAD_H - 2, SPAN_L, ry + ROAD_H + 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = th.road;
  ctx.beginPath();
  ctx.moveTo(SPAN_L, ry + 2);
  ctx.quadraticCurveTo(W / 2, ry - 4, SPAN_R, ry + 4);
  ctx.lineTo(SPAN_R, ry + ROAD_H + 1);
  ctx.quadraticCurveTo(W / 2, ry + ROAD_H - 5, SPAN_L, ry + ROAD_H);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = th.roadDark;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (const dy of [8, 17]) {
    ctx.moveTo(SPAN_L, ry + dy + 1);
    ctx.quadraticCurveTo(W / 2, ry + dy - 4, SPAN_R, ry + dy + 2);
  }
  ctx.stroke();

  // a plank bridge over the stream
  const sx = streamXAt(ry + 10), sw = streamWAt(ry + 10);
  ctx.fillStyle = th.crateDark;
  ctx.fillRect(sx - 6, ry + 1, sw + 12, ROAD_H - 2);
  ctx.fillStyle = th.crate;
  ctx.beginPath();
  for (let k = 0; k < 4; k++) ctx.rect(sx - 5, ry + 2 + k * 6, sw + 10, 4.6);
  ctx.fill();

  paintHouse(ctx, th, t, motion);

  // stepping stones from the road up to the bottom shelf
  for (const [fill, dy, k] of [[th.rockDark, 0.8, 1], [th.rock, -0.3, 0.82]]) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (const [px, py, r] of STEPS) blob(ctx, px, py + dy, r * 1.5 * k, r * 0.75 * k);
    ctx.fill();
  }

  // grass and flowers along the near verge of the road
  ctx.strokeStyle = th.grassDark;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let x = 44; x < W; x += 9 + (x * 7) % 6) {
    const y = ry + ROAD_H + 6;
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x - 2, y - 2);
    ctx.moveTo(x + 2, y + 4);
    ctx.lineTo(x + 4, y - 1);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  for (let c = 0; c < 3; c++) {
    ctx.fillStyle = th.flowers[c];
    ctx.beginPath();
    for (let x = 60 + c * 23; x < W; x += 71) disc(ctx, x, ry + ROAD_H + 7 + (c % 2) * 3, 1.6);
    ctx.fill();
  }
}

const HOUSE = { x: 204, w: 106, wallTop: ROAD_Y - 32, eave: 12 };
const STEP_TOP = groundYAt(0, 122) + LAYOUT.wallH;
const STEPS = [[124, STEP_TOP + 8, 6], [118, STEP_TOP + 20, 6.5], [126, STEP_TOP + 32, 7], [119, ROAD_Y - 6, 7.5]];

function paintHouse(ctx, th, t, motion) {
  const { x, w, wallTop, eave } = HOUSE;
  const base = ROAD_Y + 1;
  const roofTop = wallTop - 22;

  // chimney, behind the roof
  ctx.fillStyle = th.houseShade;
  ctx.fillRect(x + w - 26, roofTop - 6, 8, 16);
  ctx.fillStyle = th.roofDark;
  ctx.fillRect(x + w - 27.5, roofTop - 8, 11, 3);

  // walls, with the shaded gable end
  ctx.fillStyle = th.house;
  ctx.fillRect(x, wallTop, w, base - wallTop);
  ctx.fillStyle = th.houseShade;
  ctx.fillRect(x + w - 16, wallTop, 16, base - wallTop);
  ctx.fillRect(x, base - 4, w, 4);              // a plinth of darker render

  // door, couplets, windows
  const dx = x + 45;
  ctx.fillStyle = th.door;
  ctx.beginPath();
  roundBox(ctx, dx, wallTop + 9, 15, base - wallTop - 9, 2);
  ctx.fill();
  ctx.fillStyle = th.couplet;
  ctx.beginPath();
  ctx.rect(dx - 5, wallTop + 9, 3, 18);
  ctx.rect(dx + 17, wallTop + 9, 3, 18);
  ctx.rect(dx - 1, wallTop + 4, 17, 3.2);
  ctx.fill();
  ctx.fillStyle = th.window;
  ctx.beginPath();
  for (const wx of [x + 12, x + 72]) roundBox(ctx, wx, wallTop + 10, 15, 11, 1.5);
  ctx.fill();
  ctx.strokeStyle = th.door;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const wx of [x + 12, x + 72]) {
    ctx.moveTo(wx + 7.5, wallTop + 10); ctx.lineTo(wx + 7.5, wallTop + 21);
    ctx.moveTo(wx, wallTop + 15.5); ctx.lineTo(wx + 15, wallTop + 15.5);
  }
  ctx.stroke();

  // the roof: a band of red tile with the ridge swept up at both ends
  const l = x - eave, r = x + w + eave;
  ctx.fillStyle = th.roofDark;
  ctx.beginPath();
  ctx.moveTo(l - 2, wallTop + 3);
  ctx.lineTo(r + 2, wallTop + 3);
  ctx.lineTo(r - 6, roofTop + 2);
  ctx.lineTo(l + 6, roofTop + 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = th.roof;
  ctx.beginPath();
  ctx.moveTo(l, wallTop);
  ctx.lineTo(r, wallTop);
  ctx.lineTo(r - 7, roofTop + 1);
  ctx.lineTo(l + 7, roofTop + 1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = th.roofDark;                 // tile courses
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 1; k < 4; k++) {
    const y = roofTop + 1 + k * (wallTop - roofTop - 1) / 4;
    const inset = 7 * (1 - k / 4);
    ctx.moveTo(l + inset, y); ctx.lineTo(r - inset, y);
  }
  ctx.stroke();
  ctx.fillStyle = th.roofLight;                  // the ridge, swallowtail ends
  ctx.beginPath();
  ctx.moveTo(l + 2, roofTop - 6);
  ctx.quadraticCurveTo(l + 10, roofTop + 1, l + 22, roofTop);
  ctx.lineTo(r - 22, roofTop);
  ctx.quadraticCurveTo(r - 10, roofTop + 1, r - 2, roofTop - 6);
  ctx.quadraticCurveTo(r - 10, roofTop + 4.5, r - 22, roofTop + 3.5);
  ctx.lineTo(l + 22, roofTop + 3.5);
  ctx.quadraticCurveTo(l + 10, roofTop + 4.5, l + 2, roofTop - 6);
  ctx.closePath();
  ctx.fill();

  // crates of fruit by the door
  const ox = x + w + 4;
  for (const [cx, cy] of [[ox, base - 9], [ox + 12, base - 9], [ox + 6, base - 18]]) {
    ctx.fillStyle = th.crate;
    ctx.fillRect(cx, cy, 11, 9);
    ctx.fillStyle = th.crateDark;
    ctx.fillRect(cx, cy + 4, 11, 1);
    ctx.fillRect(cx, cy + 8, 11, 1);
  }
  for (const [fill, pts] of [[th.fruit, [[ox + 3, base - 19], [ox + 9, base - 19.5], [ox + 15, base - 10]]],
    [th.fruitAlt, [[ox + 12.5, base - 19], [ox + 20, base - 10.5], [ox + 3.5, base - 10]]]]) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (const [fx, fy] of pts) disc(ctx, fx, fy, 2.4);
    ctx.fill();
  }

  if (!motion) return;
  ctx.save();
  ctx.fillStyle = th.smoke;
  for (let k = 0; k < 3; k++) {
    const u = ((t / 3200) + k / 3) % 1;
    ctx.globalAlpha = Math.sin(u * Math.PI) * 0.6;
    ctx.beginPath();
    disc(ctx, x + w - 22 + Math.sin(u * 5 + k) * 2 + u * 10, roofTop - 9 - u * 18, 1.8 + u * 3);
    ctx.fill();
  }
  ctx.restore();
}

// 出售 — for sale. The only writing on the mountainside, and the whole of the
// "buy a terrace" interaction: tap the sign, and the number on it is what it
// costs. `price` comes in from the host because this module does not know what
// anything is worth (js/economy.js does) — pass null and it is a bare 出售.
// `note` is an optional line under the price ('Rank 4 needed'), smaller and
// quieter, for a shelf the player can see but cannot buy yet.
//
// The sway is DECORATION and is therefore not in the hit box: the sign is drawn
// leaning by a couple of degrees about its posts and reports the upright box it
// leans around, which is the box the host tapped against. Returning
// `forSaleBox(i)` rather than a second copy of the arithmetic is what makes
// "what you tap is what you see" a fact rather than a promise.
export function paintForSale(ctx, th, i, price, tMs, motion, note) {
  const box = forSaleBox(i);
  const { signW, signH } = LAYOUT;
  const cx = box.x + signW / 2;
  const footY = groundYAt(i, cx) - LAYOUT.soilH / 2;   // where the posts meet the earth

  ctx.save();
  ctx.translate(cx, footY);
  if (motion) ctx.rotate(Math.sin((tMs || 0) / FARM_ART.signSwayMs * Math.PI * 2) * FARM_ART.signSway);
  ctx.translate(-cx, -footY);

  // Dusk pools a lantern's worth of warm light behind the board, so the one
  // thing on the mountain worth reading is the one thing the evening cannot
  // swallow. The morning theme has no glow and skips this entirely.
  if (th.signGlow) glow(ctx, th, 'sign', th.signGlow, cx, box.y + signH / 2, Math.round(signW * 0.9));

  // two posts, then the board: plank face, a shaded bottom, a lit top
  ctx.fillStyle = th.signEdge;
  ctx.beginPath();
  for (const px of [box.x + 14, box.x + signW - 18]) ctx.rect(px, box.y + 8, 4, footY - box.y - 8);
  ctx.fill();
  ctx.fillStyle = th.signEdge;
  ctx.beginPath();
  roundBox(ctx, box.x, box.y, signW, signH, 5);
  ctx.fill();
  ctx.fillStyle = th.sign;
  ctx.beginPath();
  roundBox(ctx, box.x + 2, box.y + 2, signW - 4, signH - 4, 4);
  ctx.fill();
  ctx.fillStyle = th.signDark;
  ctx.beginPath();
  ctx.rect(box.x + 2, box.y + signH * 0.5, signW - 4, 1);
  roundBox(ctx, box.x + 2, box.y + signH - 7, signW - 4, 5, 3);
  ctx.fill();

  ctx.fillStyle = th.signInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Two lines when there is a price to paint, one big one when there is not;
  // a third, small and quiet, when there is a note.
  if (price == null) {
    ctx.font = `700 ${Math.round(signH * 0.5)}px "Hiragino Sans", system-ui, sans-serif`;
    ctx.fillText('出售', cx, box.y + signH * 0.5);
  } else if (!note) {
    ctx.font = `700 ${Math.round(signH * 0.34)}px "Hiragino Sans", system-ui, sans-serif`;
    ctx.fillText('出售', cx, box.y + signH * 0.3);
    ctx.font = `700 ${Math.round(signH * 0.28)}px system-ui, sans-serif`;
    ctx.fillText(`${price}元`, cx, box.y + signH * 0.7);
  } else {
    ctx.font = `700 ${Math.round(signH * 0.28)}px "Hiragino Sans", system-ui, sans-serif`;
    ctx.fillText('出售', cx, box.y + signH * 0.24);
    ctx.font = `700 ${Math.round(signH * 0.25)}px system-ui, sans-serif`;
    ctx.fillText(`${price}元`, cx, box.y + signH * 0.53);
  }
  if (note) {
    ctx.fillStyle = th.noteInk;
    ctx.font = `600 ${Math.round(signH * 0.17)}px system-ui, sans-serif`;
    ctx.fillText(String(note), cx, box.y + signH * 0.8);
  }
  ctx.restore();
  return box;
}

// What every shelf further up costs, carved small on the shelf itself.
//
// Set dressing, deliberately: no hit box, no glint, low contrast, off to one
// side so it can never sit under the one sign that IS tappable. What it buys is
// a glance — the prices climbing the hill are the whole campaign arc in one
// look, and without them the mountain above the next terrace is scenery.
export function paintTerracePrice(ctx, th, i, price) {
  if (price == null) return null;
  const box = terracePriceBox(i);
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = th.signEdge;
  ctx.fillRect(box.x + box.w / 2 - 1, box.y + box.h, 2, groundYAt(i, box.x + box.w / 2) - box.y - box.h);
  ctx.fillStyle = th.sign;
  ctx.beginPath();
  roundBox(ctx, box.x, box.y, box.w, box.h, 3);
  ctx.fill();
  ctx.globalAlpha = 0.78;
  ctx.fillStyle = th.signInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(box.h * 0.56)}px system-ui, sans-serif`;
  ctx.fillText(`${price}元`, box.x + box.w / 2, box.y + box.h / 2);
  ctx.restore();
  return box;
}

/**
 * A small wooden post at the left end of the lowest terrace of each altitude
 * band, beside the stream, with the band's name lettered down it — 谷地,
 * 山腰, 高山 — so the player notices that the mountain has climates. Scenery:
 * quiet, small, no hit box.
 */
export function altitudeMarkerBox(i) {
  const x = (SHELVES[i] || SHELVES[0]).L - 6;
  return { x, y: groundYAt(i, x + 5.5) - LAYOUT.soilH - 34, w: 11, h: 26 };
}

export function paintAltitudeMarkers(ctx, th) {
  ctx.save();
  ctx.globalAlpha = 0.88;
  for (const i of FARM_ART.bandStarts) {
    const b = altitudeMarkerBox(i);
    const name = FARM_ART.bandNames[altitudeOf(i)];
    ctx.fillStyle = th.signEdge;
    ctx.fillRect(b.x + b.w / 2 - 1, b.y + b.h, 2, groundYAt(i, b.x + b.w / 2) - b.y - b.h);
    ctx.beginPath();
    roundBox(ctx, b.x, b.y, b.w, b.h, 2);
    ctx.fill();
    ctx.fillStyle = th.sign;
    ctx.beginPath();
    roundBox(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, 1.5);
    ctx.fill();
    ctx.fillStyle = th.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 8px "Hiragino Sans", system-ui, sans-serif`;
    for (const [k, ch] of [...name].entries()) ctx.fillText(ch, b.x + b.w / 2, b.y + 7.5 + k * 10.5);
  }
  ctx.restore();
}

// Where the fog lies: across the foot of the first wall of each band above the
// valley, so it sits in the gap between one band's plants and the next.
export function fogBands() {
  return FOG_AT.map((i) => groundYOf(i) + LAYOUT.wallH + 4);
}
const FOG_AT = FARM_ART.bandStarts.slice(1);

const FOG_PUFFS = [[-0.05, -6, 90, 18], [0.3, 6, 80, 14], [0.58, -4, 100, 20], [0.95, 4, 90, 16]];

/**
 * Soft fog where the valley gives way to the hillside and the hillside to the
 * ridge. It drifts sideways at a pace you notice only if you look for it, and
 * holds still under reduced motion — atmosphere, never a thing to track.
 */
export function paintFog(ctx, th, tMs, motion, view) {
  const drift = motion ? Math.sin(((tMs || 0) / FARM_ART.fogDriftMs) * Math.PI * 2) * FARM_ART.fogDrift : 0;
  const band = cached(ctx, `farm-fog:${th.id}`, () => {
    const g = ctx.createLinearGradient(0, -40, 0, 40);
    g.addColorStop(0, th.fog[0]);
    g.addColorStop(0.5, th.fog[1]);
    g.addColorStop(1, th.fog[0]);
    return g;
  });
  const puff = cached(ctx, `farm-puff:${th.id}`, () => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, th.fog[1]);
    g.addColorStop(1, th.fog[0]);
    return g;
  });
  for (const [k, y] of fogBands().entries()) {
    if (!inView(view, y - 40, y + 40)) continue;
    ctx.save();
    ctx.translate(0, y);
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = band;
    ctx.fillRect(SPAN_L, -40, SPAN_R - SPAN_L, 80);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = puff;
    for (const [at, dy, rx, ry] of FOG_PUFFS) {
      ctx.save();
      // each puff lies along the wall it hangs under, not on a ruled line
      const px = at * W;
      ctx.translate(px + drift * (k % 2 ? -1 : 1), dy + groundYAt(FOG_AT[k], px) - groundYOf(FOG_AT[k]));
      ctx.scale(rx, ry);
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}

// Dark theme only: the evening has something living in it.
//
// Pure decoration — no information rides on a firefly — so unlike the glint,
// these are simply GONE under reduced motion rather than held still. A still
// firefly is a dot on the hillside, which is worse than no firefly at all.
// `view` (optional) skips the ones off screen.
export function paintFireflies(ctx, th, tMs, motion, view) {
  if (!th.firefly || !motion) return;
  ctx.save();
  ctx.fillStyle = th.firefly;
  for (const f of FIREFLIES) {
    if (!inView(view, f.y - f.ry - 4, f.y + f.ry + 4)) continue;
    const u = (tMs / f.ms) * Math.PI * 2 + f.phase;
    // a lazy figure-of-eight: the vertical runs at half the horizontal rate
    const x = f.x + Math.sin(u) * f.rx;
    const y = f.y + Math.sin(u * 0.5) * f.ry;
    const lit = 0.5 + 0.5 * Math.sin((tMs / f.blinkMs) * Math.PI * 2 + f.phase * 2.3);
    ctx.globalAlpha = 0.12 + 0.62 * lit * lit;
    ctx.beginPath();
    ctx.arc(x, y, f.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Dark theme only: a lantern under the farmhouse eave and one on a post by the
// bridge — the same idiom as the stall's, so evening is evening in both halves
// of the game.
//
// The pools are deliberately much wider than the lanterns are: what they are
// for is not "here is a lamp" but "the bottom of the mountain is a warm place
// to be standing", and a 30-unit halo lit nothing but itself.
export function lanternSpots() {
  return [
    { x: HOUSE.x + 36, y: HOUSE.wallTop + 9, post: false },
    { x: streamRightAt(ROAD_Y) + 12, y: ROAD_Y - 22, post: true },
  ];
}

export function paintLanterns(ctx, th, tMs, motion) {
  if (!th.lantern) return;
  const pool = FARM_ART.lanternPool;
  for (const [i, s] of lanternSpots().entries()) {
    if (s.post) {
      ctx.fillStyle = th.signEdge;
      ctx.fillRect(s.x - 1, s.y - 12, 2, ROAD_Y + 2 - (s.y - 12));
      ctx.fillRect(s.x - 1, s.y - 12, 7, 1.6);
    }
    const sway = motion ? Math.sin(tMs / 1500 + i * 2.1) * 0.5 : 0;
    const x = s.x + (s.post ? 5 : 0) + sway;
    glow(ctx, th, 'lantern', th.lanternGlow, x, s.y, pool);
    ctx.save();
    ctx.translate(x, s.y);
    ctx.fillStyle = th.lantern;
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = th.signEdge;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-3.2, -6.4); ctx.lineTo(3.2, -6.4);
    ctx.moveTo(-3.2, 6.4); ctx.lineTo(3.2, 6.4);
    ctx.moveTo(0, -6.4); ctx.lineTo(0, -10.5);
    ctx.stroke();
    ctx.restore();
  }
}

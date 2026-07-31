// The mountainside: everything behind and around the plants.
//
// Sibling of js/scene.js and the same contract — a 2D context in, nothing
// global touched, everything static precomputed at module load, at most a
// couple of gently animated elements and all of them off under reduced motion.
// Tests under node against a stub.
//
// The picture is central Taiwan seen from the road below: stone-walled terraces
// stacked up a slope, a stream down one side, a band of morning fog across the
// middle, and far ridges behind. Light theme is a clear morning; dark is
// evening, lit by the same two paper lanterns the stall hangs — the market and
// the farm are one place at two hours of the day.
//
// This file also owns the LAYOUT. Where terrace 3's second plot sits is a
// drawing fact, and the farm host asks for it here rather than computing it —
// so what the player taps and what the player sees can never drift apart.

import { WORLD, MAX_TERRACES } from './constants.js';

export const FARM_SCENE = {
  bands: MAX_TERRACES,
  bandH: 86,            // vertical spacing between one terrace and the next
  baseY: 536,           // ground line of the bottom (starter) terrace
  // Each terrace is this much narrower per side going up — honest perspective,
  // and capped by the thumb: five insets of 13 leave the top terrace's four
  // plots just under 50 world units wide, which on a phone (360 units across
  // ~390 CSS px) clears the 44px touch target. Pinned by tests/farm-scene.
  inset: 13,
  wallH: 17,            // the stone retaining wall under each strip
  soilH: 9,             // the lip of turned earth along the strip
  plotGap: 5,
  plotMargin: 8,
  plantH: 46,           // height budget a plant is drawn into, above its plot
  fogY: 286, fogH: 52, fogDriftMs: 26000,
  streamW: 20, shimmerMs: 2600,
  signW: 46, signH: 30,
};

export const FARM_THEMES = {
  light: {
    sky: ['#bcd9e8', '#fdf1d6'],          // clear morning, warm at the horizon
    ridgeFar: 'rgba(120, 140, 160, 0.30)',
    ridgeNear: 'rgba(96, 120, 108, 0.42)',
    hill: '#8fae6a', hillDark: '#6f8f52',
    soil: '#7a5c3c', soilDark: '#5b4329',
    stone: '#b9ac96', stoneDark: '#8d8170', stoneEdge: '#6d6354',
    weeds: '#7d9c56',
    fog: 'rgba(255, 253, 246, 0.55)',
    stream: '#9ec9dd', streamDark: '#6ea3bd', shimmer: 'rgba(255,255,255,0.55)',
    sign: '#d9b98a', signEdge: '#8a6742', signInk: '#8a2436',
    text: '#5a4632',
    lantern: null,                        // morning: the lanterns are unlit
  },
  dark: {
    sky: ['#2a2447', '#4a3550'],          // dusk over the ridge
    ridgeFar: 'rgba(180, 190, 220, 0.16)',
    ridgeNear: 'rgba(30, 40, 46, 0.55)',
    hill: '#3f5238', hillDark: '#2c3b28',
    soil: '#4a3826', soilDark: '#31241a',
    stone: '#5c5548', stoneDark: '#413c33', stoneEdge: '#2a2721',
    weeds: '#415433',
    fog: 'rgba(190, 200, 225, 0.20)',
    stream: '#3d5c72', streamDark: '#2a4152', shimmer: 'rgba(200,225,255,0.35)',
    sign: '#6f5738', signEdge: '#3a2c1c', signInk: '#ef6478',
    text: '#e8dcc8',
    lantern: '#ffb45a',                   // evening: two lanterns over the path
  },
};

export function farmThemeOf(settings) {
  return FARM_THEMES[settings && settings.theme === 'dark' ? 'dark' : 'light'];
}

// ── layout ─────────────────────────────────────────────────────────────────
//
// Terrace 0 is the bottom one — the starter farm, nearest the road and the
// widest. Each one above is inset per side, which is both honest perspective
// and the reason the mountain has a top: six bands fit the 360×560 world with
// sky to spare, so the farm never needs to scroll.

export function terraceGeom(i) {
  const left = FARM_SCENE.inset * i;
  return {
    groundY: FARM_SCENE.baseY - i * FARM_SCENE.bandH,
    left,
    right: WORLD.width - left,
    width: WORLD.width - 2 * left,
  };
}

// Where one plot sits, and how big the thing growing in it may be drawn.
// `n` is how many plots the terrace holds (js/constants.js TUNING).
export function plotGeom(ti, pi, n) {
  const t = terraceGeom(ti);
  const usable = t.width - 2 * FARM_SCENE.plotMargin - (n - 1) * FARM_SCENE.plotGap;
  const w = usable / n;
  return {
    cx: t.left + FARM_SCENE.plotMargin + pi * (w + FARM_SCENE.plotGap) + w / 2,
    groundY: t.groundY,
    w,
    h: FARM_SCENE.plantH * (1 - ti * 0.06),   // plants recede a little up the hill
  };
}

// Which plot, if any, a tap at world (x, y) landed on. Generous vertically —
// the whole band above the strip belongs to it, because that is where the plant
// the player is actually aiming at is drawn.
export function plotAtPoint(x, y, terraceCount, n) {
  for (let ti = 0; ti < terraceCount; ti++) {
    const t = terraceGeom(ti);
    if (y > t.groundY + FARM_SCENE.wallH || y < t.groundY - FARM_SCENE.bandH * 0.62) continue;
    for (let pi = 0; pi < n; pi++) {
      const g = plotGeom(ti, pi, n);
      if (Math.abs(x - g.cx) <= g.w / 2 + FARM_SCENE.plotGap / 2) return { ti, pi };
    }
  }
  return null;
}

// ── precomputed static geometry ────────────────────────────────────────────

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Two ridgelines behind the farm, built once. Per-frame noise would make the
// mountains crawl, which is the one thing mountains must never do.
function ridge(seed, y, amp, step) {
  const rnd = lcg(seed);
  const pts = [];
  for (let x = -20; x <= WORLD.width + 20; x += step) {
    pts.push({ x, y: y - rnd() * amp - Math.sin(x / 90) * amp * 0.5 });
  }
  return pts;
}

const RIDGE_FAR = ridge(7717, 250, 46, 26);
const RIDGE_NEAR = ridge(3391, 300, 34, 20);

// Stone courses per terrace wall, and weed tufts for the ones not bought yet.
const COURSES = Array.from({ length: FARM_SCENE.bands }, (_, i) => {
  const rnd = lcg(1300 + i * 97);
  return Array.from({ length: 22 }, () => ({ at: rnd(), row: Math.floor(rnd() * 3), w: 0.05 + rnd() * 0.07 }));
});

const WEEDS = Array.from({ length: FARM_SCENE.bands }, (_, i) => {
  const rnd = lcg(4400 + i * 31);
  return Array.from({ length: 16 }, () => ({ at: rnd(), h: 0.4 + rnd() * 0.6, lean: (rnd() - 0.5) * 0.8 }));
});

const gradients = new WeakMap();
function cached(ctx, key, make) {
  let byKey = gradients.get(ctx);
  if (!byKey) { byKey = new Map(); gradients.set(ctx, byKey); }
  let grad = byKey.get(key);
  if (grad === undefined) { grad = make(); byKey.set(key, grad); }
  return grad;
}

// ── the layers ─────────────────────────────────────────────────────────────

/** Sky. Drawn in DEVICE space so it fills the letterbox too. */
export function paintFarmSky(ctx, th, width, height) {
  ctx.fillStyle = cached(ctx, `farmsky:${th.sky[0]}:${height}`, () => {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(1, th.sky[1]);
    return g;
  });
  ctx.fillRect(0, 0, width, height);
}

function ridgePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.lineTo(WORLD.width + 20, WORLD.height + 40);
  ctx.lineTo(-20, WORLD.height + 40);
  ctx.closePath();
}

export function paintRidges(ctx, th) {
  ctx.fillStyle = th.ridgeFar;
  ridgePath(ctx, RIDGE_FAR);
  ctx.fill();
  ctx.fillStyle = th.ridgeNear;
  ridgePath(ctx, RIDGE_NEAR);
  ctx.fill();
}

// The slope the terraces are cut into: one body of green under everything, so
// the gaps between bands read as hillside rather than as sky.
export function paintHillside(ctx, th) {
  const top = terraceGeom(FARM_SCENE.bands - 1);
  ctx.fillStyle = th.hill;
  ctx.beginPath();
  ctx.moveTo(-20, WORLD.height + 40);
  ctx.lineTo(-20, FARM_SCENE.baseY + FARM_SCENE.wallH);
  ctx.lineTo(top.left - 24, top.groundY - 30);
  ctx.lineTo(top.right + 24, top.groundY - 30);
  ctx.lineTo(WORLD.width + 20, FARM_SCENE.baseY + FARM_SCENE.wallH);
  ctx.lineTo(WORLD.width + 20, WORLD.height + 40);
  ctx.closePath();
  ctx.fill();
}

/**
 * One terrace: its retaining wall and the strip of earth on top.
 *
 * An unbought terrace is the same shape gone to seed — weeds instead of soil,
 * a duller wall — so the player can see exactly what they are buying and where
 * it will be. The 出售 sign is painted separately, on top of everything.
 */
export function paintTerrace(ctx, th, i, owned) {
  const t = terraceGeom(i);
  const { wallH, soilH } = FARM_SCENE;

  // the wall, with a few courses of stone picked out
  ctx.fillStyle = owned ? th.stone : th.stoneDark;
  ctx.fillRect(t.left, t.groundY, t.width, wallH);
  ctx.strokeStyle = th.stoneEdge;
  ctx.lineWidth = 1;
  for (const c of COURSES[i] || []) {
    const x = t.left + c.at * t.width;
    const y = t.groundY + (c.row + 0.5) * (wallH / 3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(Math.min(t.right, x + c.w * t.width), y);
    ctx.stroke();
  }
  ctx.strokeRect(t.left, t.groundY, t.width, wallH);

  // the strip on top: turned earth if it is yours, overgrown if it is not
  if (owned) {
    ctx.fillStyle = th.soil;
    ctx.fillRect(t.left, t.groundY - soilH, t.width, soilH);
    ctx.fillStyle = th.soilDark;
    ctx.fillRect(t.left, t.groundY - soilH, t.width, Math.max(1, soilH * 0.3));
  } else {
    ctx.fillStyle = th.hillDark;
    ctx.fillRect(t.left, t.groundY - soilH, t.width, soilH);
    ctx.strokeStyle = th.weeds;
    ctx.lineWidth = 1.4;
    for (const wd of WEEDS[i] || []) {
      const x = t.left + wd.at * t.width;
      const y = t.groundY - soilH;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + wd.lean * 6, y - wd.h * 9, x + wd.lean * 12, y - wd.h * 15);
      ctx.stroke();
    }
  }
}

// 出售 — for sale. The only writing on the mountainside, and the whole of the
// "buy a terrace" interaction: tap the sign. Returns its hit box so the host
// does not have to re-derive one.
export function paintForSale(ctx, th, i) {
  const t = terraceGeom(i);
  const { signW, signH } = FARM_SCENE;
  const x = t.left + t.width / 2 - signW / 2;
  const y = t.groundY - signH - FARM_SCENE.soilH - 4;

  ctx.strokeStyle = th.signEdge;                 // the post
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x + signW / 2, y + signH);
  ctx.lineTo(x + signW / 2, y + signH + 10);
  ctx.stroke();

  ctx.fillStyle = th.sign;
  ctx.fillRect(x, y, signW, signH);
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, signW, signH);

  ctx.fillStyle = th.signInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(signH * 0.52)}px "Hiragino Sans", system-ui, sans-serif`;
  ctx.fillText('出售', x + signW / 2, y + signH * 0.5);
  return { x, y, w: signW, h: signH };
}

export function forSaleBox(i) {
  const t = terraceGeom(i);
  const { signW, signH } = FARM_SCENE;
  return {
    x: t.left + t.width / 2 - signW / 2,
    y: t.groundY - signH - FARM_SCENE.soilH - 4,
    w: signW,
    h: signH,
  };
}

// The stream down the left of the mountain — the irrigation fantasy made
// visible long before it is affordable. Its only motion is a shimmer that
// slides down it; under reduced motion the water is simply still.
export function paintStream(ctx, th, tMs, motion) {
  const w = FARM_SCENE.streamW;
  const top = terraceGeom(FARM_SCENE.bands - 1).groundY - 20;
  const x = (t) => 6 + Math.sin(t * 5.5) * 10 + t * 8;

  ctx.fillStyle = th.stream;
  ctx.beginPath();
  ctx.moveTo(x(0), top);
  for (let u = 0; u <= 1.0001; u += 0.05) ctx.lineTo(x(u), top + u * (WORLD.height - top));
  for (let u = 1; u >= -0.0001; u -= 0.05) ctx.lineTo(x(u) + w, top + u * (WORLD.height - top));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = th.streamDark;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (!motion) return;
  const u = ((tMs % FARM_SCENE.shimmerMs) / FARM_SCENE.shimmerMs);
  ctx.strokeStyle = th.shimmer;
  ctx.lineWidth = 2;
  for (const off of [0, 0.42, 0.75]) {
    const t = (u + off) % 1;
    const y = top + t * (WORLD.height - top);
    ctx.beginPath();
    ctx.moveTo(x(t) + w * 0.25, y);
    ctx.lineTo(x(t) + w * 0.8, y + 3);
    ctx.stroke();
  }
}

// A band of morning fog across the middle of the slope. It drifts sideways at a
// pace you notice only if you look for it, and holds still under reduced
// motion — it is atmosphere, never a thing to track.
export function paintFog(ctx, th, tMs, motion) {
  const drift = motion ? Math.sin((tMs / FARM_SCENE.fogDriftMs) * Math.PI * 2) * 14 : 0;
  ctx.fillStyle = th.fog;
  for (const [dy, h, sx] of [[0, 1, 0], [18, 0.7, 40], [-14, 0.55, -30]]) {
    ctx.beginPath();
    ctx.ellipse(WORLD.width / 2 + drift + sx, FARM_SCENE.fogY + dy,
      WORLD.width * 0.72, FARM_SCENE.fogH * 0.5 * h, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Dark theme only: two lanterns on the path up to the farm, the same idiom as
// the stall's — evening is evening in both halves of the game.
export function paintLanterns(ctx, th, tMs, motion) {
  if (!th.lantern) return;
  const t = terraceGeom(0);
  const y = t.groundY - 54;
  for (const [i, x] of [t.left + 22, t.right - 22].entries()) {
    const sway = motion ? Math.sin(tMs / 1500 + i * 2.1) * 0.5 : 0;
    ctx.save();
    ctx.translate(x + sway, y);
    ctx.fillStyle = cached(ctx, 'farm-lantern-glow', () => {
      const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 30);
      glow.addColorStop(0, 'rgba(255, 190, 110, 0.30)');
      glow.addColorStop(1, 'rgba(255, 190, 110, 0)');
      return glow;
    });
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = th.lantern;
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 9.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = th.signEdge;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-4.5, -8.6); ctx.lineTo(4.5, -8.6);
    ctx.moveTo(-4.5, 8.6); ctx.lineTo(4.5, 8.6);
    ctx.stroke();
    ctx.restore();
  }
}

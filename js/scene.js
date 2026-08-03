// The stall: everything behind and around the fruit.
//
// The sound pack already establishes the world — a wooden fruit stand at
// midday, an evening one in dark theme — and this is that world made visible:
// a striped awning over a plank stall against a market sky. Pure drawing, same
// contract as js/fruit-art.js (a 2D context in, nothing global touched), so it
// tests under node against a stub.
//
// Everything static is precomputed at module load: grain polylines, nail
// positions, rooftop profile. Per-frame noise would make the wood crawl.
//
// The only moving parts are a ≤0.5-unit lantern sway and one drifting leaf,
// both scheduled off the host clock with no stored state, and both off under
// reduced motion.

import { WORLD } from './constants.js';

export const SCENE = {
  wall: 10,             // plank thickness, world units
  awningBottom: 58,     // where the solid stripe band ends …
  scallops: 7,          // … and the scalloped fringe hangs below it
  leafCycleMs: 30000,   // one leaf per cycle, plus up to leafJitterMs of delay
  leafJitterMs: 10000,  // ⇒ gaps of 20–40 s, per the brief
  leafFallMs: 8000,     // crossing time
};

export const THEMES = {
  light: {
    sky: ['#fdf3dc', '#dfeaf0'],           // warm midday cream into a soft sky
    roof: 'rgba(146, 112, 74, 0.09)',
    awning: ['#d23c50', '#f7e3c0'],
    awningEdge: 'rgba(120, 30, 45, 0.45)',
    wood: '#c9a97a', woodDark: '#a9835a', woodEdge: '#8a6742',
    grain: 'rgba(120, 90, 60, 0.22)', nail: 'rgba(80, 60, 42, 0.45)',
    deadline: '#d23c50', text: '#5a4632',
    guide: 'rgba(90,70,50,0.25)', ghost: 'rgba(90,70,50,0.35)',
    leaf: 'rgba(120, 150, 80, 0.5)',
    lantern: null,                         // midday: the lanterns are unlit
  },
  dark: {
    sky: ['#2c2443', '#171326'],           // dusk indigo
    roof: 'rgba(255, 235, 200, 0.055)',
    awning: ['#8e2233', '#3b2b23'],
    awningEdge: 'rgba(0, 0, 0, 0.45)',
    wood: '#6b543a', woodDark: '#54402a', woodEdge: '#3c2d1d',
    grain: 'rgba(20, 12, 6, 0.35)', nail: 'rgba(240, 220, 190, 0.28)',
    deadline: '#ef6478', text: '#e8dcc8',
    guide: 'rgba(232,220,200,0.25)', ghost: 'rgba(232,220,200,0.35)',
    leaf: 'rgba(180, 200, 140, 0.28)',
    lantern: '#ffb45a',                    // evening: two paper lanterns lit
  },
};

export function themeOf(settings) {
  return THEMES[settings && settings.theme === 'dark' ? 'dark' : 'light'];
}

// Where a friend sits while they watch you work.
//
// The top of the left-hand plank is the one flat surface on this stall that is
// not the board: everything between the walls is where fruit land, and the
// counter is the bottom of the pile. Small — a little wider than the plank it
// sits on, so it reads as perched rather than as something that fell in — and
// tucked under the near corner of the awning, which is exactly where you would
// sit if you were minding a stall and not working it.
//
// It lives here because it is scene geometry: the plank's top is
// `WORLD.deadlineY - 20` in paintStall and the host has no business knowing
// that. Returns the fruit's CENTRE, so a painter can use it directly.
export function perchAt(r) {
  return { x: SCENE.wall * 0.9, y: WORLD.deadlineY - 20 - r };
}

// How big a perched friend is drawn, in world units. Sized off the plank
// rather than off the fruit's own radius, so every friend in the cast perches
// at the same scale whatever they are — and small enough that at this x the
// whole of them stays inside the view, which ends one plank past the wall.
// tests/scene pins that; a friend clipped in half by the bezel is the bug this
// number exists to not have.
export const PERCH_R = SCENE.wall * 1.8;

// ── precomputed static geometry ────────────────────────────────────────────

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Grain runs along the plank. Each entry is a fraction across the plank and a
// pair of wobble offsets — enough to read as wood, cheap enough to stroke.
const GRAIN = (() => {
  const rnd = lcg(1907);
  return Array.from({ length: 14 }, () => ({
    at: rnd(),                       // 0..1 across the plank's short axis
    from: rnd() * 0.35,              // 0..1 along its length
    to: 0.55 + rnd() * 0.45,
    bow: (rnd() - 0.5) * 0.06,
  }));
})();

// A far market skyline: alternating roof ridges, drawn once at very low
// contrast so it sits behind the fruit without competing for attention.
const ROOFLINE = (() => {
  const rnd = lcg(4211);
  const pts = [];
  let x = -30;
  while (x < WORLD.width + 30) {
    const w = 50 + rnd() * 70;
    const h = 26 + rnd() * 34;
    pts.push({ x, w, h });
    x += w + 8 + rnd() * 18;
  }
  return pts;
})();

const ROOF_Y = 268;      // horizon: low enough to be behind the pile, not the sky

function hash32(n) {
  let x = (n | 0) >>> 0;
  x = (x ^ 61) ^ (x >>> 16);
  x = (x + (x << 3)) >>> 0;
  x = x ^ (x >>> 4);
  x = Math.imul(x, 0x27d4eb2d) >>> 0;
  return (x ^ (x >>> 15)) >>> 0;
}

// ── the layers ─────────────────────────────────────────────────────────────

// Gradients are cached per context and key — the sky is rebuilt only when the
// canvas resizes or the theme flips, and the lantern glow (drawn at a
// translated origin, so its coordinates never move) is built exactly twice.
const gradients = new WeakMap();

function cached(ctx, key, make) {
  let byKey = gradients.get(ctx);
  if (!byKey) { byKey = new Map(); gradients.set(ctx, byKey); }
  let grad = byKey.get(key);
  if (grad === undefined) { grad = make(); byKey.set(key, grad); }
  return grad;
}

/** Sky gradient. Drawn in DEVICE space so it fills the letterbox too. */
export function paintSky(ctx, th, width, height) {
  ctx.fillStyle = cached(ctx, `sky:${th.sky[0]}:${height}`, () => {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(1, th.sky[1]);
    return g;
  });
  ctx.fillRect(0, 0, width, height);
}

export function paintSkyline(ctx, th) {
  ctx.fillStyle = th.roof;
  for (const p of ROOFLINE) {
    // the walls run all the way down behind the counter: a shorter block would
    // put a hard horizontal seam across the middle of the board
    ctx.beginPath();
    ctx.moveTo(p.x, ROOF_Y);
    ctx.lineTo(p.x + p.w / 2, ROOF_Y - p.h);
    ctx.lineTo(p.x + p.w, ROOF_Y);
    ctx.lineTo(p.x + p.w, WORLD.floorY);
    ctx.lineTo(p.x, WORLD.floorY);
    ctx.closePath();
    ctx.fill();
  }
}

// One plank: base fill, a couple of divisions, grain, and nail heads at the
// joints. `horizontal` picks which axis the grain (and the divisions) follow.
function plank(ctx, th, x, y, w, h, horizontal, divisions) {
  ctx.fillStyle = th.wood;
  ctx.fillRect(x, y, w, h);

  const len = horizontal ? w : h;
  const across = horizontal ? h : w;

  ctx.strokeStyle = th.grain;
  ctx.lineWidth = Math.max(0.5, across * 0.035);
  for (const gr of GRAIN) {
    const a = y + (horizontal ? gr.at * h : gr.from * h);
    const b = x + (horizontal ? gr.from * w : gr.at * w);
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(x + gr.from * w, a);
      ctx.quadraticCurveTo(x + (gr.from + gr.to) * 0.5 * w, a + gr.bow * h * 4, x + gr.to * w, a);
    } else {
      ctx.moveTo(b, y + gr.from * h);
      ctx.quadraticCurveTo(b + gr.bow * w * 4, y + (gr.from + gr.to) * 0.5 * h, b, y + gr.to * h);
    }
    ctx.stroke();
  }

  // plank divisions + the nails that hold them
  ctx.strokeStyle = th.woodEdge;
  ctx.lineWidth = Math.max(0.6, across * 0.05);
  for (let i = 1; i < divisions; i++) {
    const t = i / divisions;
    ctx.beginPath();
    if (horizontal) { ctx.moveTo(x + t * w, y); ctx.lineTo(x + t * w, y + h); }
    else { ctx.moveTo(x, y + t * h); ctx.lineTo(x + w, y + t * h); }
    ctx.stroke();

    ctx.fillStyle = th.nail;
    for (const s of [0.28, 0.72]) {
      const nx = horizontal ? x + t * w : x + s * w;
      const ny = horizontal ? y + s * h : y + t * h;
      ctx.beginPath();
      ctx.arc(nx, ny, Math.max(0.7, across * 0.09), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.strokeStyle = th.woodEdge;
  ctx.lineWidth = Math.max(0.8, across * 0.06);
  ctx.strokeRect(x, y, w, h);
  return len;
}

export function paintStall(ctx, th) {
  const w = SCENE.wall;
  const top = WORLD.deadlineY - 20;
  const inner = WORLD.floorY - top;
  const counter = WORLD.floorY + w + 5;

  // Under the counter: the world ends at floorY but the canvas does not — on a
  // tall viewport the letterbox below would otherwise show open sky beneath a
  // solid wooden bench. Deliberately generous; it is only ever seen as a strip.
  ctx.fillStyle = th.woodEdge;
  ctx.fillRect(-200, counter, WORLD.width + 400, 400);

  plank(ctx, th, -w, top, w, inner + w, false, 3);                    // left wall
  plank(ctx, th, WORLD.width, top, w, inner + w, false, 3);           // right wall
  plank(ctx, th, -w, WORLD.floorY, WORLD.width + 2 * w, w + 5, true, 3); // counter
}

// The awning: solid stripe band with a scalloped fringe. Its fringe hangs just
// above the deadline, so "the pile reached the line" and "the stall is full to
// the canopy" are the same picture. Drawn behind everything in the play area —
// the held fruit hangs in front of it.
export function paintAwning(ctx, th) {
  const w = SCENE.wall;
  const left = -w, span = WORLD.width + 2 * w;
  const n = SCENE.scallops;
  const sw = span / n;                 // stripe width == scallop diameter
  const bottom = SCENE.awningBottom;
  const rad = sw / 2;

  for (let i = 0; i < n; i++) {
    ctx.fillStyle = th.awning[i % 2];
    const x = left + i * sw;
    ctx.fillRect(x, -20, sw, bottom + 20);
    ctx.beginPath();                    // the scallop, bulging down
    ctx.arc(x + rad, bottom, rad, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
  }

  // a shadow line under the valance gives the canvas some thickness
  ctx.strokeStyle = th.awningEdge;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = left + i * sw;
    ctx.moveTo(x, bottom);
    ctx.arc(x + rad, bottom, rad, Math.PI, 0, true);
  }
  ctx.stroke();
}

// Dark theme only: two paper lanterns strung under the awning, near the walls
// so they stay out of the busy middle of the board.
export function paintLanterns(ctx, th, tMs, motion) {
  if (!th.lantern) return;
  const cy = SCENE.awningBottom + 34;
  for (const [i, x] of [26, WORLD.width - 26].entries()) {
    const sway = motion ? Math.sin(tMs / 1400 + i * 2.1) * 0.5 : 0;
    const cx = x + sway;

    ctx.strokeStyle = th.awningEdge;    // cord
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, SCENE.awningBottom);
    ctx.lineTo(cx, cy - 11);
    ctx.stroke();

    // Painted around a translated origin so the glow gradient's coordinates
    // are constant and it can be cached through the sway.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = cached(ctx, 'lantern-glow', () => {
      const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 34);
      glow.addColorStop(0, 'rgba(255, 190, 110, 0.34)');
      glow.addColorStop(1, 'rgba(255, 190, 110, 0)');
      return glow;
    });
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = th.lantern;         // the paper body
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = th.awningEdge;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-5, -10); ctx.lineTo(5, -10);
    ctx.moveTo(-5, 10); ctx.lineTo(5, 10);
    ctx.stroke();
    ctx.restore();
  }
}

// One leaf, now and then. Behind the fruit, low contrast, gone under reduced
// motion — an ambient touch, not a thing to track.
export function paintLeaf(ctx, th, tMs, motion) {
  if (!motion) return;
  const n = Math.floor(tMs / SCENE.leafCycleMs);
  const t0 = n * SCENE.leafCycleMs + (hash32(n) % SCENE.leafJitterMs);
  const u = (tMs - t0) / SCENE.leafFallMs;
  if (u < 0 || u > 1) return;

  const x = -18 + u * (WORLD.width + 40) * 0.85 + Math.sin(u * 6.6) * 20;
  const y = 30 + u * (WORLD.floorY - 60);
  const fade = Math.min(1, Math.min(u, 1 - u) * 8);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(u * 9.4) * 0.9);
  ctx.globalAlpha = fade;
  ctx.fillStyle = th.leaf;
  ctx.beginPath();
  ctx.moveTo(-7, 0);
  ctx.quadraticCurveTo(0, -5, 7, 0);
  ctx.quadraticCurveTo(0, 5, -7, 0);
  ctx.fill();
  ctx.restore();
}

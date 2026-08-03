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

// Where a friend sits while they watch you work: on the stall's front apron,
// BELOW the counter, down at the bottom-left like somebody on a stool at the
// end of the stand.
//
// Below the counter is the one place on this stall that is never the board.
// The first perch was the top of the left plank — level with the deadline,
// which put the friend square in the drop path: aim left and the held fruit,
// the ghost line and the falling fruit all passed through their face. Nothing
// the physics ever touches goes below WORLD.floorY, so down here the friend
// can never conflict with play, only keep it company.
//
// The apron is a shelf with three things on it, and this is the left end of
// them: the friend here, the crate in the middle and Pack up at the far right
// (the other two are DOM — see .counter in style.css). The button is the reason
// that order and not its mirror: a button is opaque, and a friend sitting
// behind one is a friend nobody ever sees.
//
// The apron is painted as far down as the canvas goes (paintStall's apron), and
// the renderer keeps the counter's band clear of the world — so the seat is
// visible wherever the game is actually played, and in a very short landscape
// window the friend is simply below the crop instead of in the way. Returns the
// fruit's CENTRE.
export function perchAt(r) {
  return { x: SCENE.wall + r * 1.1, y: WORLD.floorY + SCENE.wall + 5 + r };
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

  paintApron(ctx, th, counter);
  plank(ctx, th, -w, top, w, inner + w, false, 3);                    // left wall
  plank(ctx, th, WORLD.width, top, w, inner + w, false, 3);           // right wall
  plank(ctx, th, -w, WORLD.floorY, WORLD.width + 2 * w, w + 5, true, 3); // counter
}

// Under the counter: the world ends at floorY but the canvas does not, and a
// portrait viewport leaves more slack below the world than above it (see
// js/render.js §TOP_SHARE) — so this is not a strip any more, it is the front
// of the stall, and it is where the friend minding the board sits.
//
// It used to be one flat rectangle of the darkest wood, which at a phone's
// letterbox read as the bottom of the screen having fallen off. Boarded like
// every other timber on the stall instead: vertical front planks, a nail at
// each joint, and the counter's own shadow across the top of them.
//
// Deliberately generous downward — the canvas ends long before this does.
const APRON_BOARDS = 6;
const APRON_DROP = 400;

function paintApron(ctx, th, y) {
  const w = SCENE.wall;
  const left = -w - 200, span = WORLD.width + 2 * w + 400;
  ctx.fillStyle = th.woodDark;
  ctx.fillRect(left, y, span, APRON_DROP);

  // the front boards, on the world's own pitch and phased off the stall's left
  // wall, so the joints line up with the timber above them rather than with
  // whatever letterbox happens to be showing either side of it
  const pitch = (WORLD.width + 2 * w) / APRON_BOARDS;
  ctx.strokeStyle = th.woodEdge;
  ctx.lineWidth = 1.2;
  for (let x = -w - Math.ceil(200 / pitch) * pitch; x < left + span; x += pitch) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + APRON_DROP);
    ctx.stroke();
    ctx.fillStyle = th.nail;
    ctx.beginPath();
    ctx.arc(x + pitch / 2, y + 9, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // the counter's shadow on the boards, so the lip above reads as a lip
  ctx.fillStyle = cached(ctx, 'apron-shadow', () => {
    const g = ctx.createLinearGradient(0, y, 0, y + 26);
    g.addColorStop(0, 'rgba(0, 0, 0, 0.3)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    return g;
  });
  ctx.fillRect(left, y, span, 26);
}

// The awning: solid stripe band with a scalloped fringe. Its fringe hangs just
// above the deadline, so "the pile reached the line" and "the stall is full to
// the canopy" are the same picture. Drawn behind everything in the play area —
// the held fruit hangs in front of it.
//
// `topY` is the world y of the top edge of the CANVAS, which on any viewport
// taller than the world's own aspect is well above the world's own top. The
// canopy runs all the way up to it: the alternative is what this used to be —
// a band of stripes floating on a sliver of sky, with the DOM header above the
// sliver, which read as a seam across the top of the screen rather than as a
// stall you are standing at. Defaulted, so the callers that only want the
// designed band (and the tests) need say nothing.
export function paintAwning(ctx, th, topY = -20) {
  const w = SCENE.wall;
  const left = -w, span = WORLD.width + 2 * w;
  const n = SCENE.scallops;
  const sw = span / n;                 // stripe width == scallop diameter
  const bottom = SCENE.awningBottom;
  const rad = sw / 2;
  const top = Math.min(topY, -20);     // never SHORTER than the designed band

  for (let i = 0; i < n; i++) {
    ctx.fillStyle = th.awning[i % 2];
    const x = left + i * sw;
    ctx.fillRect(x, top, sw, bottom - top);
    ctx.beginPath();                    // the scallop, bulging down
    ctx.arc(x + rad, bottom, rad, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
  }

  // Cloth, not paint: the canopy is deepest in its own shade where it meets the
  // roof and catches the light at the valance. Without this the extended band
  // is a flat slab of two colours across the top fifth of a phone.
  const fold = Math.round(top);
  ctx.fillStyle = cached(ctx, `awning-fold:${fold}`, () => {
    const g = ctx.createLinearGradient(0, fold, 0, bottom);
    g.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
    g.addColorStop(0.55, 'rgba(0, 0, 0, 0.04)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0.10)');
    return g;
  });
  ctx.fillRect(left, top, span, bottom - top);

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

  // …and the shade the canopy throws into the stall, so the fringe hangs in
  // front of the board rather than being printed on it.
  ctx.fillStyle = cached(ctx, 'awning-cast', () => {
    const g = ctx.createLinearGradient(0, bottom, 0, bottom + rad + 46);
    g.addColorStop(0, 'rgba(0, 0, 0, 0.14)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    return g;
  });
  ctx.fillRect(left, bottom, span, rad + 46);
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

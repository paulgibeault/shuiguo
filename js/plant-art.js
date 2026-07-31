// What a fruit looks like on the way to being a fruit.
//
// Same contract as js/fruit-art.js and js/scene.js: a 2D context in, nothing
// global touched, no state, no clock of its own — so it tests under node
// against a stub. Everything is drawn in local space anchored at the origin,
// which the caller has already translated to the plot's ground point; the plant
// grows UP from there (negative y), inside a height budget the caller sets.
//
// THE ONE-PAINTER RULE. Fruit hanging on a plant is js/fruit-art.js's
// paintFruit at small scale — never a coloured disc, never a second drawing of
// a strawberry. The strawberry on the bush is recognisably the strawberry that
// will bounce in the stall, which is the whole reason the farm and the market
// feel like one game.
//
// Ripe is a GLINT. It is the universal "tap me" in this game and it is the only
// thing on the farm screen that moves on its own, so it is also the only thing
// here that takes the clock — and it goes still under reduced motion.

import { MAX_LEVEL, farmOf, radiusOf } from './constants.js';
import { paintFruit } from './fruit-art.js';

// The whole palette the plant painter gets, beyond each fruit's own five
// colours. Greens are deliberately duller than any FRUITS.leaf so that fruit
// reads as the bright thing on a plant, and so a bed of strawberries doesn't
// vibrate. Pinned by tests/plant-art: no hex literal lives outside this table.
export const FARM_PALETTE = {
  stem: '#5c7a3a',
  stemDark: '#445c2a',
  leaf: '#6f9450',
  leafDark: '#4e7038',
  sprout: '#8fb45f',
  trunk: '#8a6742',
  trunkDark: '#654a2e',
  bark: '#6b5137',
  wood: '#a9835a',        // trellis timber — the stall's own plank colour
  woodDark: '#7d6041',
  mound: '#7a5c3c',
  moundDark: '#5b4329',
  moundWet: '#4a3423',
  glint: '#fff3c4',
};

export const PLANT = {
  glintMs: 1800,          // one slow twinkle cycle on anything ready to pick
  glintR: 0.16,           // as a fraction of the plant's height budget
  seedUntil: 0.18,        // progress below this is still bare turned earth …
  sproutUntil: 0.45,      // … then a sprout, then the grown plant
  saplingUntil: 0.55,     // perennials: a whip, then a young tree
};

// The one growth stage a plot is showing, out of what js/farm.js knows about
// it. Kept here rather than in farm.js because it is a drawing decision — how
// many pictures a plant has — and farm.js has no opinion about pictures.
//
//   'empty'    bare, plantable ground
//   'seed'     just planted: turned earth, maybe a fleck of green
//   'sprout'   up but small
//   'grown'    full-size plant carrying nothing yet
//   'ripe'     full-size plant carrying fruit — the one with the glint
//   'sapling'  perennials only: a whip not yet worth its trellis
//   'young'    perennials only: a tree with a canopy but no first crop yet
export function stageOf(desc) {
  if (!desc || !desc.kind) return 'empty';
  if (desc.ripe) return 'ripe';
  const p = clamp01(desc.progress);
  const perennial = desc.kind !== 'bed';
  if (perennial && !desc.mature) {
    if (p < PLANT.seedUntil) return 'seed';
    return p < PLANT.saplingUntil ? 'sapling' : 'young';
  }
  if (p < PLANT.seedUntil) return perennial ? 'grown' : 'seed';
  if (p < PLANT.sproutUntil) return perennial ? 'grown' : 'sprout';
  return 'grown';
}

export const STAGES = ['empty', 'seed', 'sprout', 'grown', 'ripe', 'sapling', 'young'];

// ── the plot floor ─────────────────────────────────────────────────────────

// The turned earth every plant stands in. Watered soil is darker — the only
// feedback watering leaves behind once the pour animation is over, and the
// reason a dry farm reads as dry at a glance.
export function paintSoil(ctx, w, h, opts) {
  const wet = !!(opts && opts.wet);
  const r = Math.min(h * 0.3, w * 0.12);
  ctx.fillStyle = wet ? FARM_PALETTE.moundWet : FARM_PALETTE.mound;
  roundRect(ctx, -w / 2, -h, w, h);
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.moundDark;
  roundRect(ctx, -w / 2, -h, w, Math.max(1, h * 0.28));
  ctx.fill();
  // three furrows, so bare earth still reads as tended rather than as a hole
  ctx.strokeStyle = FARM_PALETTE.moundDark;
  ctx.lineWidth = Math.max(0.6, h * 0.06);
  for (const t of [0.3, 0.55, 0.8]) {
    ctx.beginPath();
    ctx.moveTo(-w / 2 + r, -h + h * t);
    ctx.lineTo(w / 2 - r, -h + h * t);
    ctx.stroke();
  }
}

// ── the plants ─────────────────────────────────────────────────────────────

/**
 * Paint one plant, anchored at the origin and growing up into `h` units.
 *
 * desc: { kind, level, progress, mature, ripe, trellis }
 * opts: { tMs, motion, wet }
 */
export function paintPlant(ctx, desc, h, opts) {
  const stage = stageOf(desc);
  if (stage === 'empty') return stage;
  const level = clampLevel(desc.level);
  const o = opts || {};

  ctx.save();
  if (desc.kind === 'vine') paintVine(ctx, level, stage, h);
  else if (desc.kind === 'tree') paintTree(ctx, level, stage, h);
  else paintBedPlant(ctx, level, stage, h);
  ctx.restore();

  if (stage === 'ripe') paintGlint(ctx, h, o.tMs || 0, o.motion);
  return stage;
}

// Annuals: a mound, a sprout, then a low bush with its fruit sitting in it.
function paintBedPlant(ctx, level, stage, h) {
  if (stage === 'seed') {
    sprig(ctx, 0, h * 0.16, h * 0.1, FARM_PALETTE.sprout);
    return;
  }
  const grown = stage !== 'sprout';
  const top = grown ? h * 0.62 : h * 0.3;

  stalk(ctx, 0, top, Math.max(1, h * 0.05), FARM_PALETTE.stem);
  const spread = grown ? h * 0.42 : h * 0.2;
  for (const [dx, dy, s] of [[-1, 0.55, 1], [1, 0.62, 0.95], [-0.62, 0.85, 0.8], [0.7, 0.9, 0.85]]) {
    leaf(ctx, dx * spread, -top * dy, spread * 0.62 * s, dx < 0);
  }
  if (stage !== 'ripe') return;

  // the crop itself, sitting in the leaves: the real fruit, small
  const fr = h * 0.2;
  for (const [dx, dy] of [[-0.34, 0.42], [0.36, 0.5], [0, 0.72]]) {
    fruitAt(ctx, level, dx * h * 0.5, -top * dy, fr);
  }
}

// Perennials: a whip, a young tree, then a full crown that fruits forever.
function paintTree(ctx, level, stage, h) {
  const young = stage === 'sapling';
  const trunkH = young ? h * 0.34 : h * (stage === 'young' ? 0.44 : 0.5);
  const crownR = young ? h * 0.12 : h * (stage === 'young' ? 0.26 : 0.34);

  if (stage === 'seed') { sprig(ctx, 0, h * 0.14, h * 0.09, FARM_PALETTE.sprout); return; }

  ctx.fillStyle = FARM_PALETTE.trunk;
  ctx.beginPath();
  ctx.moveTo(-h * 0.045, 0);
  ctx.lineTo(-h * 0.028, -trunkH);
  ctx.lineTo(h * 0.028, -trunkH);
  ctx.lineTo(h * 0.045, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = FARM_PALETTE.trunkDark;
  ctx.lineWidth = Math.max(0.6, h * 0.014);
  ctx.stroke();

  if (!young) {                                  // two boughs out of the trunk
    ctx.strokeStyle = FARM_PALETTE.bark;
    ctx.lineWidth = Math.max(0.8, h * 0.026);
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, -trunkH * 0.72);
      ctx.quadraticCurveTo(dir * crownR * 0.5, -trunkH * 0.92, dir * crownR * 0.72, -trunkH * 1.02);
      ctx.stroke();
    }
  }

  // the crown: three overlapping blobs so it reads as foliage, not a lollipop
  const cy = -trunkH - crownR * 0.55;
  for (const [dx, dy, s, dark] of [[-0.62, 0.12, 0.78, 1], [0.62, 0.16, 0.74, 1], [0, -0.18, 1, 0]]) {
    ctx.fillStyle = dark ? FARM_PALETTE.leafDark : FARM_PALETTE.leaf;
    ctx.beginPath();
    ctx.ellipse(dx * crownR, cy + dy * crownR, crownR * s, crownR * s * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (stage !== 'ripe') return;

  const fr = Math.min(h * 0.17, crownR * 0.62);
  for (const [dx, dy] of [[-0.62, 0.42], [0.6, 0.34], [-0.1, 0.66], [0.28, -0.3]]) {
    fruitAt(ctx, level, dx * crownR, cy + dy * crownR, fr);
  }
}

// Vines climb the trellis the plot already carries — see paintTrellis, which
// the caller draws first so the tendrils sit in front of the timber.
function paintVine(ctx, level, stage, h) {
  if (stage === 'seed') { sprig(ctx, 0, h * 0.14, h * 0.09, FARM_PALETTE.sprout); return; }
  const reach = stage === 'sapling' ? h * 0.34 : h * (stage === 'young' ? 0.6 : 0.78);

  ctx.strokeStyle = FARM_PALETTE.stemDark;
  ctx.lineWidth = Math.max(1, h * 0.035);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(h * 0.1, -reach * 0.5, 0, -reach);
  ctx.stroke();

  for (const t of [0.35, 0.62, 0.88]) {
    if (reach * t < h * 0.1) continue;
    leaf(ctx, (t > 0.5 ? 1 : -1) * h * 0.16, -reach * t, h * 0.17, t <= 0.5);
  }
  if (stage !== 'ripe') return;

  const fr = h * 0.16;
  for (const [dx, dy] of [[-0.2, 0.5], [0.22, 0.68], [0, 0.86]]) {
    fruitAt(ctx, level, dx * h, -reach * dy, fr);
  }
}

// The trellis itself is plot furniture, not a plant: it is built once and stays
// standing through every harvest, so it paints whether or not a vine is on it.
export function paintTrellis(ctx, w, h) {
  const posts = 2;
  ctx.strokeStyle = FARM_PALETTE.wood;
  ctx.lineWidth = Math.max(1, h * 0.03);
  for (let i = 0; i < posts; i++) {
    const x = (i === 0 ? -1 : 1) * w * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, -h * 0.85);
    ctx.stroke();
  }
  ctx.strokeStyle = FARM_PALETTE.woodDark;
  ctx.lineWidth = Math.max(0.7, h * 0.022);
  for (const t of [0.3, 0.55, 0.8]) {
    ctx.beginPath();
    ctx.moveTo(-w * 0.32, -h * t);
    ctx.lineTo(w * 0.32, -h * t);
    ctx.stroke();
  }
}

// ── the glint ──────────────────────────────────────────────────────────────
// A four-point sparkle over anything ready to pick. Under reduced motion it
// holds at full brightness rather than disappearing: it is information — "this
// one is ready" — and the farm has no other way to say so.
export function paintGlint(ctx, h, tMs, motion) {
  const phase = motion ? 0.45 + 0.55 * Math.abs(Math.sin((tMs || 0) / PLANT.glintMs * Math.PI)) : 1;
  const r = h * PLANT.glintR * (0.75 + 0.25 * phase);
  ctx.save();
  ctx.globalAlpha = 0.55 + 0.45 * phase;
  ctx.fillStyle = FARM_PALETTE.glint;
  ctx.translate(h * 0.3, -h * 0.92);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const b = a + Math.PI / 4;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.lineTo(Math.cos(b) * r * 0.26, Math.sin(b) * r * 0.26);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── small parts ────────────────────────────────────────────────────────────

// The real fruit, at plant scale. paintFruit draws at its own world radius, so
// this scales the whole context down to the size the plant can carry.
function fruitAt(ctx, level, x, y, r) {
  const worldR = radiusOf(level);
  ctx.save();
  ctx.translate(x, y);
  const k = r / worldR;
  ctx.scale(k, k);
  paintFruit(ctx, level, worldR);
  ctx.restore();
}

function stalk(ctx, x, h, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, -h);
  ctx.stroke();
}

function leaf(ctx, x, y, r, flip) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip ? -1 : 1, 1);
  ctx.fillStyle = FARM_PALETTE.leaf;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(r * 0.7, -r * 0.7, r * 1.4, 0);
  ctx.quadraticCurveTo(r * 0.7, r * 0.45, 0, 0);
  ctx.fill();
  ctx.strokeStyle = FARM_PALETTE.leafDark;
  ctx.lineWidth = Math.max(0.4, r * 0.08);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(r * 1.25, -r * 0.05);
  ctx.stroke();
  ctx.restore();
}

// Two seed-leaves on a thread — what "something is happening down there" looks
// like before there is a plant to speak of.
function sprig(ctx, x, h, r, color) {
  ctx.strokeStyle = FARM_PALETTE.stem;
  ctx.lineWidth = Math.max(0.6, r * 0.3);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, -h);
  ctx.stroke();
  ctx.fillStyle = color;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x + dir * r * 0.7, -h, r * 0.8, r * 0.45, dir * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r == null ? Math.min(w, h) * 0.18 : r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function clamp01(v) { return typeof v === 'number' && v > 0 ? (v > 1 ? 1 : v) : 0; }

function clampLevel(level) {
  return Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL ? level : 1;
}

// Handy for callers that want to describe a plot without importing farm.js —
// the shop's seed preview, for instance, which has no plot at all.
export function describeSeed(level) {
  const row = farmOf(clampLevel(level));
  return { kind: row.kind, level: clampLevel(level), progress: 1, mature: true, ripe: true };
}

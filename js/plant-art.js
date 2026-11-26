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
//
// THE LOOK. Soft storybook flat-vector: every mass is two-tone at least — a
// darker underside, a mid body, and a highlight on the upper left, where the
// light on the mountain comes from — and nothing wears an outline heavier than
// the fruit's own rind. Every layout (where a crown's leaf clumps sit, where
// the fruit nestles, which way a pineapple blade leans) is worked out ONCE at
// module load from a fixed seed, so a plant is the same picture every frame
// and painting sixty of them is a few dozen fills each rather than a few
// hundred. Overlapping shapes of one tone share one path and one fill.

import { MAX_LEVEL, FRUITS, farmOf, radiusOf } from './constants.js';
import { paintFruit, expressionFor } from './fruit-art.js';

// The whole palette the plant painter gets, beyond each fruit's own five
// colours. Greens are deliberately duller than any FRUITS.leaf so that fruit
// reads as the bright thing on a plant, and so a bed of strawberries doesn't
// vibrate. Pinned by tests/plant-art: no hex literal lives outside this table.
//
// Foliage comes in ramps of four — deep (the far side of the crown), shade (the
// underside of every clump), mid (the body), light (the sunlit top-left) — and
// each species family has its own ramp, which is most of what makes a citrus
// read as a citrus from across the mountain.
export const FARM_PALETTE = {
  stem: '#5c7a3a',
  stemDark: '#445c2a',
  leaf: '#6f9450',
  leafDark: '#4e7038',
  sprout: '#8fb45f',
  trunk: '#8a6742',
  trunkDark: '#654a2e',
  trunkLight: '#a8835a',
  bark: '#6b5137',
  wood: '#a9835a',        // trellis timber — the stall's own plank colour
  woodDark: '#7d6041',
  woodLight: '#c49d70',
  mound: '#7a5c3c',
  moundDark: '#5b4329',
  moundWet: '#4a3423',    // laid over soil that has had a can of water
  moundLip: '#9a7551',    // the raised rim that says "this is ground, not floor"
  shadow: '#2a2016',      // contact shadows, always at low alpha
  // ground, by how wet the spot is (js/terrain.js): sandy when dry, rich when wet
  soilDry: '#b38d63',
  soilDryDark: '#92704b',
  soilDryLip: '#d0ab7f',
  soilWet: '#5a3f28',
  soilWetDark: '#422d1b',
  soilWetLip: '#7a5939',
  sheen: '#e6f0f2',       // the light off a freshly watered bed
  // broadleaf ramp: cherry, apple, and the default
  leafDeep: '#3b5a2d',
  leafShade: '#4f7339',
  leafMid: '#6b9a4c',
  leafLight: '#93bd68',
  // citrus: dense, dark and glossy
  citrusDeep: '#1f3f28',
  citrusShade: '#2b5433',
  citrusMid: '#3b6e42',
  citrusLight: '#6aa264',
  // persimmon: warm, a little yellow
  persDeep: '#4a5a27',
  persShade: '#607631',
  persMid: '#7c9842',
  persLight: '#a8c264',
  // pear: cool, a touch of blue-grey
  pearDeep: '#36543a',
  pearShade: '#476a45',
  pearMid: '#5f8858',
  pearLight: '#8db27c',
  // peach: long light leaves
  peachShade: '#557a3a',
  peachMid: '#77a352',
  peachLight: '#a3c97a',
  // blossom
  blossom: '#fff7f2',
  blossomPink: '#f7c4d0',
  blossomDeep: '#e595aa',
  blossomCore: '#f0bd52',
  // the low crops
  bedDeep: '#3d6030',
  bedShade: '#4f7a3b',
  bedMid: '#699c4a',
  bedLight: '#92c268',
  flowerYellow: '#f5d04c',
  flowerYellowDark: '#d8a42a',
  pineDeep: '#3d5c46',
  pineShade: '#537a58',
  pineMid: '#6e9669',
  pineLight: '#a1c290',
  pineBronze: '#a07c4c',
  gourdDeep: '#38592b',
  gourdShade: '#4c7637',
  gourdMid: '#669a47',
  gourdLight: '#8fc066',
  tendril: '#86a85a',
  // things that are not plants
  water: '#5c9cb2',
  waterDeep: '#3c7288',
  waterLight: '#acd8e2',
  stone: '#a59c8b',
  stoneDark: '#7b7366',
  stoneLight: '#cbc3b1',
  reed: '#7f9a4a',
  reedDark: '#5b7335',
  cattail: '#7a4e2c',
  lily: '#f6c8d6',
  hive: '#e3b968',
  hiveDark: '#b98a3f',
  hiveLight: '#f4d892',
  hiveHole: '#3a2a18',
  bee: '#f2c230',
  beeStripe: '#3a2a18',
  beeWing: '#eef6fb',
  humus: '#47331f',
  humusLight: '#6a4d33',
  // the fit badge, from a poor spot to an ideal one
  fitPoor: '#c27a6d',
  fitMeh: '#b9a08a',
  fitOk: '#d9c89c',
  fitGood: '#bcd06e',
  fitIdeal: '#ffd45e',
  fitOff: '#6b5e4b',
  glint: '#fff3c4',
  // Time, made visible. The ring is deliberately quiet next to the glint: one
  // says "coming", the other says "now", and the farm has to keep those apart.
  progressTrack: '#3f3222',
  progressDone: '#ffd97a',
  chip: '#2f2619',
  chipInk: '#f4e6c8',
  hint: '#cbb894',        // the 种 over ground you could plant in
};

export const PLANT = {
  glintMs: 1800,          // one slow twinkle cycle on anything ready to pick
  glintR: 0.16,           // as a fraction of the plant's height budget
  seedUntil: 0.18,        // progress below this is still bare turned earth …
  sproutUntil: 0.45,      // … then a sprout, then the grown plant
  saplingUntil: 0.45,     // perennials: a whip, then a young tree …
  youngUntil: 0.75,       // … which blossoms before its very first crop
  bloomFrom: 0.75,        // annuals flower in the last quarter before fruit
  cycleBloomFrom: 0.55,   // a mature perennial flowers past here in each cycle
  // The whole ambient-motion budget of a plot, and it is small on purpose: a
  // mountainside where everything moves is a mountainside where nothing reads.
  swayMs: 5200,           // one lean-and-back, per-plot phase offset
  sway: 0.022,            // radians — a breeze in the leaves, not a storm
  bobMs: 1800,            // ripe only, on the glint's own clock
  bob: 0.02,              // as a fraction of the height budget
  ringR: 0.46,            // progress ring radius, as a fraction of the budget
  rippleMs: 2600,         // the pond's one ring, outward and gone
  beeMs: 3400,            // one lap of the hive
};

const TAU = Math.PI * 2;

// The one growth stage a plot is showing, out of what js/farm.js knows about
// it. Kept here rather than in farm.js because it is a drawing decision — how
// many pictures a plant has — and farm.js has no opinion about pictures.
//
//   'empty'    bare, plantable ground
//   'seed'     just planted: turned earth, maybe a fleck of green
//   'sprout'   up but small
//   'grown'    full-size plant carrying nothing yet
//   'bloom'    full-size plant in flower: fruit is on its way
//   'ripe'     full-size plant carrying fruit — the one with the glint
//   'sapling'  perennials only: a whip on a stake
//   'young'    perennials only: a tree with a canopy but no first crop yet
//
// Deterministic in the description alone. Ripe outranks everything — it is the
// state the player has to notice.
export function stageOf(desc) {
  if (!desc || !desc.kind) return 'empty';
  if (desc.ripe) return 'ripe';
  const p = clamp01(desc.progress);
  const perennial = desc.kind !== 'bed';
  if (perennial) {
    if (desc.mature) return p < PLANT.cycleBloomFrom ? 'grown' : 'bloom';
    if (p < PLANT.seedUntil) return 'seed';
    if (p < PLANT.saplingUntil) return 'sapling';
    return p < PLANT.youngUntil ? 'young' : 'bloom';
  }
  if (p < PLANT.seedUntil) return 'seed';
  if (p < PLANT.sproutUntil) return 'sprout';
  return p < PLANT.bloomFrom ? 'grown' : 'bloom';
}

export const STAGES = ['empty', 'seed', 'sprout', 'grown', 'bloom', 'ripe', 'sapling', 'young'];

// ── the plot floor ─────────────────────────────────────────────────────────

// The turned earth every plant stands in, occupying [-h, 0] above the ground
// point: a lit top surface, a darker front face, two furrows and a few clods.
//
// `moisture` is the lie of the land (js/terrain.js) — 'dry' ground is sandy and
// pale, 'wet' ground by the stream is dark and rich, 'damp' sits between. `wet`
// is something else: this bed has been WATERED. It darkens whatever soil it is
// and wears a sheen — the only feedback watering leaves once the pour is over.
//
// `bare` earth additionally gets a lit rim along its top edge. A flat rectangle
// of soil with a plant standing on it reads as ground; the same rectangle with
// nothing on it reads as a floorboard, and the rim is what tells the player the
// empty ones are the ones they can do something with.
export function paintSoil(ctx, w, h, opts) {
  const o = opts || {};
  const tone = SOIL[o.moisture] || SOIL.damp;
  const r = Math.min(h * 0.45, w * 0.12);
  ctx.save();
  ctx.fillStyle = tone.body;
  roundRect(ctx, -w / 2, -h, w, h, r);
  ctx.fill();
  // the front face, in shade
  ctx.fillStyle = tone.dark;
  roundRect(ctx, -w / 2, -h * 0.42, w, h * 0.42, Math.min(r, h * 0.2));
  ctx.fill();
  // two furrows and the clods turned up beside them
  ctx.strokeStyle = tone.dark;
  ctx.lineWidth = Math.max(0.6, h * 0.08);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const t of [0.3, 0.6]) {
    const y = -h + h * t * 0.85;
    ctx.moveTo(-w / 2 + r * 1.2, y);
    ctx.quadraticCurveTo(0, y + h * 0.06, w / 2 - r * 1.2, y);
  }
  ctx.stroke();
  ctx.fillStyle = tone.lip;
  ctx.beginPath();
  for (const [cx, cy, cr] of CLODS) addEllipse(ctx, cx * w, -h + cy * h, cr * h, cr * h * 0.7);
  ctx.fill();
  if (o.wet) {
    // watered: a shade darker all over, and the light catching standing water
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = FARM_PALETTE.moundWet;   // watered: laid over whatever soil it is
    roundRect(ctx, -w / 2, -h, w, h, r);
    ctx.fill();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = FARM_PALETTE.sheen;
    ctx.beginPath();
    addEllipse(ctx, -w * 0.2, -h * 0.72, w * 0.12, h * 0.07);
    addEllipse(ctx, w * 0.17, -h * 0.56, w * 0.08, h * 0.06);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (o.bare) {
    ctx.strokeStyle = tone.lip;
    ctx.lineWidth = Math.max(0.7, h * 0.14);
    ctx.beginPath();
    ctx.moveTo(-w / 2 + r, -h + ctx.lineWidth * 0.5);
    ctx.lineTo(w / 2 - r, -h + ctx.lineWidth * 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

const SOIL = {
  dry: { body: FARM_PALETTE.soilDry, dark: FARM_PALETTE.soilDryDark, lip: FARM_PALETTE.soilDryLip },
  damp: { body: FARM_PALETTE.mound, dark: FARM_PALETTE.moundDark, lip: FARM_PALETTE.moundLip },
  wet: { body: FARM_PALETTE.soilWet, dark: FARM_PALETTE.soilWetDark, lip: FARM_PALETTE.soilWetLip },
};
// clods: [x as a fraction of w, y as a fraction of h from the top, r of h]
const CLODS = [[-0.33, 0.22, 0.09], [-0.08, 0.5, 0.07], [0.12, 0.26, 0.08], [0.36, 0.5, 0.07], [-0.24, 0.55, 0.06]];

// 种 — plant. The one hint mark on the mountainside, and it appears only over
// ground the player can act on RIGHT NOW: bare earth with something in the
// drawer that would go in it. An affordance shown to somebody with nothing to
// plant is not a hint, it is a tease. The painter stays dumb — whether this
// plot qualifies is the host's arithmetic, and arrives as a boolean.
export function paintPlantHint(ctx, h, tMs, motion) {
  const breathe = motion ? 0.72 + 0.28 * Math.abs(Math.sin((tMs || 0) / PLANT.swayMs * Math.PI)) : 1;
  ctx.save();
  ctx.globalAlpha = 0.34 * breathe;
  ctx.fillStyle = FARM_PALETTE.hint;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(h * 0.34)}px "Hiragino Sans", system-ui, sans-serif`;
  ctx.fillText('种', 0, -h * 0.42);
  ctx.restore();
}

// ── time, made visible ─────────────────────────────────────────────────────

// A thin ring around the plant, swept clockwise from the top by however much of
// the current stage is done. Drawn BEHIND the plant so a full bush hides most of
// it — the ring is for glancing at, not for reading, and the number that can be
// read lives on the countdown chip instead.
export function paintProgressRing(ctx, h, progress) {
  const p = clamp01(progress);
  // Nothing banked yet, nothing to show. An empty ring around a fresh sprig
  // reads as a bubble rather than as a gauge at zero, and the plot it would
  // appear on is the one already wearing a thirst glint.
  if (p <= 0) return;
  const r = h * PLANT.ringR;
  const cy = -h * 0.5;
  const top = -Math.PI / 2;
  ctx.save();
  ctx.lineWidth = Math.max(1, h * 0.045);
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = FARM_PALETTE.progressTrack;
  ctx.beginPath();
  ctx.arc(0, cy, r, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = FARM_PALETTE.progressDone;
  ctx.beginPath();
  ctx.arc(0, cy, r, top, top + p * TAU);
  ctx.stroke();
  ctx.restore();
}

// The one countdown on the farm, over the one plot that is next. A second chip
// would make the mountainside a dashboard, which is the opposite of what the
// farm is for — the ring says "everything is on its way", this says "and the
// first one lands in 2:31".
export function paintCountdown(ctx, text, h) {
  const size = Math.round(h * 0.3);
  ctx.save();
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + size * 0.9;
  const boxH = size * 1.5;
  const y = -h * 1.16;
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = FARM_PALETTE.chip;
  roundRect(ctx, -w / 2, y - boxH / 2, w, boxH, boxH / 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = FARM_PALETTE.chipInk;
  ctx.fillText(text, 0, y);
  ctx.restore();
}

// ── the plants ─────────────────────────────────────────────────────────────

/**
 * Paint one plant, anchored at the origin and growing up into `h` units.
 *
 * desc: { kind, level, progress, mature, ripe, span, w }
 * opts: { tMs, motion, seed }
 *
 * `w` is the width budget. Absent, it is h·0.7 for a one-tile plant and h·0.95
 * for a two-tile one (`span`, itself defaulting to the level's FARM row). A
 * tree's crown may rise a little past `h` — the shelf above is further back.
 *
 * `seed` is any integer that identifies this plot. It picks which of a
 * species' few crown layouts this tree grows, and phases the sway and the
 * blinks, so a terrace does not lean in unison or wink at the player in one
 * block; it is passed in rather than derived here because WHICH plot this is
 * belongs to the caller, and the same plot must get the same seed every frame.
 *
 * Vines bring their own trellis: it is part of the plant's picture now, drawn
 * behind the vine at every stage.
 *
 * The sway and the ripe bob are the plot's whole motion budget, and both are
 * DECORATION: under reduced motion they simply stop. The glint is not — it is
 * the only way the farm says "this one is ready", so it is painted outside the
 * moving transform and holds still and bright either way.
 *
 * Returns the stage it drew.
 */
export function paintPlant(ctx, desc, h, opts) {
  const stage = stageOf(desc);
  if (stage === 'empty') return stage;
  const level = clampLevel(desc.level);
  const o = opts || {};
  const tMs = Number.isFinite(o.tMs) ? o.tMs : 0;
  const seed = Number.isInteger(o.seed) ? Math.abs(o.seed) : 0;
  const span = desc.span === 2 || desc.span === 1 ? desc.span : farmOf(level).span;
  const w = Number.isFinite(desc.w) && desc.w > 0 ? desc.w : h * (span === 2 ? 0.95 : 0.7);
  const p = { ctx, level, stage, w, h, tMs, motion: !!o.motion, seed };

  ctx.save();
  if (p.motion) {
    // lean about the plot's own ground point, and bob only when there is fruit
    // hanging there to anticipate picking
    ctx.rotate(Math.sin(tMs / PLANT.swayMs * TAU + seed * 1.7) * PLANT.sway);
    if (stage === 'ripe') ctx.translate(0, Math.sin(tMs / PLANT.bobMs * TAU + seed) * h * PLANT.bob);
  }
  let glint;
  const species = farmOf(level).kind === desc.kind ? level : 0;
  if (desc.kind === 'vine') glint = paintVine(p);
  else if (desc.kind === 'tree') glint = paintTree(p, TREE_FORMS[species] ? species : 6);
  else if (species === 9) glint = paintPineapple(p);
  else if (species === 10 || species === 11) glint = paintSprawl(p, species);
  else glint = paintRosette(p);
  ctx.restore();

  if (stage === 'ripe') {
    const k = Math.min(h, 70);
    glintAt(ctx, glint[0], glint[1], k * PLANT.glintR, tMs, p.motion);
  }
  return stage;
}

// Two seed-leaves on a thread over a little hump of turned earth — what
// "something is happening down there" looks like before there is a plant.
function paintSeedling(p) {
  const { ctx, w, h } = p;
  const s = Math.min(w, h * 0.8);
  ctx.fillStyle = FARM_PALETTE.moundDark;
  ctx.beginPath();
  addEllipse(ctx, 0, -s * 0.01, s * 0.16, s * 0.045);
  ctx.fill();
  sprig(ctx, 0, s * 0.16, s * 0.075);
  return [s * 0.2, -s * 0.3];
}

// ── trees ──────────────────────────────────────────────────────────────────
//
// A crown is a cloud of overlapping circles in three depth layers. Each layer
// is one fill of its shade tone (every circle, full size), one fill of its mid
// tone (every circle nudged up-left and shrunk) and one of its highlight — so
// the lower edge of every clump falls into shadow, the front clumps scallop
// over the back ones, and a whole crown is nine fills however leafy it looks.
//
// Shapes are in units of the width budget, centred on the crown's middle.

const TREE_FORMS = {
  // cherry: rounded, a little loose
  1: { rx: 0.42, ry: 0.3, cy: 0.64, rc: 0.12, shape: 'round', ramp: 'leaf', blossoms: 40, fruit: 7, fr: 0.062,
    boughs: [[-0.6, 0.15], [0.55, 0.05], [0.05, -0.35]] },
  // citrus: compact, dense, dark and glossy
  4: { rx: 0.34, ry: 0.3, cy: 0.58, rc: 0.09, shape: 'round', ramp: 'citrus', fruit: 5, fr: 0.07,
    boughs: [[-0.5, 0.2], [0.5, 0.25]] },
  // persimmon: wide and spreading, clumps with sky between them
  5: { rx: 0.5, ry: 0.22, cy: 0.68, rc: 0.13, shape: 'spread', ramp: 'pers', fork: 0.36, open: true, fruit: 6, fr: 0.068,
    boughs: [[-0.82, 0.25], [0.8, 0.15], [-0.2, -0.3], [0.3, -0.2]] },
  // apple: round and full
  6: { rx: 0.42, ry: 0.33, cy: 0.64, rc: 0.125, shape: 'round', ramp: 'leaf', fruit: 6, fr: 0.072,
    boughs: [[-0.55, 0.15], [0.55, 0.1], [0, -0.4]] },
  // pear: upright teardrop
  7: { rx: 0.28, ry: 0.42, cy: 0.72, rc: 0.1, shape: 'tear', ramp: 'pear', fruit: 5, fr: 0.07,
    boughs: [[-0.5, 0.2], [0.45, -0.1], [0, -0.5]] },
  // peach: an open vase, wider at the top than the bottom
  8: { rx: 0.48, ry: 0.23, cy: 0.72, rc: 0.11, shape: 'vase', ramp: 'peach', blossoms: 30, fork: 0.24, open: true, fruit: 6, fr: 0.07,
    boughs: [[-0.85, 0.1], [-0.35, -0.1], [0.35, -0.15], [0.85, 0.05]] },
};

const RAMPS = {
  leaf: ['leafDeep', 'leafShade', 'leafMid', 'leafLight'],
  citrus: ['citrusDeep', 'citrusShade', 'citrusMid', 'citrusLight'],
  pers: ['persDeep', 'persShade', 'persMid', 'persLight'],
  pear: ['pearDeep', 'pearShade', 'pearMid', 'pearLight'],
  peach: ['leafDeep', 'peachShade', 'peachMid', 'peachLight'],
};

const LAYOUT_VARIANTS = 3;

// How wide a crown of each shape is at height v (−1 top … 1 bottom), as a
// fraction of its rx.
function envelope(shape, v) {
  const round = Math.sqrt(Math.max(0, 1 - v * v));
  if (shape === 'tear') return round * (0.55 + 0.45 * (v + 1) / 2) * 1.12;
  if (shape === 'vase') return Math.pow(round, 0.55) * (1 - 0.38 * (v + 1) / 2);
  if (shape === 'spread') return Math.pow(round, 0.6);
  return round;
}

function buildCrown(form, variant, level) {
  const rand = rng(level * 7919 + variant * 104729 + 17);
  const { rx, ry, rc } = form;
  const pts = [];
  const far = (x, y, d) => pts.every((c) => Math.hypot(c.x - x, c.y - y) > d);
  // the rim first, so the silhouette is lumpy rather than an ellipse
  const rim = Math.round(TAU * Math.sqrt((rx * rx + ry * ry) / 2) / (rc * 1.15));
  for (let i = 0; i < rim; i++) {
    const a = (i + rand() * 0.5) / rim * TAU;
    const v = Math.sin(a);
    const x = Math.cos(a) * envelope(form.shape, v) * rx * 0.8;
    const y = v * ry * 0.8;
    if (form.open && Math.abs(x) < rx * 0.3 && y > 0) continue;
    pts.push({ x, y, r: rc * (0.85 + rand() * 0.35) });
  }
  // then fill the inside
  for (let tries = 0; tries < 400 && pts.length < rim * 2.2; tries++) {
    const v = rand() * 2 - 1;
    const x = (rand() * 2 - 1) * envelope(form.shape, v) * rx * 0.7;
    const y = v * ry * 0.72;
    if (!far(x, y, rc * 0.95)) continue;
    if (form.open && Math.abs(x) < rx * 0.3 && y > ry * 0.3) continue;
    pts.push({ x, y, r: rc * (0.95 + rand() * 0.35) });
  }
  // depth: lower and more central is nearer
  const depth = (c) => c.y / ry + 0.5 * (1 - Math.abs(c.x) / rx) + rand() * 0.25;
  pts.forEach((c) => { c.d = depth(c); });
  pts.sort((a, b) => a.d - b.d);
  const layers = [[], [], []];
  pts.forEach((c, i) => layers[Math.min(2, Math.floor(i / pts.length * 3))].push(c));

  // fruit: spread out across the lower two thirds and the flanks
  const fruit = [];
  const fr = form.fr;
  for (let tries = 0; tries < 600 && fruit.length < form.fruit; tries++) {
    const v = -0.35 + rand() * 1.25;
    if (v > 0.95) continue;
    const x = (rand() * 2 - 1) * envelope(form.shape, Math.min(0.95, v)) * rx * 0.78;
    const y = v * ry * 0.85;
    if (fruit.some((f) => Math.hypot(f.x - x, f.y - y) < fr * (tries < 300 ? 2.5 : 2.1))) continue;
    fruit.push({ x, y });
  }
  fruit.sort((a, b) => a.y - b.y);

  // blossoms: on the sunlit upper faces of the clumps
  const blossoms = [];
  for (let i = 0; i < (form.blossoms || 20); i++) {
    const c = pts[Math.floor(rand() * pts.length)];
    const a = -Math.PI * (0.1 + rand() * 0.8);
    const d = c.r * (0.25 + rand() * 0.5);
    blossoms.push({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d, s: 0.7 + rand() * 0.5 });
  }
  // leaf flecks: small dabs of shade and light over the clumps, for texture
  const flecks = [];
  for (let i = 0; i < 34; i++) {
    const c = pts[Math.floor(rand() * pts.length)];
    const a = rand() * TAU;
    const d = rand() * c.r * 0.75;
    const x = c.x + Math.cos(a) * d;
    const y = c.y + Math.sin(a) * d;
    flecks.push({ x, y, a: rand() * TAU, lit: x - y * 0.6 < 0.05 });
  }
  return { layers, fruit, blossoms, flecks };
}

const CROWNS = {};
for (const lv of Object.keys(TREE_FORMS)) {
  CROWNS[lv] = [];
  for (let v = 0; v < LAYOUT_VARIANTS; v++) CROWNS[lv].push(buildCrown(TREE_FORMS[lv], v, +lv));
}

// Perennials: a whip on a stake, a young tree, then a full crown that fruits
// forever — and flowers before each crop.
function paintTree(p, species) {
  const { ctx, stage, w, h } = p;
  if (stage === 'seed') return paintSeedling(p);
  if (stage === 'sapling') return paintWhip(p, FARM_PALETTE.leafMid, FARM_PALETTE.leafLight);

  const form = TREE_FORMS[species];
  const crown = CROWNS[species][p.seed % LAYOUT_VARIANTS];
  const young = stage === 'young';
  const k = young ? 0.6 : 1;                          // crown scale
  const cy = -h * form.cy * (young ? 0.72 : 1);
  const tw = w * (young ? 0.034 : 0.05);              // half the trunk's width
  const forkY = form.fork ? -h * form.fork * (young ? 0.72 : 1) : Math.min(-tw * 3, cy + form.ry * w * k * 0.62);

  groundShadow(ctx, w * form.rx * k * 0.85, h * 0.03);

  // trunk with a root flare, and its boughs, all one bark fill
  ctx.fillStyle = FARM_PALETTE.trunk;
  ctx.beginPath();
  ctx.moveTo(-tw * 2.1, 0);
  ctx.quadraticCurveTo(-tw * 1.05, -tw * 0.35, -tw, -tw * 1.8);
  ctx.lineTo(-tw * 0.66, forkY);
  ctx.lineTo(tw * 0.66, forkY);
  ctx.lineTo(tw, -tw * 1.8);
  ctx.quadraticCurveTo(tw * 1.05, -tw * 0.35, tw * 2.1, 0);
  ctx.closePath();
  for (const [bx, by] of form.boughs) {
    addBough(ctx, 0, forkY + tw * 1.5, bx * form.rx * w * k * 0.95, cy + by * form.ry * w * k, tw * 0.62, tw * 0.2);
  }
  ctx.fill();
  // the shaded right flank, and a lit stripe down the left
  ctx.fillStyle = FARM_PALETTE.trunkDark;
  ctx.beginPath();
  ctx.moveTo(tw * 0.3, 0);
  ctx.lineTo(tw * 2.1, 0);
  ctx.quadraticCurveTo(tw * 1.05, -tw * 0.35, tw, -tw * 1.8);
  ctx.lineTo(tw * 0.66, forkY);
  ctx.lineTo(tw * 0.2, forkY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = FARM_PALETTE.trunkLight;
  ctx.lineWidth = Math.max(0.6, tw * 0.3);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-tw * 0.55, -tw * 2.2);
  ctx.lineTo(-tw * 0.38, forkY + tw * 1.5);
  ctx.stroke();

  // The knot in the bark, which is a face if you look at it — the same trick
  // the fruit pull, at the one scale a trunk has room for.
  if (!young) paintKnot(ctx, tw, Math.max(forkY * 0.55, -h * 0.3), p.tMs, p.motion, p.seed);

  // the crown
  ctx.save();
  ctx.translate(0, cy);
  ctx.scale(w * k, w * k);
  const ramp = RAMPS[form.ramp].map((key) => FARM_PALETTE[key]);
  const pink = species === 1 && stage === 'bloom';
  paintCrown(ctx, crown, ramp, pink);
  if (stage === 'bloom') {
    paintBlossoms(ctx, crown.blossoms, (species === 1 ? 0.03 : 0.024), species === 1 || species === 8);
  }
  ctx.restore();

  if (stage === 'ripe') {
    const s = w;
    const fr = form.fr * s;
    crown.fruit.forEach((f, i) => {
      fruitAt(ctx, p.level, f.x * s, cy + f.y * s, fr, p.tMs, p.motion, p.seed, i);
    });
    // a few leaves in front of the fruit, so it hangs IN the crown rather than on it
    ctx.fillStyle = ramp[2];
    ctx.beginPath();
    crown.fruit.forEach((f, i) => {
      const x = f.x * s + fr * (i % 2 ? -0.7 : 0.7);
      const y = cy + f.y * s - fr * 0.85;
      addLeaf(ctx, x, y, fr * 1.25, fr * 0.9, (i % 2 ? -2.4 : -0.7));
    });
    ctx.fill();
    ctx.fillStyle = ramp[3];
    ctx.beginPath();
    crown.fruit.forEach((f, i) => {
      if (i % 2) return;
      addLeaf(ctx, f.x * s - fr * 0.2, cy + f.y * s - fr * 1.05, fr * 1.05, fr * 0.7, -1.9);
    });
    ctx.fill();
  }
  const top = cy - form.ry * w * k;
  return [w * form.rx * 0.7, top + h * 0.06];
}

function paintCrown(ctx, crown, ramp, pink) {
  const tones = [[ramp[0], ramp[1], ramp[2]], [ramp[1], ramp[2], ramp[3]], [ramp[1], ramp[2], ramp[3]]];
  const lit = (c) => c.x - c.y * 0.6 < 0.16;      // the light is on the upper left
  crown.layers.forEach((layer, li) => {
    const [shade, mid, light] = tones[li];
    ctx.fillStyle = shade;
    ctx.beginPath();
    for (const c of layer) addCircle(ctx, c.x, c.y, c.r);
    ctx.fill();
    // the sunlit clumps get a crescent: light laid down, then the mid body
    // over it nudged back down-right, so only the top-left rim stays lit
    ctx.fillStyle = light;
    ctx.beginPath();
    for (const c of layer) if (lit(c)) addCircle(ctx, c.x - c.r * 0.12, c.y - c.r * 0.18, c.r * 0.82);
    ctx.fill();
    ctx.fillStyle = mid;
    ctx.beginPath();
    for (const c of layer) {
      if (lit(c)) addCircle(ctx, c.x - c.r * 0.02, c.y - c.r * 0.04, c.r * 0.78);
      else addCircle(ctx, c.x - c.r * 0.08, c.y - c.r * 0.14, c.r * 0.82);
    }
    ctx.fill();
  });
  for (const lit of [false, true]) {
    ctx.fillStyle = lit ? (pink ? FARM_PALETTE.blossomPink : ramp[3]) : ramp[1];
    ctx.beginPath();
    for (const f of crown.flecks) if (f.lit === lit) addLeaf(ctx, f.x, f.y, 0.038, 0.022, f.a);
    ctx.fill();
  }
}

// Five-petalled flowers, petals in one fill and hearts in another. `pink`
// tints them for the cherry and the peach, whose blossom is the event.
function paintBlossoms(ctx, list, r, pink) {
  ctx.fillStyle = pink ? FARM_PALETTE.blossomPink : FARM_PALETTE.blossom;
  ctx.beginPath();
  list.forEach((b, i) => {
    if (pink && i % 3 === 0) return;
    addFlower(ctx, b.x, b.y, r * b.s, i);
  });
  ctx.fill();
  if (pink) {
    ctx.fillStyle = FARM_PALETTE.blossom;
    ctx.beginPath();
    list.forEach((b, i) => { if (i % 3 === 0) addFlower(ctx, b.x, b.y, r * b.s, i); });
    ctx.fill();
  }
  ctx.fillStyle = pink ? FARM_PALETTE.blossomDeep : FARM_PALETTE.blossomCore;
  ctx.beginPath();
  for (const b of list) addCircle(ctx, b.x, b.y, r * b.s * 0.32);
  ctx.fill();
}

// A whip tied to a bamboo stake, a handful of leaves up its length.
function paintWhip(p, mid, light) {
  const { ctx, w, h } = p;
  const s = Math.min(w, h);
  const top = s * 0.5;
  groundShadow(ctx, s * 0.12, s * 0.02);
  ctx.lineCap = 'round';
  ctx.strokeStyle = FARM_PALETTE.wood;
  ctx.lineWidth = Math.max(0.8, s * 0.022);
  ctx.beginPath();
  ctx.moveTo(s * 0.05, 0);
  ctx.lineTo(s * 0.05, -top * 1.05);
  ctx.stroke();
  ctx.strokeStyle = FARM_PALETTE.trunk;
  ctx.lineWidth = Math.max(0.8, s * 0.026);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-s * 0.03, -top * 0.5, 0, -top);
  ctx.stroke();
  ctx.strokeStyle = FARM_PALETTE.woodLight;
  ctx.lineWidth = Math.max(0.6, s * 0.014);
  ctx.beginPath();
  for (const t of [0.4, 0.75]) {
    ctx.moveTo(-s * 0.012, -top * t);
    ctx.lineTo(s * 0.06, -top * t - s * 0.01);
  }
  ctx.stroke();
  const leaves = [[0.55, -2.4, 0.9], [0.7, -0.6, 1], [0.85, -2.2, 0.95], [0.98, -1.3, 1.1], [0.95, -1.9, 0.9]];
  ctx.fillStyle = mid;
  ctx.beginPath();
  for (const [t, a, k] of leaves) addLeaf(ctx, 0, -top * t, s * 0.13 * k, s * 0.09 * k, a);
  ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath();
  for (const [t, a, k] of leaves) {
    if (a < -1.5) continue;
    addLeaf(ctx, 0, -top * t, s * 0.09 * k, s * 0.04 * k, a - 0.12);
  }
  ctx.fill();
  return [s * 0.2, -top - s * 0.1];
}

// Two half-shut eyes in the bark. Drawn in the trunk's own dark, at the size a
// knot would be, so a tree that is not being looked at is a tree with a knot in
// it and a tree that is has been quietly watching the whole time.
function paintKnot(ctx, tw, y, tMs, motion, seed) {
  const r = tw * 0.2;
  const gap = tw * 0.36;
  const shut = motion && isWinking(seed, tMs);
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = FARM_PALETTE.bark;
  ctx.strokeStyle = FARM_PALETTE.bark;
  ctx.lineWidth = Math.max(0.5, r * 0.7);
  ctx.beginPath();
  for (const dir of [-1, 1]) {
    if (shut) {
      ctx.moveTo(dir * gap - r, y);
      ctx.lineTo(dir * gap + r, y);
    } else {
      addEllipse(ctx, dir * gap, y, r, r * 1.2);
    }
  }
  if (shut) ctx.stroke(); else ctx.fill();
  ctx.restore();
}

// ── the low crops ──────────────────────────────────────────────────────────

// Strawberries (and any bed without a picture of its own): a low rosette of
// trifoliate, saw-edged leaves, white flowers, and berries hanging over the
// edge of the clump where you can see them.
const LEAFLET = (() => {
  const teeth = 7;
  const up = [];
  for (let i = 0; i <= teeth * 2; i++) {
    const t = i / (teeth * 2);
    const hw = 0.4 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.75) * (1 - 0.15 * t);
    const tooth = t > 0.2 && i % 2 === 1 ? 0.78 : 1;
    up.push([t, -hw * tooth]);
  }
  const down = up.slice(0, -1).reverse().map(([x, y]) => [x, -y]);
  return up.concat(down);
})();

// [angle from vertical, reach (fraction of h), leaflet size (fraction of w), layer]
const ROSETTE = (() => {
  const rand = rng(2203);
  const out = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = -1.25 + (i / (n - 1)) * 2.5 + (rand() - 0.5) * 0.2;
    const back = Math.abs(a) < 0.75 && i % 2 === 0;
    out.push({ a, reach: (back ? 0.44 : 0.32) + rand() * 0.06, s: 0.23 + rand() * 0.04, back });
  }
  return out.sort((x, y) => (y.back - x.back));
})();

function paintRosette(p) {
  const { ctx, stage, w, h, level } = p;
  if (stage === 'seed') return paintSeedling(p);
  const sprout = stage === 'sprout';
  const k = sprout ? 0.55 : 1;
  const s = Math.min(w, h * 0.75);
  groundShadow(ctx, s * 0.46 * k, s * 0.045);

  const leaves = sprout ? ROSETTE.filter((_, i) => i % 2 === 0) : ROSETTE;
  const tip = (L) => [Math.sin(L.a) * L.reach * h * k * 0.78, -Math.cos(L.a) * L.reach * h * k * 0.9];
  // petioles
  ctx.strokeStyle = FARM_PALETTE.stem;
  ctx.lineWidth = Math.max(0.7, s * 0.022);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const L of leaves) {
    const [x, y] = tip(L);
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(x * 0.3, y * 0.7, x, y);
  }
  ctx.stroke();
  // leaflets: the back ones in shade, the front ones lit, three to a leaf
  const leaflets = (L, scale) => {
    const [x, y] = tip(L);
    const base = L.a - Math.PI / 2;
    for (const off of [-0.8, 0, 0.8]) {
      const len = L.s * s * k * (off ? 0.86 : 1) * scale;
      addPoly(ctx, LEAFLET, x, y, base + off, len, 1);
    }
  };
  for (const [back, tone] of [[true, FARM_PALETTE.bedShade], [false, FARM_PALETTE.bedMid]]) {
    ctx.fillStyle = tone;
    ctx.beginPath();
    for (const L of leaves) if (L.back === back) leaflets(L, 1);
    ctx.fill();
  }
  // a lit half on every front leaflet, then the midribs
  ctx.fillStyle = FARM_PALETTE.bedLight;
  ctx.beginPath();
  for (const L of leaves) {
    if (L.back) continue;
    const [x, y] = tip(L);
    const base = L.a - Math.PI / 2;
    for (const off of [-0.8, 0, 0.8]) {
      const len = L.s * s * k * (off ? 0.86 : 1);
      addPoly(ctx, LEAFLET_HALF, x, y, base + off, len, 1);
    }
  }
  ctx.fill();
  ctx.strokeStyle = FARM_PALETTE.bedDeep;
  ctx.lineWidth = Math.max(0.4, s * 0.008);
  ctx.beginPath();
  for (const L of leaves) {
    const [x, y] = tip(L);
    const base = L.a - Math.PI / 2;
    for (const off of [-0.8, 0, 0.8]) {
      const len = L.s * s * k * (off ? 0.86 : 1) * 0.85;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(base + off) * len, y + Math.sin(base + off) * len);
    }
  }
  ctx.stroke();
  const top = -h * 0.5 * k;

  if (stage === 'bloom') {
    const spots = [[-0.3, 0.3], [0.28, 0.36], [0.04, 0.46], [-0.1, 0.18], [0.4, 0.16]];
    ctx.strokeStyle = FARM_PALETTE.stem;
    ctx.lineWidth = Math.max(0.6, s * 0.014);
    ctx.beginPath();
    for (const [x, y] of spots) { ctx.moveTo(x * s * 0.3, -h * 0.1); ctx.quadraticCurveTo(x * s * 0.8, -y * h * 0.8, x * s, -y * h); }
    ctx.stroke();
    ctx.fillStyle = FARM_PALETTE.blossom;
    ctx.beginPath();
    spots.forEach(([x, y], i) => addFlower(ctx, x * s, -y * h, s * 0.075, i));
    ctx.fill();
    ctx.fillStyle = FARM_PALETTE.flowerYellow;
    ctx.beginPath();
    for (const [x, y] of spots) addCircle(ctx, x * s, -y * h, s * 0.03);
    ctx.fill();
  }
  if (stage === 'ripe') {
    // berries hang off arching stems at the rim of the clump
    const fr = s * 0.135;
    const spots = [[-0.36, 0.13], [0.37, 0.17], [-0.13, 0.08], [0.16, 0.07]];
    ctx.strokeStyle = FARM_PALETTE.stem;
    ctx.lineWidth = Math.max(0.6, s * 0.014);
    ctx.beginPath();
    for (const [x, y] of spots) {
      ctx.moveTo(x * s * 0.4, -h * 0.24);
      ctx.quadraticCurveTo(x * s * 0.95, -h * 0.32, x * s, -y * h - fr * 0.9);
    }
    ctx.stroke();
    spots.forEach(([x, y], i) => fruitAt(ctx, level, x * s, -y * h, fr, p.tMs, p.motion, p.seed, i));
  }
  return [s * 0.36, top];
}

const LEAFLET_HALF = (() => {
  const half = LEAFLET.slice(0, Math.ceil(LEAFLET.length / 2));
  return half.map(([x, y]) => [x, y * 0.82]).concat([[0.98, 0], [0.12, 0]]);
})();

// Pineapple: a fountain of long stiff blades in four shades, and the fruit
// sitting up out of the middle of them on its own short stalk.
// [angle from vertical, length (fraction of h), base width (fraction of w), shade 0..3]
const PINE_BLADES = (() => {
  const rand = rng(9091);
  const out = [];
  const n = 15;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = (t - 0.5) * 2.7 + (rand() - 0.5) * 0.18;
    const shade = i % 3 === 0 ? 0 : (Math.abs(a) > 0.9 ? 1 : 2 + (i % 2));
    out.push({ a, len: 0.62 - Math.abs(a) * 0.12 + rand() * 0.08, bw: 0.065 + rand() * 0.02, shade: Math.min(3, shade) });
  }
  return out;
})();

function paintPineapple(p) {
  const { ctx, stage, w, h, level } = p;
  if (stage === 'seed') return paintSeedling(p);
  const k = stage === 'sprout' ? 0.5 : 1;
  const s = Math.min(w, h * 0.75);
  groundShadow(ctx, s * 0.4 * k, s * 0.04);
  const tones = [FARM_PALETTE.pineDeep, FARM_PALETTE.pineShade, FARM_PALETTE.pineMid, FARM_PALETTE.pineLight];
  const blades = stage === 'sprout' ? PINE_BLADES.filter((_, i) => i % 2 === 1) : PINE_BLADES;
  const blade = (b) => {
    const L = b.len * h * k;
    const bw = b.bw * w * k;
    const tx = Math.sin(b.a) * L;
    const ty = -Math.cos(b.a) * L * 0.95;
    const cx = Math.sin(b.a * 0.55) * L * 0.6;
    const cy = -Math.cos(b.a * 0.55) * L * 0.75;
    const bx = Math.sin(b.a) * bw;
    ctx.moveTo(bx - bw, 0);
    ctx.quadraticCurveTo(cx - bw * 0.5, cy, tx, ty);
    ctx.quadraticCurveTo(cx + bw * 0.5, cy, bx + bw, 0);
    ctx.closePath();
  };
  const fruiting = stage === 'bloom' || stage === 'ripe';
  // back blades, then the fruit, then the front blades over its foot
  const front = (b) => b.shade >= 2 && Math.abs(b.a) > 0.35;
  for (let shade = 0; shade < 4; shade++) {
    ctx.fillStyle = tones[shade];
    ctx.beginPath();
    for (const b of blades) if (b.shade === shade && !(fruiting && front(b))) blade(b);
    ctx.fill();
    if (shade) continue;
    // a bronze blush down the middle of the back blades — real pineapple leaves have it
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = FARM_PALETTE.pineBronze;
    ctx.beginPath();
    for (const b of blades) if (b.shade === 0) blade({ ...b, bw: b.bw * 0.35, len: b.len * 0.6 });
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  let top = -h * 0.5 * k;
  if (fruiting) {
    const fr = stage === 'ripe' ? s * 0.27 : s * 0.13;
    const fy = -h * 0.24 - fr * 0.9;
    ctx.strokeStyle = FARM_PALETTE.pineShade;
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, fy);
    ctx.stroke();
    fruitAt(ctx, level, 0, fy, fr, p.tMs, p.motion, p.seed, 0);
    for (let shade = 2; shade < 4; shade++) {
      ctx.fillStyle = tones[shade];
      ctx.beginPath();
      for (const b of blades) if (b.shade === shade && front(b)) blade(b);
      ctx.fill();
    }
    top = Math.min(top, fy - fr * 1.4);
  }
  return [s * 0.38, top];
}

// Melon and watermelon: runners sprawling over two tiles of ground, big leaves
// lying low on them, curly tendrils, yellow flowers, and the fruit itself lying
// ON the soil — which is where a melon actually grows.
const MELON_LEAF = palmate(5, 0.16, 0.03, 0);
const WATERMELON_LEAF = palmate(3, 0.46, 0.02, 1);

// Unit palmate leaf: petiole base at the origin, blade out along +x, length 1.
function palmate(lobes, depth, teeth, cut) {
  const pts = [];
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const phi = -Math.PI + (i / n) * TAU;          // 0 = tip, ±π = petiole
    let r = 1 - depth * (0.5 - 0.5 * Math.cos(lobes * phi));
    if (cut) r *= 0.86 + 0.14 * Math.cos(lobes * 2 * phi);
    r += teeth * Math.cos(lobes * 5 * phi) * 0.5;
    r *= 1 - 0.62 * Math.exp(-Math.pow(Math.abs(phi) - Math.PI, 2) / 0.12); // the notch at the stalk
    pts.push([0.5 + Math.cos(phi) * r * 0.5, Math.sin(phi) * r * 0.46]);
  }
  return pts;
}

// [x along the runners (fraction of w), petiole height (fraction of h), size (fraction of w), angle, front]
const SPRAWL = (() => {
  const rand = rng(4421);
  const out = [];
  const back = [-0.4, -0.24, -0.07, 0.09, 0.25, 0.4];
  const front = [-0.47, -0.02, 0.47];
  back.forEach((x) => out.push({ x, y: 0.1 + rand() * 0.07, size: 0.19 + rand() * 0.05,
    a: -Math.PI / 2 + x * 1.5 + (rand() - 0.5) * 0.4, front: false }));
  front.forEach((x) => out.push({ x, y: 0.03 + rand() * 0.03, size: 0.15 + rand() * 0.03,
    a: -Math.PI / 2 + x * 2 + (rand() - 0.5) * 0.3, front: true }));
  return out;
})();

function paintSprawl(p, species) {
  const { ctx, stage, w, h, level } = p;
  if (stage === 'seed') return paintSeedling(p);
  const shape = species === 11 ? WATERMELON_LEAF : MELON_LEAF;
  const sprout = stage === 'sprout';
  const reach = sprout ? 0.2 : 0.5;
  groundShadow(ctx, w * reach * 0.95, h * 0.03);

  // runners lying along the ground, and their tendrils
  ctx.strokeStyle = FARM_PALETTE.gourdShade;
  ctx.lineWidth = Math.max(0.8, w * 0.016);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const dir of [-1, 1]) {
    ctx.moveTo(0, -h * 0.02);
    ctx.bezierCurveTo(dir * w * reach * 0.3, -h * 0.07, dir * w * reach * 0.6, h * 0.01, dir * w * reach, -h * 0.04);
  }
  ctx.stroke();
  if (!sprout) {
    ctx.strokeStyle = FARM_PALETTE.tendril;
    ctx.lineWidth = Math.max(0.5, w * 0.007);
    ctx.beginPath();
    for (const [x, y, r] of [[-0.49, 0.04, 0.026], [0.5, 0.05, 0.024], [-0.31, 0.06, 0.02], [0.33, 0.05, 0.02]]) {
      addCurl(ctx, x * w, -y * h, r * w);
    }
    ctx.stroke();
  }

  const leaves = sprout ? SPRAWL.filter((l) => Math.abs(l.x) < 0.2 && !l.front) : SPRAWL;
  const k = sprout ? 0.55 : 1;
  const base = (l) => [l.x * w * k, -l.y * h * k];
  // leaf stalks
  ctx.strokeStyle = FARM_PALETTE.gourdShade;
  ctx.lineWidth = Math.max(0.6, w * 0.01);
  ctx.beginPath();
  for (const l of leaves) {
    const [x, y] = base(l);
    ctx.moveTo(x * 0.85, -h * 0.03);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  const leafAt = (l, scale, dx, dy) => {
    const [x, y] = base(l);
    const size = l.size * w * k;
    addPoly(ctx, shape, x + dx * size, y + dy * size, l.a, size * scale, 0.82);
  };
  const drawLeaves = (front) => {
    ctx.fillStyle = front ? FARM_PALETTE.gourdShade : FARM_PALETTE.gourdDeep;
    ctx.beginPath();
    for (const l of leaves) if (l.front === front) leafAt(l, 1, 0, 0);
    ctx.fill();
    ctx.fillStyle = FARM_PALETTE.gourdLight;
    ctx.beginPath();
    for (const l of leaves) if (l.front === front && l.x < 0.3) leafAt(l, 0.9, -0.04, -0.06);
    ctx.fill();
    ctx.fillStyle = front ? FARM_PALETTE.gourdMid : FARM_PALETTE.gourdShade;
    ctx.beginPath();
    for (const l of leaves) if (l.front === front) leafAt(l, 0.86, 0.02, 0.02);
    ctx.fill();
    // the veins, fanning from the stalk
    ctx.strokeStyle = front ? FARM_PALETTE.gourdShade : FARM_PALETTE.gourdDeep;
    ctx.lineWidth = Math.max(0.4, w * 0.005);
    ctx.beginPath();
    for (const l of leaves) {
      if (l.front !== front) continue;
      const [x, y] = base(l);
      const size = l.size * w * k * 0.72;
      for (const off of [-0.9, 0, 0.9]) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(l.a + off) * size * (off ? 0.7 : 1), y + Math.sin(l.a + off) * size * 0.82 * (off ? 0.7 : 1));
      }
    }
    ctx.stroke();
  };
  drawLeaves(false);

  if (stage === 'ripe') {
    const big = species === 11;
    const spots = big ? [[0.13, 0.21], [-0.26, 0.135]] : [[-0.17, 0.16], [0.2, 0.14]];
    spots.forEach(([x, r], i) => {
      const fr = r * w;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = FARM_PALETTE.shadow;
      ctx.beginPath();
      addEllipse(ctx, x * w + fr * 0.15, -h * 0.01, fr * 1.05, fr * 0.22);
      ctx.fill();
      ctx.globalAlpha = 1;
      fruitAt(ctx, level, x * w, -fr * 0.9 - h * 0.01, fr, p.tMs, p.motion, p.seed, i);
    });
  }
  drawLeaves(true);
  if (stage === 'bloom') {
    const spots = [[-0.32, 0.2], [0.06, 0.24], [0.34, 0.19], [-0.13, 0.12]];
    ctx.fillStyle = FARM_PALETTE.flowerYellow;
    ctx.beginPath();
    spots.forEach(([x, y], i) => addFlower(ctx, x * w, -y * h, w * 0.04, i));
    ctx.fill();
    ctx.fillStyle = FARM_PALETTE.flowerYellowDark;
    ctx.beginPath();
    for (const [x, y] of spots) addCircle(ctx, x * w, -y * h, w * 0.013);
    ctx.fill();
  }
  return [w * 0.3, -h * (stage === 'ripe' ? 0.48 : 0.3)];
}

// ── vines ──────────────────────────────────────────────────────────────────

// Grapes: a timber trellis, a gnarled trunk up the middle, arms out along the
// top bar, broad lobed leaves hanging off it, and bunches below the leaves.
const GRAPE_LEAF = palmate(5, 0.3, 0.05, 0);

// [x along the bar (fraction of w), drop below the bar (fraction of h), size
// (fraction of w), angle the blade points, back]. A few leaves stand up off
// the bar; most hang from it.
const CANOPY = (() => {
  const rand = rng(331);
  const out = [];
  [-0.42, -0.2, 0.02, 0.24, 0.44].forEach((x, i) => out.push({ x, y: -0.01, size: 0.3 + rand() * 0.06,
    a: -Math.PI / 2 + x * 1.1 + (rand() - 0.5) * 0.4, back: true, i }));
  [-0.5, -0.33, -0.15, 0.04, 0.2, 0.36, 0.52].forEach((x, i) => out.push({ x, y: 0.0 + rand() * 0.04, size: 0.28 + rand() * 0.06,
    a: Math.PI / 2 - x * 1.4 + (rand() - 0.5) * 0.5, back: i % 2 === 0, i: i + 5 }));
  [-0.28, 0.12, 0.4].forEach((x, i) => out.push({ x, y: 0.1 + rand() * 0.04, size: 0.24 + rand() * 0.05,
    a: Math.PI / 2 - x * 1.2 + (rand() - 0.5) * 0.4, back: false, i: i + 12 }));
  return out;
})();

function paintVine(p) {
  const { ctx, stage, w, h, level } = p;
  paintTrellis(ctx, w, h);
  if (stage === 'seed') return paintSeedling(p);
  const barY = -h * TRELLIS.bar;
  const reach = stage === 'sapling' ? 0.45 : 1;
  const trunkTop = stage === 'sapling' ? -h * 0.4 : barY;
  // the trunk: a twist of old wood up the middle
  ctx.lineCap = 'round';
  ctx.strokeStyle = FARM_PALETTE.bark;
  ctx.lineWidth = Math.max(1, w * (stage === 'sapling' ? 0.03 : 0.055));
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(w * 0.08, trunkTop * 0.35, -w * 0.07, trunkTop * 0.7, 0, trunkTop);
  if (stage !== 'sapling') {
    for (const dir of [-1, 1]) {
      ctx.moveTo(0, trunkTop);
      ctx.quadraticCurveTo(dir * w * 0.2, barY - h * 0.03, dir * w * 0.46 * reach, barY);
    }
  }
  ctx.stroke();
  ctx.strokeStyle = FARM_PALETTE.trunkLight;
  ctx.lineWidth = Math.max(0.5, w * 0.012);
  ctx.beginPath();
  ctx.moveTo(-w * 0.008, -h * 0.04);
  ctx.bezierCurveTo(w * 0.06, trunkTop * 0.35, -w * 0.085, trunkTop * 0.7, -w * 0.012, trunkTop);
  ctx.stroke();

  if (stage === 'sapling') {
    ctx.fillStyle = FARM_PALETTE.leafMid;
    ctx.beginPath();
    addPoly(ctx, GRAPE_LEAF, 0, trunkTop, -Math.PI * 0.75, w * 0.24, 1);
    addPoly(ctx, GRAPE_LEAF, 0, trunkTop * 0.65, -Math.PI * 0.2, w * 0.22, 1);
    ctx.fill();
    return [w * 0.2, trunkTop];
  }
  const young = stage === 'young';
  const leaves = young ? CANOPY.filter((l) => l.i % 2 === 1 && Math.abs(l.x) < 0.45) : CANOPY;
  const leafAt = (l, scale, dx, dy) => addPoly(ctx, GRAPE_LEAF, l.x * w + (dx || 0) * l.size * w,
    barY + l.y * h + (dy || 0) * l.size * w, l.a, l.size * w * scale, 1);
  for (const back of [true, false]) {
    ctx.fillStyle = back ? FARM_PALETTE.leafDeep : FARM_PALETTE.leafShade;
    ctx.beginPath();
    for (const l of leaves) if (l.back === back) leafAt(l, 1);
    ctx.fill();
    if (!back) {
      ctx.fillStyle = FARM_PALETTE.leafLight;
      ctx.beginPath();
      for (const l of leaves) if (!l.back && l.x < 0.3) leafAt(l, 0.88, -0.03, -0.05);
      ctx.fill();
    }
    ctx.fillStyle = back ? FARM_PALETTE.leafShade : FARM_PALETTE.leafMid;
    ctx.beginPath();
    for (const l of leaves) if (l.back === back) leafAt(l, 0.84, 0.02, 0.02);
    ctx.fill();
  }

  if (stage === 'bloom') {
    // grape flowers are little green-cream sprays, not petals
    ctx.fillStyle = FARM_PALETTE.blossom;
    ctx.beginPath();
    for (const x of [-0.25, 0.05, 0.32]) {
      for (let i = 0; i < 6; i++) addCircle(ctx, x * w + ((i % 3) - 1) * w * 0.025, barY + h * 0.12 + Math.floor(i / 3) * w * 0.03 + (i % 3 === 1 ? w * 0.01 : 0), w * 0.014);
    }
    ctx.fill();
  }
  if (stage === 'ripe') {
    const fr = w * 0.15;
    const bunches = [[-0.27, 0.22], [0.08, 0.28], [0.34, 0.2]];
    ctx.strokeStyle = FARM_PALETTE.stemDark;
    ctx.lineWidth = Math.max(0.6, w * 0.012);
    ctx.beginPath();
    for (const [x, y] of bunches) {
      ctx.moveTo(x * w, barY + h * 0.06);
      ctx.lineTo(x * w, barY + y * h - fr * 0.8);
    }
    ctx.stroke();
    bunches.forEach(([x, y], i) => {
      // a bunch: a big grape and a smaller one tucked under it, both the real thing
      fruitAt(ctx, level, x * w + fr * 0.25, barY + y * h + fr * 0.95, fr * 0.7, p.tMs, p.motion, p.seed, i * 2 + 1);
      fruitAt(ctx, level, x * w, barY + y * h, fr, p.tMs, p.motion, p.seed, i * 2);
    });
  }
  return [w * 0.36, barY - h * 0.08];
}

const TRELLIS = { post: 0.4, bar: 0.86, wire: 0.5 };

// The trellis is plot furniture as much as plant: built once, standing through
// every harvest. Two posts, a top bar with a lit face and a shaded underside,
// and one wire across the middle for the young canes.
export function paintTrellis(ctx, w, h) {
  const pw = Math.max(1.2, w * 0.05);
  const barY = -h * TRELLIS.bar;
  const bh = Math.max(1.2, h * 0.05);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = FARM_PALETTE.woodDark;
  ctx.lineWidth = Math.max(0.5, h * 0.008);
  ctx.beginPath();
  ctx.moveTo(-w * TRELLIS.post, -h * TRELLIS.wire);
  ctx.lineTo(w * TRELLIS.post, -h * TRELLIS.wire);
  ctx.stroke();
  ctx.fillStyle = FARM_PALETTE.wood;
  ctx.beginPath();
  for (const dir of [-1, 1]) ctx.rect(dir * w * TRELLIS.post - pw / 2, barY - bh, pw, h * TRELLIS.bar + bh);
  ctx.rect(-w * 0.5, barY - bh, w, bh);
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.woodDark;
  ctx.beginPath();
  for (const dir of [-1, 1]) ctx.rect(dir * w * TRELLIS.post + pw * 0.1, barY, pw * 0.4, h * TRELLIS.bar);
  ctx.rect(-w * 0.5, barY - bh * 0.35, w, bh * 0.35);
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.woodLight;
  ctx.beginPath();
  ctx.rect(-w * 0.5, barY - bh, w, bh * 0.3);
  for (const dir of [-1, 1]) ctx.rect(dir * w * TRELLIS.post - pw / 2, barY, pw * 0.25, h * TRELLIS.bar);
  ctx.fill();
  ctx.restore();
}

// ── things that are not plants ─────────────────────────────────────────────

/**
 * Paint a structure — 'pond', 'beehive' or 'compost' — standing on the origin
 * and fitting inside w × h·0.6. Same motion rule as the plants: the pond's
 * ripple and the bees' laps are decoration, and stop under reduced motion.
 *
 * opts: { tMs, motion, seed }
 */
export function paintStructure(ctx, kind, w, h, opts) {
  const o = opts || {};
  const tMs = Number.isFinite(o.tMs) ? o.tMs : 0;
  const seed = Number.isInteger(o.seed) ? Math.abs(o.seed) : 0;
  const motion = !!o.motion;
  ctx.save();
  if (kind === 'pond') paintPond(ctx, w, h * 0.6, tMs, motion, seed);
  else if (kind === 'beehive') paintHive(ctx, w, h * 0.6, tMs, motion, seed);
  else if (kind === 'compost') paintCompost(ctx, w, h * 0.6);
  ctx.restore();
}

function paintPond(ctx, w, h, tMs, motion, seed) {
  const rx = w * 0.44;
  const ry = Math.min(h * 0.22, w * 0.14);
  const cy = -ry * 1.05;
  // reeds behind the water, at the back left and right
  ctx.lineCap = 'round';
  const reeds = [[-0.34, 0.72, -0.1], [-0.27, 0.58, 0.05], [-0.4, 0.48, -0.22], [0.33, 0.62, 0.1], [0.39, 0.46, 0.22]];
  ctx.strokeStyle = FARM_PALETTE.reedDark;
  ctx.lineWidth = Math.max(0.7, w * 0.014);
  ctx.beginPath();
  for (const [x, t, lean] of reeds) {
    ctx.moveTo(x * w, cy);
    ctx.quadraticCurveTo(x * w, cy - h * t * 0.5, x * w + lean * h * 0.4, cy - h * t);
  }
  ctx.stroke();
  ctx.fillStyle = FARM_PALETTE.reed;
  ctx.beginPath();
  for (const [x, t, lean] of [[-0.31, 0.55, -0.35], [0.36, 0.45, 0.4], [-0.22, 0.38, 0.2]]) {
    addLeaf(ctx, x * w, cy, h * t, w * 0.035, -Math.PI / 2 + lean);
  }
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.cattail;
  ctx.beginPath();
  for (const [x, t, lean] of reeds.slice(0, 4)) {
    if (t < 0.55) continue;
    addEllipse(ctx, x * w + lean * h * 0.36, cy - h * t * 0.86, w * 0.016, h * 0.08);
  }
  ctx.fill();
  // stone rim, water, deep middle, light near edge
  ctx.fillStyle = FARM_PALETTE.stoneDark;
  ctx.beginPath();
  addEllipse(ctx, 0, cy + ry * 0.12, rx * 1.08, ry * 1.18);
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.water;
  ctx.beginPath();
  addEllipse(ctx, 0, cy, rx, ry);
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.waterDeep;
  ctx.beginPath();
  addEllipse(ctx, rx * 0.05, cy - ry * 0.18, rx * 0.8, ry * 0.68);
  ctx.fill();
  // a lily pad with its flower
  ctx.fillStyle = FARM_PALETTE.leafMid;
  ctx.beginPath();
  ctx.moveTo(rx * 0.35, cy + ry * 0.1);
  ctx.ellipse(rx * 0.35, cy + ry * 0.1, rx * 0.16, ry * 0.3, 0, 0.35, TAU - 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.lily;
  ctx.beginPath();
  addFlower(ctx, rx * 0.3, cy + ry * 0.02, rx * 0.07, 1);
  ctx.fill();
  // the shimmer: a fixed highlight, plus one ring spreading out when motion is on
  ctx.strokeStyle = FARM_PALETTE.waterLight;
  ctx.lineWidth = Math.max(0.6, w * 0.012);
  ctx.beginPath();
  ctx.ellipse(-rx * 0.35, cy - ry * 0.1, rx * 0.28, ry * 0.35, 0, Math.PI * 1.1, Math.PI * 1.7);
  ctx.stroke();
  if (motion) {
    const t = ((tMs + seed * 397) % PLANT.rippleMs) / PLANT.rippleMs;
    ctx.globalAlpha = 0.8 * (1 - t);
    ctx.beginPath();
    addEllipse(ctx, -rx * 0.2, cy + ry * 0.05, rx * (0.1 + 0.4 * t), ry * (0.1 + 0.4 * t));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // rim stones over the front edge
  const stones = [[-0.9, 0.55, 0.12], [-0.62, 0.92, 0.14], [-0.28, 1.08, 0.13], [0.08, 1.1, 0.15], [0.44, 1.0, 0.13], [0.76, 0.76, 0.13], [0.98, 0.3, 0.1]];
  ctx.fillStyle = FARM_PALETTE.stone;
  ctx.beginPath();
  for (const [x, y, r] of stones) addEllipse(ctx, x * rx, cy + y * ry, r * rx, r * rx * 0.55);
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.stoneLight;
  ctx.beginPath();
  for (const [x, y, r] of stones) addEllipse(ctx, x * rx - r * rx * 0.25, cy + y * ry - r * rx * 0.2, r * rx * 0.5, r * rx * 0.22);
  ctx.fill();
}

// A straw skep on a little stand: coils stacked into a dome, each lit along
// its top, with a dark doorway at the foot.
function paintHive(ctx, w, h, tMs, motion, seed) {
  const bw = Math.min(w * 0.36, h * 0.42);           // half-width at the base
  const standH = h * 0.12;
  const domeH = h * 0.66;
  groundShadow(ctx, bw * 1.3, h * 0.035);
  // the stand: a plank on two stumps
  ctx.fillStyle = FARM_PALETTE.woodDark;
  ctx.beginPath();
  ctx.rect(-bw * 0.8, -standH, bw * 0.22, standH);
  ctx.rect(bw * 0.58, -standH, bw * 0.22, standH);
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.wood;
  ctx.beginPath();
  ctx.rect(-bw * 1.2, -standH - h * 0.045, bw * 2.4, h * 0.045);
  ctx.fill();
  const y0 = -standH - h * 0.045;
  const coils = 5;
  const halfAt = (t) => bw * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.2))) * (1 - 0.08 * t);
  // the dome in shade, then each coil as a lit band
  ctx.fillStyle = FARM_PALETTE.hiveDark;
  ctx.beginPath();
  ctx.moveTo(-bw, y0);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    ctx.lineTo(-halfAt(t), y0 - t * domeH);
  }
  for (let i = 16; i >= 0; i--) {
    const t = i / 16;
    ctx.lineTo(halfAt(t), y0 - t * domeH);
  }
  ctx.closePath();
  ctx.fill();
  const coilH = domeH / coils;
  for (const [tone, inset, lift, k] of [[FARM_PALETTE.hive, 0.02, 0.06, 0.86], [FARM_PALETTE.hiveLight, 0.18, 0.5, 0.32]]) {
    ctx.fillStyle = tone;
    ctx.beginPath();
    for (let i = 0; i < coils; i++) {
      const tMid = (i + 0.55) / coils;
      const hw = halfAt(tMid) * (1 - inset) - (tone === FARM_PALETTE.hiveLight ? bw * 0.25 : 0);
      if (hw <= 0) continue;
      const cy = y0 - (i + 0.5) * coilH - coilH * lift * 0.3;
      const dx = tone === FARM_PALETTE.hiveLight ? -bw * 0.18 : 0;
      addEllipse(ctx, dx, cy, hw, coilH * 0.5 * k);
    }
    ctx.fill();
  }
  // the doorway
  ctx.fillStyle = FARM_PALETTE.hiveHole;
  ctx.beginPath();
  ctx.moveTo(-bw * 0.2, y0);
  ctx.quadraticCurveTo(-bw * 0.2, y0 - coilH * 0.95, 0, y0 - coilH * 0.95);
  ctx.quadraticCurveTo(bw * 0.2, y0 - coilH * 0.95, bw * 0.2, y0);
  ctx.closePath();
  ctx.fill();
  // bees: a couple on laps of the skep when motion is on; one at the door when not
  const r = Math.max(1.2, w * 0.03);
  if (motion) {
    for (let i = 0; i < 2; i++) {
      const a = ((tMs + seed * 211) / PLANT.beeMs + i * 0.5) * TAU * (i ? -1 : 1);
      bee(ctx, Math.cos(a) * bw * 1.25, y0 - domeH * (0.55 + i * 0.25) + Math.sin(a * 2) * h * 0.08, r, (Math.cos(a) > 0) === !i);
    }
  } else {
    bee(ctx, bw * 0.34, y0 - coilH * 0.35, r, false);
  }
}

function bee(ctx, x, y, r, flip) {
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = FARM_PALETTE.beeWing;
  ctx.beginPath();
  addEllipse(ctx, -r * 0.2, -r * 0.9, r * 0.55, r * 0.7);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = FARM_PALETTE.bee;
  ctx.beginPath();
  addEllipse(ctx, 0, 0, r * 1.2, r * 0.85);
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.beeStripe;
  ctx.beginPath();
  ctx.rect(-r * 0.35, -r * 0.8, r * 0.28, r * 1.6);
  ctx.rect(r * 0.25, -r * 0.75, r * 0.26, r * 1.5);
  ctx.fill();
  ctx.restore();
}

function paintCompost(ctx, w, h) {
  const bw = w * 0.72;
  const bh = h * 0.5;
  groundShadow(ctx, bw * 0.55, h * 0.03);
  // the heap, poking up over the slats, with the odd peel in it
  ctx.fillStyle = FARM_PALETTE.humus;
  ctx.beginPath();
  ctx.moveTo(-bw * 0.46, -bh * 0.9);
  ctx.bezierCurveTo(-bw * 0.35, -bh * 1.55, bw * 0.3, -bh * 1.6, bw * 0.46, -bh * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.humusLight;
  ctx.beginPath();
  addEllipse(ctx, -bw * 0.12, -bh * 1.3, bw * 0.18, bh * 0.1);
  ctx.fill();
  for (const [lv, x, y, a] of [[4, -0.22, 1.12, 0.4], [6, 0.12, 1.24, -0.3], [11, 0.3, 1.02, 0.2], [2, -0.02, 1.38, 0.9]]) {
    ctx.fillStyle = FRUITS[lv - 1].color;
    ctx.beginPath();
    addLeaf(ctx, x * bw, -y * bh, bw * 0.12, bw * 0.07, a);
    ctx.fill();
  }
  // posts and three slats, each lit on top and shaded beneath
  const slatH = bh * 0.26;
  ctx.fillStyle = FARM_PALETTE.woodDark;
  ctx.beginPath();
  ctx.rect(-bw / 2, -bh * 1.08, bw * 0.08, bh * 1.08);
  ctx.rect(bw * 0.42, -bh * 1.08, bw * 0.08, bh * 1.08);
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.humus;                 // the heap, between the slats
  ctx.beginPath();
  ctx.rect(-bw * 0.42, -bh, bw * 0.84, bh);
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.wood;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) ctx.rect(-bw * 0.48, -bh + i * slatH * 1.3, bw * 0.96, slatH);
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.woodLight;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) ctx.rect(-bw * 0.48, -bh + i * slatH * 1.3, bw * 0.96, slatH * 0.25);
  ctx.rect(-bw / 2, -bh * 1.08, bw * 0.03, bh * 1.08);
  ctx.fill();
}

// ── the fit badge ──────────────────────────────────────────────────────────

/**
 * How well a spot suits a crop, as a pill of four stars centred on the origin.
 * Grade −2..+2 fills 0..4 stars, and the whole badge is tinted from a muted
 * red (a poor spot) through sand (fine) to gold (ideal). `size` is its height.
 * Shown while the player is placing or moving something — information, so it
 * never animates.
 */
export function paintFitBadge(ctx, grade, size) {
  const g = Math.max(-2, Math.min(2, Math.round(Number.isFinite(grade) ? grade : 0)));
  const s = Number.isFinite(size) && size > 0 ? size : 12;
  const filled = g + 2;
  const tint = FIT_TINTS[filled];
  const w = s * 3.3;
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = FARM_PALETTE.chip;
  roundRect(ctx, -w / 2, -s / 2, w, s, s / 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = tint;
  ctx.lineWidth = Math.max(0.8, s * 0.08);
  ctx.stroke();
  const gap = s * 0.7;
  const rr = s * 0.3;
  for (const on of [true, false]) {
    if (on ? filled === 0 : filled === 4) continue;
    ctx.fillStyle = on ? tint : FARM_PALETTE.fitOff;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      if ((i < filled) !== on) continue;
      addStar(ctx, (i - 1.5) * gap, s * 0.02, rr);
    }
    ctx.fill();
  }
  ctx.restore();
}

const FIT_TINTS = [FARM_PALETTE.fitPoor, FARM_PALETTE.fitMeh, FARM_PALETTE.fitOk, FARM_PALETTE.fitGood, FARM_PALETTE.fitIdeal];

// ── the glint ──────────────────────────────────────────────────────────────
// A four-point sparkle over anything ready to pick. Under reduced motion it
// holds at full brightness rather than disappearing: it is information — "this
// one is ready" — and the farm has no other way to say so.
export function paintGlint(ctx, h, tMs, motion) {
  glintAt(ctx, h * 0.3, -h * 0.92, h * PLANT.glintR, tMs, motion);
}

function glintAt(ctx, x, y, size, tMs, motion) {
  const phase = motion ? 0.45 + 0.55 * Math.abs(Math.sin((tMs || 0) / PLANT.glintMs * Math.PI)) : 1;
  const r = size * (0.75 + 0.25 * phase);
  ctx.save();
  ctx.globalAlpha = 0.55 + 0.45 * phase;
  ctx.fillStyle = FARM_PALETTE.glint;
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
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
//
// It blinks, too, off the same machinery the board's fruit blink off — the
// charm that makes the stall work costs one argument here, and a bush of
// strawberries that blinks is the difference between a crop and a cast. The
// synthetic id has to be stable per fruit per plot, or the whole hillside
// blinks in lockstep on one frame and never again.
function fruitAt(ctx, level, x, y, r, tMs, motion, seed, index) {
  const worldR = radiusOf(level);
  const expression = expressionFor({ id: (seed || 0) * 13 + (index || 0) }, tMs || 0, !motion);
  ctx.save();
  ctx.translate(x, y);
  const k = r / worldR;
  ctx.scale(k, k);
  paintFruit(ctx, level, worldR, { expression });
  ctx.restore();
}

// The tree's own blink, on a longer, lazier period than the fruit's — a tree is
// an old thing and should look like it is dozing rather than paying attention.
function isWinking(seed, tMs) {
  const period = PLANT.swayMs * 2 + (seed % 7) * 700;
  return ((tMs || 0) + (seed % 5) * 900) % period < 260;
}

// A soft contact shadow, so nothing floats.
function groundShadow(ctx, rx, ry) {
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = FARM_PALETTE.shadow;
  ctx.beginPath();
  addEllipse(ctx, 0, -ry * 0.2, rx, ry);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function sprig(ctx, x, h, r) {
  ctx.strokeStyle = FARM_PALETTE.stem;
  ctx.lineWidth = Math.max(0.6, r * 0.3);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.quadraticCurveTo(x - r * 0.3, -h * 0.5, x, -h);
  ctx.stroke();
  ctx.fillStyle = FARM_PALETTE.sprout;
  ctx.beginPath();
  addLeaf(ctx, x, -h, r * 1.5, r * 1.1, -0.35);
  addLeaf(ctx, x, -h, r * 1.3, r * 1.0, -Math.PI + 0.4);
  ctx.fill();
  ctx.fillStyle = FARM_PALETTE.leafLight;
  ctx.beginPath();
  addLeaf(ctx, x, -h, r * 1.0, r * 0.45, -0.45);
  ctx.fill();
}

// A tapered limb from (x0,y0) to (x1,y1), bowed outward, added to the path.
function addBough(ctx, x0, y0, x1, y1, w0, w1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const cx = x0 + dx * 0.3;                          // rises first, then reaches out
  const cy = y0 + dy * 0.75;
  ctx.moveTo(x0 + nx * w0, y0 + ny * w0);
  ctx.quadraticCurveTo(cx + nx * (w0 + w1) / 2, cy + ny * (w0 + w1) / 2, x1 + nx * w1, y1 + ny * w1);
  ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
  ctx.quadraticCurveTo(cx - nx * (w0 + w1) / 2, cy - ny * (w0 + w1) / 2, x0 - nx * w0, y0 - ny * w0);
  ctx.closePath();
}

function addCircle(ctx, x, y, r) {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TAU);
}

function addEllipse(ctx, x, y, rx, ry) {
  ctx.moveTo(x + rx, y);
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
}

// An almond leaf from its base along `ang`, `len` long and `wid` across.
function addLeaf(ctx, x, y, len, wid, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const tx = x + c * len;
  const ty = y + s * len;
  const mx = x + c * len * 0.5;
  const my = y + s * len * 0.5;
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(mx - s * wid, my + c * wid, tx, ty);
  ctx.quadraticCurveTo(mx + s * wid, my - c * wid, x, y);
  ctx.closePath();
}

// A five-petalled flower, petals as overlapping discs. `turn` varies the angle.
function addFlower(ctx, x, y, r, turn) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + (turn || 0) * 0.7;
    addCircle(ctx, x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5);
  }
}

function addStar(ctx, x, y, r) {
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * TAU;
    const rr = i % 2 ? r * 0.45 : r;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

// A curl of tendril: a short reach out, then a shrinking spiral at its end.
function addCurl(ctx, x, y, r) {
  ctx.moveTo(x - r * 1.6, y + r * 0.6);
  ctx.quadraticCurveTo(x - r * 0.6, y + r * 0.4, x, y);
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    const a = t * TAU * 1.3;
    const rr = r * 0.6 * (1 - t * 0.75);
    ctx.lineTo(x + Math.sin(a) * rr, y - (1 - Math.cos(a)) * rr);
  }
}

// A unit polygon (pointing along +x from its base) rotated by `ang`, scaled by
// `s`, squashed vertically by `sy`, and added to the path at (x, y).
function addPoly(ctx, pts, x, y, ang, s, sy) {
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  pts.forEach(([px, py], i) => {
    const X = x + (px * c - py * sn) * s;
    const Y = y + (px * sn + py * c) * s * sy;
    if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
  });
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r == null ? Math.min(w, h) * 0.18 : r, w / 2, h / 2));
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

// A small deterministic generator (mulberry32) for the module-load layouts.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v) { return typeof v === 'number' && v > 0 ? (v > 1 ? 1 : v) : 0; }

function clampLevel(level) {
  return Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL ? level : 1;
}

// Handy for callers that want to describe a plot without importing farm.js —
// the shop's seed preview, for instance, which has no plot at all.
export function describeSeed(level) {
  const row = farmOf(clampLevel(level));
  return { kind: row.kind, level: clampLevel(level), progress: 1, mature: true, ripe: true, span: row.span };
}

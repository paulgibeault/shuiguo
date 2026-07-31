// The terraced hillside: plots, what is growing in them, and how far along it
// got while the app was closed.
//
// Pure module — no DOM, no Arcade, no clock of its own. The host injects wall
// time (`wallNow`, absolute ms epochs) because the farm's whole point is that
// it advances between sessions; the board sim's performance.now() clock is
// useless here and js/game.js is never imported from this side of the game.
//
// NO TIMERS RUN ANYWHERE. A plot stores when it was last looked at and how much
// watered time it has banked; growth is evaluated against the clock whenever the
// host looks. That makes offline growth free rather than simulated, and makes
// every rule in this file testable by handing it a number.
//
// Money lives in js/campaign.js. Nothing here charges for anything: `addTerrace`
// and `installSprinkler` do the deed, the host does the paying. Keeping the two
// apart is why a hostile save can corrupt a farm but never mint 元.
//
// What the farm deliberately does NOT have (design §8): soil quality, weather,
// pests, crop failure. Water is a growth GATE, never a health stat — dry soil
// pauses growth and nothing else. Nothing wilts, dies, or rots, and ripe fruit
// waits indefinitely for someone to come pick it.

import {
  TUNING, MAX_LEVEL, MAX_TERRACES,
  farmOf, growthOf, cycleOf, yieldOf, isPerennial, needsTrellis,
} from './constants.js';

const SAVE_VERSION = 1;

// ── shape ──────────────────────────────────────────────────────────────────
//
// A plot's `slot` is the ground itself and never changes: every terrace is cut
// with beds and one deeper bench that can hold a tree. `kind` is what is
// growing there right now, or null for bare earth.

function makePlot(slot) {
  return {
    slot,                  // 'bed' | 'tree' — what this ground can take
    trellis: false,        // tree slots only; a vine needs one built first
    kind: null,            // null | 'bed' | 'tree' | 'vine' — what's in it now
    level: 0,              // the fruit growing here (0 when empty)
    progressMs: 0,         // watered time banked toward the current stage
    lastEvalMs: 0,         // when this plot was last brought up to date
    wateredUntilMs: 0,     // growth accrues only up to this epoch
    mature: false,         // perennials: the first ripening is done
  };
}

function makeTerrace() {
  const plots = [];
  for (let i = 0; i < TUNING.plotsPerTerrace; i++) {
    plots.push(makePlot(i < TUNING.treePlotsPerTerrace ? 'tree' : 'bed'));
  }
  return { plots, sprinkler: false };
}

export function makeFarm() {
  return { terraces: [makeTerrace()], irrigation: false };
}

// The farm the first appraisal buys: one terrace with a young cherry tree
// already in its bench, dry. The tree is the guaranteed-generosity engine (a fat
// crate every few minutes, forever) and it is deliberately handed over THIRSTY —
// watering is the farm's one ritual, and the opening teaches it by making the
// player's first tap the thing that starts their first crop.
export function makeStarterFarm(wallNow) {
  const farm = makeFarm();
  plant(farm, 0, 0, TUNING.starterTree, wallNow);
  return farm;
}

// ── growth ─────────────────────────────────────────────────────────────────

// How long the CURRENT stage takes. A perennial's first ripening is its whole
// growthMs (planting to first crop, one time); after that it re-fruits on the
// shorter cycleMs, forever.
export function stageMsOf(plot) {
  if (!plot.kind) return 0;
  if (!isPerennial(plot.level)) return growthOf(plot.level);
  return plot.mature ? cycleOf(plot.level) : growthOf(plot.level);
}

export function isRipe(plot) {
  return !!plot.kind && plot.progressMs >= stageMsOf(plot);
}

// Is this ground watered no matter what? A sprinkler covers its terrace and
// stream irrigation covers the mountain — both are permanent, which is exactly
// what the player is buying.
function alwaysWatered(farm, terrace) {
  return !!(farm.irrigation || terrace.sprinkler);
}

// Bring one plot up to date. Growth accrues only over the part of the elapsed
// window that was actually watered, and stops dead at ripe — a tree holds its
// fruit rather than banking a second crop behind the first, so a week away
// leaves everything ripe and nothing hoarded.
//
// Clock-skew posture (single-player, generosity-first): a backward jump earns
// nothing and cannot rewind the plot's own bookkeeping, while a forward jump is
// simply free growth. We don't fight the second one — there is nobody to cheat.
export function evaluatePlot(plot, wallNow, watered) {
  if (!Number.isFinite(wallNow)) return plot;
  if (plot.kind) {
    const until = watered ? wallNow : Math.min(wallNow, plot.wateredUntilMs);
    const gain = Math.max(0, until - plot.lastEvalMs);
    plot.progressMs = Math.min(plot.progressMs + gain, stageMsOf(plot));
  }
  plot.lastEvalMs = Math.max(plot.lastEvalMs, wallNow);
  return plot;
}

// Evaluate-on-look: the host calls this before it reads or draws anything.
export function evaluateFarm(farm, wallNow) {
  for (const terrace of farm.terraces) {
    const watered = alwaysWatered(farm, terrace);
    for (const plot of terrace.plots) evaluatePlot(plot, wallNow, watered);
  }
  return farm;
}

// How much of the current stage is done, 0..1 — the painter's growth stage and
// the only number the UI needs to draw a sprout instead of a bush.
export function progressOf(plot) {
  const stage = stageMsOf(plot);
  if (!plot.kind || stage <= 0) return 0;
  return Math.min(1, plot.progressMs / stage);
}

// Wall-clock ms until this plot is ripe: 0 if it already is, null if it never
// will be on its own (bare earth, or planted and dry with no sprinkler — dry
// soil doesn't count down, which is the whole point of watering).
export function msUntilRipe(plot, wallNow, watered) {
  if (!plot.kind) return null;
  const left = stageMsOf(plot) - plot.progressMs;
  if (left <= 0) return 0;
  if (watered) return left;
  const wateredLeft = plot.wateredUntilMs - wallNow;
  return wateredLeft >= left ? left : null;
}

// ── the one tap per plot ───────────────────────────────────────────────────
// Every farm interaction is a single tap, so each of these is a guarded verb
// that reports whether it did anything. `canPlant` is the exception: the shop
// needs the REASON to grey a row and say why.

export function plotAt(farm, ti, pi) {
  const terrace = farm.terraces[ti];
  if (!terrace) return null;
  return terrace.plots[pi] || null;
}

// null when the seed can go in, otherwise a short reason the UI can show.
export function canPlant(farm, ti, pi, level) {
  const plot = plotAt(farm, ti, pi);
  if (!plot) return 'no such plot';
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return 'no such seed';
  if (plot.kind) return 'already planted';
  const kind = farmOf(level).kind;
  if (kind === 'bed' && plot.slot !== 'bed') return 'that bench is for trees';
  if (kind !== 'bed' && plot.slot !== 'tree') return 'that bed is too shallow';
  if (needsTrellis(level) && !plot.trellis) return 'needs a trellis';
  return null;
}

export function plant(farm, ti, pi, level, wallNow) {
  if (canPlant(farm, ti, pi, level)) return false;
  const plot = plotAt(farm, ti, pi);
  plot.kind = farmOf(level).kind;
  plot.level = level;
  plot.progressMs = 0;
  plot.mature = false;
  plot.lastEvalMs = wallNow;
  plot.wateredUntilMs = 0;      // planted thirsty: watering it is the next tap
  return true;
}

// The ritual. Watering opens a window that growth accrues inside; it is never a
// health bar, and watering early simply moves the window rather than stacking.
export function water(farm, ti, pi, wallNow) {
  const plot = plotAt(farm, ti, pi);
  if (!plot || !plot.kind) return false;
  const terrace = farm.terraces[ti];
  if (alwaysWatered(farm, terrace)) return false;   // the sprinkler has it
  if (isRipe(plot)) return false;                   // nothing left to grow
  evaluatePlot(plot, wallNow, false);
  plot.wateredUntilMs = wallNow + TUNING.waterMs;
  return true;
}

// Does this plot want water right now? What the glint keys off.
export function needsWater(farm, ti, pi, wallNow) {
  const plot = plotAt(farm, ti, pi);
  if (!plot || !plot.kind || isRipe(plot)) return false;
  if (alwaysWatered(farm, farm.terraces[ti])) return false;
  return plot.wateredUntilMs <= wallNow;
}

// Harvest → { level, count } for the crate, or null if there was nothing to
// take. An annual dies at its harvest and leaves bare earth; a perennial is
// marked mature and starts its next cycle from this moment.
export function harvest(farm, ti, pi, wallNow) {
  const plot = plotAt(farm, ti, pi);
  if (!plot || !isRipe(plot)) return null;
  const level = plot.level;
  const count = yieldOf(level);
  if (isPerennial(level)) {
    plot.mature = true;
    plot.progressMs = 0;
    plot.lastEvalMs = wallNow;
  } else {
    const { slot, trellis } = plot;
    Object.assign(plot, makePlot(slot), { trellis, lastEvalMs: wallNow });
  }
  return { level, count };
}

// Halve what is LEFT of the current stage. Stackable by construction — two
// doses halve twice — and useless on bare earth or on fruit already ripe.
export function fertilize(farm, ti, pi, wallNow) {
  const plot = plotAt(farm, ti, pi);
  if (!plot || !plot.kind) return false;
  const terrace = farm.terraces[ti];
  evaluatePlot(plot, wallNow, alwaysWatered(farm, terrace));
  if (isRipe(plot)) return false;
  plot.progressMs = (plot.progressMs + stageMsOf(plot)) / 2;
  return true;
}

export function buildTrellis(farm, ti, pi) {
  const plot = plotAt(farm, ti, pi);
  if (!plot || plot.slot !== 'tree' || plot.trellis) return false;
  plot.trellis = true;
  return true;
}

// ── the mountainside ───────────────────────────────────────────────────────
// None of these charge; the host checks js/economy.js and debits campaign cash.

export function nextTerraceIndex(farm) {
  return farm.terraces.length < MAX_TERRACES ? farm.terraces.length : null;
}

export function addTerrace(farm, wallNow) {
  if (nextTerraceIndex(farm) == null) return false;
  const terrace = makeTerrace();
  for (const plot of terrace.plots) plot.lastEvalMs = wallNow;
  farm.terraces.push(terrace);
  return true;
}

export function installSprinkler(farm, ti, wallNow) {
  const terrace = farm.terraces[ti];
  if (!terrace || terrace.sprinkler || farm.irrigation) return false;
  // Bring the plots up to date under the OLD rules first, or the dry stretch
  // before the sprinkler arrived would be retroactively watered.
  for (const plot of terrace.plots) evaluatePlot(plot, wallNow, false);
  terrace.sprinkler = true;
  return true;
}

export function installIrrigation(farm, wallNow) {
  if (farm.irrigation) return false;
  evaluateFarm(farm, wallNow);
  farm.irrigation = true;
  return true;
}

// ── what the host asks the farm ────────────────────────────────────────────

// Every plot, flattened with its address — what the farm screen draws and what
// "is anything ready?" is counted over.
export function eachPlot(farm) {
  const out = [];
  farm.terraces.forEach((terrace, ti) => {
    terrace.plots.forEach((plot, pi) => {
      out.push({ ti, pi, plot, terrace, watered: alwaysWatered(farm, terrace) });
    });
  });
  return out;
}

export function ripeCount(farm) {
  return eachPlot(farm).filter(({ plot }) => isRipe(plot)).length;
}

// When the next thing ripens, in ms from now — null if nothing is on its way.
// The returning-session promise ("always open to something ready") is checked
// against this.
export function msUntilNextRipe(farm, wallNow) {
  let soonest = null;
  for (const { plot, watered } of eachPlot(farm)) {
    const ms = msUntilRipe(plot, wallNow, watered);
    if (ms == null) continue;
    if (soonest == null || ms < soonest) soonest = ms;
  }
  return soonest;
}

// ── save / restore ─────────────────────────────────────────────────────────
// Same discipline as js/game.js: a version field, field-by-field validation,
// and hostile-save posture — an out-of-range value is DISCARDED, not clamped.
// A save we don't believe becomes bare earth, never a plot growing something
// impossible at a speed the table never allowed.

export function serialize(farm) {
  return {
    v: SAVE_VERSION,
    irrigation: !!farm.irrigation,
    terraces: farm.terraces.map((t) => ({
      sprinkler: !!t.sprinkler,
      plots: t.plots.map((p) => ({
        slot: p.slot,
        trellis: !!p.trellis,
        kind: p.kind,
        level: p.level,
        progressMs: Math.round(p.progressMs),
        lastEvalMs: Math.round(p.lastEvalMs),
        wateredUntilMs: Math.round(p.wateredUntilMs),
        mature: !!p.mature,
      })),
    })),
  };
}

function isEpoch(v) { return typeof v === 'number' && isFinite(v) && v >= 0; }

// One plot out of a save. Anything it cannot vouch for comes back as the bare
// ground it was cut from, which is always a legal plot.
function restorePlot(raw) {
  const slot = raw && (raw.slot === 'tree' || raw.slot === 'bed') ? raw.slot : 'bed';
  const plot = makePlot(slot);
  if (!raw || typeof raw !== 'object') return plot;
  plot.trellis = slot === 'tree' && raw.trellis === true;
  // Read the clock BEFORE the plant, so a plot whose crop we reject still comes
  // back with its own bookkeeping intact — serialize∘restore is a fixpoint, and
  // save diffs stay meaningful.
  plot.lastEvalMs = isEpoch(raw.lastEvalMs) ? raw.lastEvalMs : 0;

  const level = raw.level;
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return plot;
  // The kind is the TABLE's, not the save's — a save claiming a watermelon tree
  // is describing a plant that has never existed, so it plants nothing.
  if (raw.kind !== farmOf(level).kind) return plot;
  if (canPlantKindOn(plot, level)) return plot;

  plot.kind = raw.kind;
  plot.level = level;
  plot.mature = raw.mature === true;
  plot.wateredUntilMs = isEpoch(raw.wateredUntilMs) ? raw.wateredUntilMs : 0;
  // Progress past the stage is just ripe, so it is capped rather than dropped —
  // but a negative or nonsense value is a plot we don't believe, back to zero.
  const p = raw.progressMs;
  plot.progressMs = isEpoch(p) ? Math.min(p, stageMsOf(plot)) : 0;
  return plot;
}

// The planting rules as they apply to a plot in isolation (restore has no farm
// to hand to canPlant yet). Returns a reason, or null when the plant belongs.
function canPlantKindOn(plot, level) {
  const kind = farmOf(level).kind;
  if (kind === 'bed' && plot.slot !== 'bed') return 'wrong ground';
  if (kind !== 'bed' && plot.slot !== 'tree') return 'wrong ground';
  if (needsTrellis(level) && !plot.trellis) return 'no trellis';
  return null;
}

export function restore(save) {
  if (!save || save.v !== SAVE_VERSION || !Array.isArray(save.terraces)) return null;
  if (save.terraces.length < 1 || save.terraces.length > MAX_TERRACES) return null;

  const farm = { terraces: [], irrigation: save.irrigation === true };
  for (const rawTerrace of save.terraces) {
    const terrace = makeTerrace();
    if (rawTerrace && typeof rawTerrace === 'object') {
      terrace.sprinkler = rawTerrace.sprinkler === true;
      const rawPlots = Array.isArray(rawTerrace.plots) ? rawTerrace.plots : [];
      // The terrace's SHAPE is the table's — a save can say what is growing in
      // each plot, never how many plots a terrace has or which are benches.
      terrace.plots = terrace.plots.map((fresh, i) => {
        const restored = restorePlot(rawPlots[i]);
        return restored.slot === fresh.slot ? restored : fresh;
      });
    }
    farm.terraces.push(terrace);
  }
  return farm;
}

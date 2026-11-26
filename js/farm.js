// The terraced hillside: what stands where, how far along it got while the app
// was closed, and every verb that changes it.
//
// Pure module — no DOM, no Arcade, no clock of its own. The host injects wall
// time (`wallNow`, absolute ms epochs) because the farm's whole point is that
// it advances between sessions; the board sim's performance.now() clock is
// useless here and js/game.js is never imported from this side of the game.
//
// NO TIMERS RUN ANYWHERE. A plot stores when it was last looked at and how much
// growth it has banked; growth is evaluated against the clock whenever the host
// looks. That makes offline growth free rather than simulated, and makes every
// rule in this file testable by handing it a number.
//
// THE GROUND IS FREE-FORM. A terrace is a row of TUNING.tilesPerTerrace tiles
// and anything can stand on any of them: a bed on one tile, a tree across two,
// a pond, a beehive. Nothing is fixed — every plant can be moved with its
// growth intact, or dug up back into the drawer, and the whole mountain can be
// cleared and laid out again. Where things stand matters (js/terrain.js), which
// is the reason to want to.
//
// Money lives in js/campaign.js. Nothing here charges for anything: verbs do
// the deed, the host does the paying, and digging up hands back WHAT was dug
// rather than its price. Keeping the two apart is why a hostile save can
// corrupt a farm but never mint 元.
//
// What the farm deliberately does NOT have: pests, crop failure, rot, wilting.
// Water is a growth GATE, never a health stat — dry soil pauses growth and
// nothing else — and ripe fruit waits indefinitely for someone to come pick it.

import {
  TUNING, MAX_LEVEL, MAX_TERRACES,
  farmOf, growthOf, cycleOf, isPerennial, spanOf, isStructure,
} from './constants.js';
import { fitOf } from './terrain.js';

const SAVE_VERSION = 2;
const COLS = TUNING.tilesPerTerrace;

// ── shape ──────────────────────────────────────────────────────────────────
//
// A plot is a thing standing on the terrace: `col` is its leftmost tile and
// `span` how many it covers. Plants carry a level and their growth; structures
// (pond, beehive, compost) carry only where they are.

function makePlantPlot(col, level, wallNow) {
  return {
    col,
    span: spanOf(level),
    kind: farmOf(level).kind,     // 'bed' | 'tree' | 'vine'
    level,
    progressMs: 0,                // growth banked toward the current stage, in TABLE ms
    lastEvalMs: wallNow,          // when this plot was last brought up to date
    wateredUntilMs: 0,            // growth accrues only up to this epoch
    mature: false,                // perennials: the first ripening is done
  };
}

function makeStructurePlot(col, kind) {
  return { col, span: 1, kind, level: 0, progressMs: 0, lastEvalMs: 0, wateredUntilMs: 0, mature: false };
}

function makeTerrace() {
  return { plots: [], sprinkler: false };
}

export function makeFarm() {
  return { terraces: [makeTerrace()], irrigation: false };
}

export function isPlant(plot) { return !!plot && !!plot.level && !isStructure(plot.kind); }

// The farm the first appraisal buys: one terrace with a young cherry tree
// standing in the middle of it, dry, and one bed by the stream already half
// grown and watered.
//
// The tree is the guaranteed-generosity engine (a fat crate every few minutes,
// forever) and it is deliberately handed over THIRSTY — watering is the farm's
// one ritual, and the opening teaches it by making the player's first tap the
// thing that starts their first crop. It stands mid-shelf, not by the water,
// because the first thing the mountain should say is that a tree can go
// anywhere.
//
// The bed is the answer to what happens next: a crop already halfway up pays
// off while the feeling of planting is still warm.
export function makeStarterFarm(wallNow) {
  const farm = makeFarm();
  plant(farm, 0, TUNING.starterTreeCol, TUNING.starterTree, wallNow);
  const tree = plotAt(farm, 0, TUNING.starterTreeCol);
  tree.progressMs = stageMsOf(tree) * TUNING.starterTreeProgress;
  const col = TUNING.starterCropCol;
  plant(farm, 0, col, TUNING.starterCrop, wallNow);
  const plot = plotAt(farm, 0, col);
  plot.progressMs = stageMsOf(plot) * TUNING.starterCropProgress;
  water(farm, 0, col, wallNow);                  // and it sees the rest through
  return farm;
}

// ── growth ─────────────────────────────────────────────────────────────────

// How long the CURRENT stage takes, in table ms — before the ground's speed is
// applied. A perennial's first ripening is its whole growthMs; after that it
// re-fruits on cycleMs, forever.
export function stageMsOf(plot) {
  if (!isPlant(plot)) return 0;
  if (!isPerennial(plot.level)) return growthOf(plot.level);
  return plot.mature ? cycleOf(plot.level) : growthOf(plot.level);
}

export function isRipe(plot) {
  return isPlant(plot) && plot.progressMs >= stageMsOf(plot);
}

// Is this ground watered no matter what? A sprinkler covers its terrace and
// stream irrigation covers the mountain — both are permanent.
function alwaysWatered(farm, terrace) {
  return !!(farm.irrigation || terrace.sprinkler);
}

// How fast this plot grows where it stands: the terrain's multiplier.
export function speedOf(farm, ti, plot) {
  if (!isPlant(plot)) return 0;
  return fitOf(farm, ti, plot.col, plot.level, plot).speed;
}

// Bring one plot up to date at `speed`. Growth accrues only over the part of
// the elapsed window that was actually watered, and stops dead at ripe — a tree
// holds its fruit rather than banking a second crop behind the first, so a
// week away leaves everything ripe and nothing hoarded.
//
// Clock-skew posture (single-player, generosity-first): a backward jump earns
// nothing and cannot rewind the plot's own bookkeeping, while a forward jump is
// simply free growth.
export function evaluatePlot(plot, wallNow, watered, speed = 1) {
  if (!Number.isFinite(wallNow)) return plot;
  if (isPlant(plot)) {
    const until = watered ? wallNow : Math.min(wallNow, plot.wateredUntilMs);
    const gain = Math.max(0, until - plot.lastEvalMs) * speed;
    plot.progressMs = Math.min(plot.progressMs + gain, stageMsOf(plot));
  }
  plot.lastEvalMs = Math.max(plot.lastEvalMs, wallNow);
  return plot;
}

// Evaluate-on-look: the host calls this before it reads or draws anything, and
// every verb below that changes the layout calls it first — speeds depend on
// neighbours, so growth up to NOW has to be banked at the old speeds before
// anything moves.
export function evaluateFarm(farm, wallNow) {
  farm.terraces.forEach((terrace, ti) => {
    const watered = alwaysWatered(farm, terrace);
    const speeds = terrace.plots.map((p) => speedOf(farm, ti, p));
    terrace.plots.forEach((p, i) => evaluatePlot(p, wallNow, watered, speeds[i]));
  });
  return farm;
}

// How much of the current stage is done, 0..1 — the painter's growth stage.
export function progressOf(plot) {
  const stage = stageMsOf(plot);
  if (!isPlant(plot) || stage <= 0) return 0;
  return Math.min(1, plot.progressMs / stage);
}

// Wall-clock ms until this plot is ripe: 0 if it already is, null if it never
// will be on its own (bare earth, a structure, or planted and dry with no
// sprinkler — dry soil doesn't count down, which is the whole point of
// watering).
export function msUntilRipe(plot, wallNow, watered, speed = 1) {
  if (!isPlant(plot)) return null;
  const left = stageMsOf(plot) - plot.progressMs;
  if (left <= 0) return 0;
  if (!(speed > 0)) return null;
  const wall = left / speed;
  if (watered) return wall;
  const wateredLeft = plot.wateredUntilMs - wallNow;
  return wateredLeft >= wall ? wall : null;
}

// The same question by address, so a host never has to know about sprinklers
// or terrain — those are rules, and rules live here.
export function msUntilRipeAt(farm, ti, col, wallNow) {
  const plot = plotAt(farm, ti, col);
  const terrace = farm.terraces[ti];
  if (!plot || !terrace) return null;
  return msUntilRipe(plot, wallNow, alwaysWatered(farm, terrace), speedOf(farm, ti, plot));
}

// ── where things are ───────────────────────────────────────────────────────

// Whatever stands on tile `col` of terrace `ti` — the plot covering it, whether
// or not this is its leftmost tile — or null for bare ground.
export function plotAt(farm, ti, col) {
  const terrace = farm && farm.terraces[ti];
  if (!terrace) return null;
  for (const p of terrace.plots) if (col >= p.col && col < p.col + p.span) return p;
  return null;
}

function spanOfThing(what) {
  if (isStructure(what)) return 1;
  if (Number.isInteger(what) && what >= 1 && what <= MAX_LEVEL) return spanOf(what);
  return 0;
}

// Are tiles [col, col+span) all on the terrace and bare (or held by `ignore`)?
function isClear(terrace, col, span, ignore) {
  if (!Number.isInteger(col) || col < 0 || col + span > COLS) return false;
  for (const p of terrace.plots) {
    if (p === ignore) continue;
    if (p.col < col + span && col < p.col + p.span) return false;
  }
  return true;
}

// Where something `what` (a fruit level or a structure kind) would stand if the
// player tapped tile `col`: that tile if it fits there, otherwise the nearest
// leftward start that still covers the tapped tile. null if it fits nowhere
// that covers it. A tap is a request to put a thing HERE, and a two-tile tree
// tapped onto the last tile of a shelf grows leftward rather than refusing.
export function anchorFor(farm, ti, col, what, ignore = null) {
  const terrace = farm && farm.terraces[ti];
  const span = spanOfThing(what);
  if (!terrace || !span) return null;
  for (let start = col; start > col - span; start--) {
    if (isClear(terrace, start, span, ignore)) return start;
  }
  return null;
}

// null when `what` can go in at exactly `col`, otherwise a short reason the
// UI can show.
export function canPlace(farm, ti, col, what) {
  const terrace = farm && farm.terraces[ti];
  if (!terrace) return 'no such terrace';
  const span = spanOfThing(what);
  if (!span) return 'no such seed';
  if (!Number.isInteger(col) || col < 0 || col >= COLS) return 'no such tile';
  if (col + span > COLS) return 'not enough room';
  if (!isClear(terrace, col, span)) return 'not enough room';
  return null;
}

// Kept under its old name: plants are the common case.
export const canPlant = canPlace;

function insert(terrace, plot) {
  terrace.plots.push(plot);
  terrace.plots.sort((a, b) => a.col - b.col);
}

// ── the verbs ──────────────────────────────────────────────────────────────

export function plant(farm, ti, col, level, wallNow) {
  if (canPlace(farm, ti, col, level) || isStructure(level)) return false;
  evaluateFarm(farm, wallNow);
  insert(farm.terraces[ti], makePlantPlot(col, level, wallNow));   // planted thirsty
  return true;
}

export function placeStructure(farm, ti, col, kind, wallNow) {
  if (!isStructure(kind) || canPlace(farm, ti, col, kind)) return false;
  evaluateFarm(farm, wallNow);
  const plot = makeStructurePlot(col, kind);
  plot.lastEvalMs = wallNow;
  insert(farm.terraces[ti], plot);
  return true;
}

// The ritual.
//
// One watering always sees the CURRENT STAGE through — `TUNING.waterMs` is the
// floor, not the ceiling. A watermelon needs ten hours and a pineapple a day,
// and a fixed can would mean coming back to top them up or losing the wait.
// That is a retention mechanic with a watering can on it, and this game does
// not have those. Tap it once and the thing you planted will be there when you
// get back, however long you are gone.
//
// Watering early never shortens an existing window; it can only extend it.
export function water(farm, ti, col, wallNow) {
  const plot = plotAt(farm, ti, col);
  if (!isPlant(plot)) return false;
  const terrace = farm.terraces[ti];
  if (alwaysWatered(farm, terrace)) return false;   // the sprinkler has it
  if (isRipe(plot)) return false;                   // nothing left to grow
  evaluateFarm(farm, wallNow);
  const speed = speedOf(farm, ti, plot) || 1;
  const remaining = (stageMsOf(plot) - plot.progressMs) / speed;
  plot.wateredUntilMs = Math.max(plot.wateredUntilMs, wallNow + Math.max(TUNING.waterMs, Math.ceil(remaining)));
  return true;
}

// Does this plot want water right now? What the glint keys off.
export function needsWater(farm, ti, col, wallNow) {
  const plot = plotAt(farm, ti, col);
  if (!isPlant(plot) || isRipe(plot)) return false;
  if (alwaysWatered(farm, farm.terraces[ti])) return false;
  return plot.wateredUntilMs <= wallNow;
}

// Harvest → { level, count } for the crate, or null if there was nothing to
// take. The count is what the plot bears WHERE IT STANDS — an ideal spot or a
// beehive next door adds to it (js/terrain.js). An annual is gone at its
// harvest and leaves bare earth; a perennial is marked mature and starts its
// next cycle from this moment.
export function harvest(farm, ti, col, wallNow) {
  const plot = plotAt(farm, ti, col);
  if (!plot || !isRipe(plot)) return null;
  const level = plot.level;
  const count = fitOf(farm, ti, plot.col, level, plot).yield;
  evaluateFarm(farm, wallNow);
  if (isPerennial(level)) {
    plot.mature = true;
    plot.progressMs = 0;
    plot.lastEvalMs = wallNow;
  } else {
    removePlot(farm.terraces[ti], plot);
  }
  return { level, count };
}

// Halve what is LEFT of the current stage. Stackable by construction — two
// doses halve twice — and useless on bare earth or on fruit already ripe.
export function fertilize(farm, ti, col, wallNow) {
  const plot = plotAt(farm, ti, col);
  if (!isPlant(plot)) return false;
  evaluateFarm(farm, wallNow);
  if (isRipe(plot)) return false;
  plot.progressMs = (plot.progressMs + stageMsOf(plot)) / 2;
  return true;
}

function removePlot(terrace, plot) {
  const i = terrace.plots.indexOf(plot);
  if (i >= 0) terrace.plots.splice(i, 1);
}

// Dig up whatever stands on this tile and hand it back. Nothing is lost:
//
//   a plant → its seed or sapling goes back in the drawer, and if it was
//             carrying ripe fruit that is picked first (`harvested`)
//   a structure → it goes back in the drawer as it was
//
// Returns { kind, level, harvested } — `level` for a plant, `kind` always —
// or null if the tile was bare. The CALLER puts things back in the drawer;
// the farm has no drawer.
//
// A dug-up tree is a sapling again. Moving it (below) is how to keep a grown
// tree; digging it up is starting over, which is what makes the two different
// verbs rather than one.
export function dig(farm, ti, col, wallNow) {
  const plot = plotAt(farm, ti, col);
  if (!plot) return null;
  evaluateFarm(farm, wallNow);
  const harvested = isRipe(plot) ? harvest(farm, ti, col, wallNow) : null;
  removePlot(farm.terraces[ti], plot);
  return { kind: plot.kind, level: plot.level || 0, harvested };
}

// Move whatever stands on (ti, col) so that it stands at (toTi, toCol) — the
// destination col is a REQUEST, resolved the same way a planting tap is (see
// anchorFor). Everything it was carrying comes along: a grown tree stays
// grown, a crop keeps its progress and its watering. Returns the anchor it
// landed on, or null if it would not fit there.
//
// The whole farm is brought up to date first, at the old layout's speeds:
// moving a plant changes its neighbours' bonuses as well as its own, and none
// of that may apply retroactively.
export function move(farm, ti, col, toTi, toCol, wallNow) {
  const plot = plotAt(farm, ti, col);
  const from = farm.terraces[ti];
  const to = farm.terraces[toTi];
  if (!plot || !to) return null;
  const what = isStructure(plot.kind) ? plot.kind : plot.level;
  const anchor = anchorFor(farm, toTi, toCol, what, toTi === ti ? plot : null);
  if (anchor == null) return null;
  if (toTi === ti && anchor === plot.col) return null;           // nowhere new
  evaluateFarm(farm, wallNow);
  removePlot(from, plot);
  plot.col = anchor;
  insert(to, plot);
  return anchor;
}

// ── the mountainside ───────────────────────────────────────────────────────
// None of these charge; the host checks js/economy.js and debits campaign cash.

export function nextTerraceIndex(farm) {
  return farm.terraces.length < MAX_TERRACES ? farm.terraces.length : null;
}

export function addTerrace(farm, wallNow) {
  if (nextTerraceIndex(farm) == null) return false;
  evaluateFarm(farm, wallNow);
  farm.terraces.push(makeTerrace());
  return true;
}

export function installSprinkler(farm, ti, wallNow) {
  const terrace = farm.terraces[ti];
  if (!terrace || terrace.sprinkler || farm.irrigation) return false;
  // Bring the plots up to date under the OLD rules first, or the dry stretch
  // before the sprinkler arrived would be retroactively watered.
  evaluateFarm(farm, wallNow);
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
// "is anything ready?" is counted over. `col` is the plot's leftmost tile.
export function eachPlot(farm) {
  const out = [];
  farm.terraces.forEach((terrace, ti) => {
    for (const plot of terrace.plots) {
      out.push({ ti, col: plot.col, plot, terrace, watered: alwaysWatered(farm, terrace) });
    }
  });
  return out;
}

export function ripeCount(farm) {
  return eachPlot(farm).filter(({ plot }) => isRipe(plot)).length;
}

// Bare tiles on the farm — what the 种 hint and "room to grow" are about.
export function bareTiles(farm) {
  const out = [];
  farm.terraces.forEach((terrace, ti) => {
    for (let col = 0; col < COLS; col++) if (!plotAt(farm, ti, col)) out.push({ ti, col });
  });
  return out;
}

// WHICH plot is next to ripen, and when — { ti, col, ms } — or null if nothing
// on the mountain is on its way anywhere. Already-ripe plots are not "next":
// the glint on a ripe plot is the loudest thing on the screen without help.
// Ties go to the first plot in eachPlot order, so a countdown drawn from it
// does not hop between two plots that happen to finish together.
export function soonestRipening(farm, wallNow) {
  let soonest = null;
  for (const { ti, col, plot, watered } of eachPlot(farm)) {
    const ms = msUntilRipe(plot, wallNow, watered, speedOf(farm, ti, plot));
    if (ms == null || ms <= 0) continue;
    if (soonest == null || ms < soonest.ms) soonest = { ti, col, ms };
  }
  return soonest;
}

// When the next thing ripens, in ms from now — 0 if something already has, null
// if nothing is on its way.
export function msUntilNextRipe(farm, wallNow) {
  let soonest = null;
  for (const { ti, plot, watered } of eachPlot(farm)) {
    const ms = msUntilRipe(plot, wallNow, watered, speedOf(farm, ti, plot));
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
      plots: t.plots.map((p) => (isStructure(p.kind)
        ? { col: p.col, kind: p.kind }
        : {
          col: p.col,
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

// One plot out of a save, or null if we don't believe it. Placement is checked
// against what has already been restored on the same terrace, so two saved
// plots claiming the same tile keep the first and lose the second.
function restorePlot(raw, terrace) {
  if (!raw || typeof raw !== 'object') return null;
  const col = raw.col;
  if (!Number.isInteger(col) || col < 0 || col >= COLS) return null;

  if (isStructure(raw.kind)) {
    if (!isClear(terrace, col, 1)) return null;
    return makeStructurePlot(col, raw.kind);
  }

  const level = raw.level;
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return null;
  // The kind is the TABLE's, not the save's — a save claiming a watermelon tree
  // is describing a plant that has never existed.
  if (raw.kind !== farmOf(level).kind) return null;
  if (!isClear(terrace, col, spanOf(level))) return null;

  const plot = makePlantPlot(col, level, isEpoch(raw.lastEvalMs) ? raw.lastEvalMs : 0);
  plot.mature = raw.mature === true && isPerennial(level);
  plot.wateredUntilMs = isEpoch(raw.wateredUntilMs) ? raw.wateredUntilMs : 0;
  // Progress past the stage is just ripe, so it is capped rather than dropped —
  // but a negative or nonsense value is a plot we don't believe, back to zero.
  const p = raw.progressMs;
  plot.progressMs = isEpoch(p) ? Math.min(p, stageMsOf(plot)) : 0;
  return plot;
}

// A version-1 farm: four fixed plots a terrace, the first of them a tree bench.
// Its plants are re-laid on the new six-tile shelf in the same left-to-right
// order — the bench's tree across the first two tiles, the three beds after it
// — so a returning player finds their farm where they left it, with growth,
// watering and maturity intact. Trellises are part of the vine now and need
// no carrying across.
function upgradeV1(save) {
  return {
    v: SAVE_VERSION,
    irrigation: save.irrigation,
    terraces: (Array.isArray(save.terraces) ? save.terraces : []).map((t) => {
      if (!t || typeof t !== 'object') return t;
      const plots = [];
      let col = 0;
      for (const raw of Array.isArray(t.plots) ? t.plots : []) {
        const slotSpan = raw && raw.slot === 'tree' ? 2 : 1;
        if (raw && typeof raw === 'object' && Number.isInteger(raw.level) && raw.level >= 1) {
          plots.push({ ...raw, col });
        }
        col += slotSpan;
      }
      return { sprinkler: t.sprinkler, plots };
    }),
  };
}

export function restore(save) {
  if (save && save.v === 1) save = upgradeV1(save);
  if (!save || save.v !== SAVE_VERSION || !Array.isArray(save.terraces)) return null;
  if (save.terraces.length < 1 || save.terraces.length > MAX_TERRACES) return null;

  const farm = { terraces: [], irrigation: save.irrigation === true };
  for (const rawTerrace of save.terraces) {
    const terrace = makeTerrace();
    if (rawTerrace && typeof rawTerrace === 'object') {
      terrace.sprinkler = rawTerrace.sprinkler === true;
      for (const raw of Array.isArray(rawTerrace.plots) ? rawTerrace.plots : []) {
        const plot = restorePlot(raw, terrace);
        if (plot) insert(terrace, plot);
      }
    }
    farm.terraces.push(terrace);
  }
  return farm;
}

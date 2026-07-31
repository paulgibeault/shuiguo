// shuǐguǒ boot + Arcade SDK wiring.
//
// Boot contract (GAME_INTEGRATION.md §2): everything that reads state waits
// on Arcade.ready. The render loop is Arcade.loop (fleet standard), timers
// honor suspend, saves flush synchronously in onSuspend.

import { FRUITS, PHYS, radiusOf } from './constants.js';
import { makeGame, start, tick, serialize, restore } from './game.js';
import { makeRenderer } from './render.js';
import { bindInput } from './input.js';
import { makeEffects, pushEvent, pruneEffects, resetEffects } from './effects.js';
import { paintFruit } from './fruit-art.js';
import { sfx } from './sfx.js';
import { makeRng } from './arcade-rng.js';

const $ = (id) => document.getElementById(id);

const SAVE_KEY = 'save';
const now = () => performance.now();

// Spawn sequence rng. Seeded per game from entropy; state rides the save so a
// restored game continues the same sequence.
const rng = makeRng((Math.random() * 0xffffffff) >>> 0);

const g = makeGame({ rng, now });
let best = 0;
let saveDirty = false;

const canvas = $('board');
const R = makeRenderer(canvas);
// Visual-only, host-owned, never saved — see js/effects.js.
const fx = makeEffects();

// ── settings snapshot (theme/fontScale/reducedMotion re-render live) ───────
let settings = { theme: 'light', fontScale: 1, reducedMotion: false };
function pullSettings() {
  settings = {
    theme: Arcade.settings.theme(),
    fontScale: Arcade.settings.fontScale(),
    reducedMotion: Arcade.settings.reducedMotion(),
  };
}

// ── HUD ────────────────────────────────────────────────────────────────────
const nextCanvas = $('next');

function refreshHud() {
  $('score').textContent = String(g.score);
  $('best').textContent = String(Math.max(best, g.score));
  const f = FRUITS[g.next - 1];
  $('next-label').textContent = `${f.hanzi} ${f.name}`;
  drawNext();
}

function drawNext() {
  paintChip(nextCanvas, g.next, 0.34);
}

// Draw one fruit, alone and centred, filling a small square canvas. Used by
// the NEXT preview and by every chip in the menu's evolution chart — the SAME
// painter the board uses, so a fruit is recognisably itself everywhere.
//
// `share` is the fruit's radius as a fraction of the canvas: it must leave
// room for the accessories, which reach past r (see ART.maxExtent).
function paintChip(el, level, share) {
  const cctx = el.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = el.clientWidth || 44;
  const px = Math.round(size * dpr);
  if (el.width !== px) { el.width = px; el.height = px; }
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cctx.clearRect(0, 0, size, size);
  cctx.save();
  // Accessories grow upward, so drop the centre a little to keep a pineapple
  // crown or a cherry stem inside the box.
  cctx.translate(size / 2, size * 0.56);
  const worldR = radiusOf(level);
  const k = (size * share) / worldR;
  cctx.scale(k, k);
  paintFruit(cctx, level, worldR);
  cctx.restore();
}

// ── screens ────────────────────────────────────────────────────────────────
function show(screen) {
  $('menu').hidden = screen !== 'menu';
  $('over').hidden = screen !== 'over';
  $('hud').hidden = screen === 'menu';
}

function beginGame(resumed) {
  resetEffects(fx);
  if (!resumed) start(g);
  show('game');
  refreshHud();
  loop.start();
  canvas.focus();
}

function endGame() {
  loop.kick();                       // one last frame with the final board
  $('final-score').textContent = String(g.score);
  const isBest = g.score > best;
  if (isBest) best = g.score;
  $('new-best').hidden = !isBest;
  show('over');

  // records/scores/stats — all fire-and-forget
  if (g.score > 0) {
    Arcade.scores.add('classic', { score: g.score });
    Arcade.records.best('high-score', { value: g.score, direction: 'higher', format: 'integer', label: 'High score' });
  }
  Arcade.stats.update('play', (prev) => {
    const p = prev || {};
    return {
      games: (p.games || 0) + 1,
      merges: (p.merges || 0) + g.tally.merges,
      watermelons: (p.watermelons || 0) + g.tally.watermelons,
      annihilations: (p.annihilations || 0) + g.tally.annihilations,
      bestChain: Math.max(p.bestChain || 0, g.tally.chainBest),
    };
  });
  Arcade.state.remove(SAVE_KEY);
  saveDirty = false;
  loop.stop();
}

// ── save plumbing ──────────────────────────────────────────────────────────
function flushSave() {
  if (g.state === 'playing') {
    Arcade.state.set(SAVE_KEY, serialize(g));
  }
  saveDirty = false;
}

// ── the loop ───────────────────────────────────────────────────────────────
const FIXED = 1 / 60 / PHYS.substeps;
let acc = 0;

const loop = Arcade.loop((deltaMs) => {
  const dt = Math.min(deltaMs / 1000, PHYS.maxDt);
  acc += dt;
  while (acc > 0) {
    tick(g, FIXED);
    acc -= FIXED;
  }

  // drain events → sfx + juice + hud + persistence
  const tNow = performance.now();
  let hudStale = false;
  for (const ev of g.events) {
    if (ev.type === 'drop') { sfx('drop', { level: ev.level }); hudStale = true; saveDirty = true; }
    else if (ev.type === 'merge') {
      sfx(ev.level === 11 ? 'watermelon' : 'merge', { level: ev.level });
      hudStale = true; saveDirty = true;
    }
    else if (ev.type === 'annihilate') { sfx('annihilate'); hudStale = true; saveDirty = true; }
    else if (ev.type === 'gameover') { sfx('game-over'); }
    pushEvent(fx, ev, tNow, settings.reducedMotion);
  }
  const ended = g.events.some((e) => e.type === 'gameover');
  g.events.length = 0;

  if (hudStale) refreshHud();
  if (ended) { endGame(); return; }

  // debounced save: at most one write per second of active play
  if (saveDirty && !saveTimer) {
    saveTimer = Arcade.session.setTimeout(() => { saveTimer = null; flushSave(); }, 1000);
  }

  pruneEffects(fx, tNow);
  R.draw(g, settings, tNow, fx);
});
let saveTimer = null;

// ── lifecycle ──────────────────────────────────────────────────────────────
Arcade.onSuspend(() => {
  if (g.state === 'playing') flushSave();   // synchronous — lands in the grace window
  loop.stop();
});
Arcade.onResume(() => {
  if (g.state === 'playing') loop.start();
  else loop.kick();
});

Arcade.onSettingsChange(() => {
  pullSettings();
  buildChart();          // chip canvases are sized from CSS, which follows --font-scale
  applyResize();
  loop.kick();
});

Arcade.onStateReplaced(() => {
  // Treat like a fresh boot: recompute everything from storage.
  loop.stop();
  bootFromState();
});

function applyResize() { R.resize(); if (g.state === 'playing') loop.kick(); else drawIdle(); }
window.addEventListener('resize', applyResize);

function drawIdle() { R.draw(g, settings, performance.now(), fx); }

// ── evolution chart on the menu ────────────────────────────────────────────
// Real fruit, drawn by the real painter — the chart is where a player learns
// what they are chasing, so flat coloured discs were selling the chain short.
function buildChart() {
  const holder = $('chart');
  holder.textContent = '';
  FRUITS.forEach((f, i) => {
    const cell = document.createElement('figure');
    cell.className = 'chip';
    cell.title = `${f.name} · ${f.pinyin} · +${f.score}`;

    const c = document.createElement('canvas');
    c.className = 'chip-art';
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', f.name);
    cell.appendChild(c);

    const cap = document.createElement('figcaption');
    cap.textContent = f.hanzi;
    cell.appendChild(cap);

    holder.appendChild(cell);
    if (i < FRUITS.length - 1) {
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '→';
      holder.appendChild(arrow);
    }
    // after layout, so clientWidth is the CSS size (which follows --font-scale)
    paintChip(c, i + 1, 0.3);
  });
}

// ── boot ───────────────────────────────────────────────────────────────────
function bootFromState() {
  resetEffects(fx);
  const rec = Arcade.records.get('high-score');
  best = rec && typeof rec.value === 'number' ? rec.value : 0;

  const save = Arcade.state.get(SAVE_KEY);
  if (save && restore(g, save)) {
    show('game');
    refreshHud();
    loop.start();
  } else {
    g.state = 'menu';
    show('menu');
    applyResize();
  }
}

bindInput(canvas, g, R.toWorldX, () => { /* per-drop hooks live in the event drain */ });

$('play').addEventListener('click', () => { sfx('menu-click'); beginGame(false); });
$('again').addEventListener('click', () => { sfx('menu-click'); beginGame(false); });
$('to-menu').addEventListener('click', () => {
  sfx('menu-click');
  g.state = 'menu';
  show('menu');
  drawIdle();
});

await Arcade.ready;
pullSettings();
buildChart();
applyResize();
bootFromState();
// Real state on every boot (also what proves the storage bridge in the
// acceptance checklist — the first save write otherwise waits for gameplay).
Arcade.stats.update('session', (p) => ({ launches: ((p && p.launches) || 0) + 1 }));

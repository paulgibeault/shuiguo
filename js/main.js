// shuǐguǒ boot + Arcade SDK wiring.
//
// Boot contract (GAME_INTEGRATION.md §2): everything that reads state waits
// on Arcade.ready. The render loop is Arcade.loop (fleet standard), timers
// honor suspend, saves flush synchronously in onSuspend.

import { WORLD, FRUITS, PHYS, radiusOf } from './constants.js';
import { makeGame, start, tick, serialize, restore } from './game.js';
import { makeRenderer } from './render.js';
import { bindInput } from './input.js';
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
  const nctx = nextCanvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = nextCanvas.clientWidth || 44;
  if (nextCanvas.width !== size * dpr) { nextCanvas.width = size * dpr; nextCanvas.height = size * dpr; }
  nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  nctx.clearRect(0, 0, size, size);
  nctx.save();
  nctx.translate(size / 2, size / 2);
  const targetR = size * 0.36;
  const worldR = radiusOf(g.next);
  nctx.scale(targetR / worldR, targetR / worldR);
  paintFruitOn(nctx, g.next, worldR);
  nctx.restore();
}

// Minimal standalone fruit painter for the preview (the board renderer's
// painter is bound to the board context).
function paintFruitOn(ctx2, level, r) {
  const f = FRUITS[level - 1];
  ctx2.fillStyle = f.color;
  ctx2.beginPath(); ctx2.arc(0, 0, r, 0, Math.PI * 2); ctx2.fill();
  ctx2.strokeStyle = f.rind; ctx2.lineWidth = Math.max(1.5, r * 0.06); ctx2.stroke();
  const fr = r * 0.5;
  ctx2.fillStyle = f.face;
  ctx2.beginPath(); ctx2.arc(-fr * 0.5, -fr * 0.15, Math.max(1.2, fr * 0.13), 0, Math.PI * 2); ctx2.fill();
  ctx2.beginPath(); ctx2.arc(fr * 0.5, -fr * 0.15, Math.max(1.2, fr * 0.13), 0, Math.PI * 2); ctx2.fill();
  ctx2.strokeStyle = f.face; ctx2.lineWidth = Math.max(1, fr * 0.09);
  ctx2.beginPath(); ctx2.arc(0, fr * 0.15, fr * 0.3, 0.15 * Math.PI, 0.85 * Math.PI); ctx2.stroke();
}

// ── screens ────────────────────────────────────────────────────────────────
function show(screen) {
  $('menu').hidden = screen !== 'menu';
  $('over').hidden = screen !== 'over';
  $('hud').hidden = screen === 'menu';
}

function beginGame(resumed) {
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

  // drain events → sfx + hud + persistence
  let hudStale = false;
  for (const ev of g.events) {
    if (ev.type === 'drop') { sfx('drop', { level: ev.level }); hudStale = true; saveDirty = true; }
    else if (ev.type === 'merge') {
      sfx(ev.level === 11 ? 'watermelon' : 'merge', { level: ev.level });
      hudStale = true; saveDirty = true;
    }
    else if (ev.type === 'annihilate') { sfx('annihilate'); hudStale = true; saveDirty = true; }
    else if (ev.type === 'gameover') { sfx('game-over'); }
  }
  const ended = g.events.some((e) => e.type === 'gameover');
  g.events.length = 0;

  if (hudStale) refreshHud();
  if (ended) { endGame(); return; }

  // debounced save: at most one write per second of active play
  if (saveDirty && !saveTimer) {
    saveTimer = Arcade.session.setTimeout(() => { saveTimer = null; flushSave(); }, 1000);
  }

  R.draw(g, settings, performance.now());
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

Arcade.onSettingsChange(() => { pullSettings(); applyResize(); loop.kick(); });

Arcade.onStateReplaced(() => {
  // Treat like a fresh boot: recompute everything from storage.
  loop.stop();
  bootFromState();
});

function applyResize() { R.resize(); if (g.state === 'playing') loop.kick(); else drawIdle(); }
window.addEventListener('resize', applyResize);

function drawIdle() { R.draw(g, settings, performance.now()); }

// ── evolution chart on the menu ────────────────────────────────────────────
function buildChart() {
  const holder = $('chart');
  holder.textContent = '';
  FRUITS.forEach((f, i) => {
    const cell = document.createElement('span');
    cell.className = 'chip';
    cell.style.setProperty('--c', f.color);
    cell.title = `${f.name} · ${f.pinyin} · +${f.score}`;
    cell.textContent = f.hanzi;
    holder.appendChild(cell);
    if (i < FRUITS.length - 1) {
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '→';
      holder.appendChild(arrow);
    }
  });
}

// ── boot ───────────────────────────────────────────────────────────────────
function bootFromState() {
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

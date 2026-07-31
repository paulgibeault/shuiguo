// shuǐ guǒ tān boot + Arcade SDK wiring.
//
// Boot contract (GAME_INTEGRATION.md §2): everything that reads state waits
// on Arcade.ready. The render loop is Arcade.loop (fleet standard), timers
// honor suspend, saves flush synchronously in onSuspend.

import { FRUITS, MAX_LEVEL, PHYS, radiusOf } from './constants.js';
import { makeGame, start, tick, serialize, restore, inDanger } from './game.js';
import { makeRenderer } from './render.js';
import { bindInput } from './input.js';
import { makeEffects, pushEvent, pruneEffects, resetEffects } from './effects.js';
import { paintFruit } from './fruit-art.js';
import {
  readDiscovered, packDiscovered, newDiscoveries, deepestChain, isDiscoverable,
} from './progress.js';
import { sfx } from './sfx.js';
import { makeRng } from './arcade-rng.js';

const $ = (id) => document.getElementById(id);

const SAVE_KEY = 'save';
const DISCOVERED_KEY = 'discovered';
const now = () => performance.now();

// Spawn sequence rng. Seeded per game from entropy; state rides the save so a
// restored game continues the same sequence.
const rng = makeRng((Math.random() * 0xffffffff) >>> 0);

const g = makeGame({ rng, now });
let best = 0;
let saveDirty = false;

// Every fruit level this player has ever MADE (levels 2–11), across all games.
// The source of truth is Arcade.stats; this is the in-memory mirror.
let discovered = new Set();

// Per-game, for the milestone records. `runStartedAt` is null for a resumed
// game: the clock that matters started in a session we no longer have, and a
// "fastest watermelon" measured from the resume would be a lie, so a resumed
// game simply doesn't compete for that record.
let runStartedAt = null;
let firstWatermelonAt = null;
let wasInDanger = false;

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

// ── discovery ──────────────────────────────────────────────────────────────
// "First time I made a peach!" — the reward loop and the bilingual-learning
// hook in one card. Discovery is merge-born only (js/progress.js explains
// why) and is persisted the moment it happens, not at game over: finding your
// first watermelon and then closing the tab must not un-find it.

function loadDiscovered() {
  discovered = readDiscovered(Arcade.stats.get(DISCOVERED_KEY));
}

// Fold levels into the stored set. Re-reads inside the updater so a write from
// another tab (or the sync bridge) between boot and now isn't clobbered.
function commitDiscovered(levels) {
  if (!levels.length) return;
  for (const level of levels) discovered.add(level);
  Arcade.stats.update(DISCOVERED_KEY, (prev) => {
    const merged = readDiscovered(prev);
    for (const level of levels) merged.add(level);
    return packDiscovered(merged);
  });
}

// A board restored from a save is proof of what was made, but the merges that
// made it happened in a session we didn't see. Bank those levels silently —
// no cards, no sound — so a save written before this feature existed can't
// pop a "first peach!" for the peach already sitting on the counter.
function bankBoardAsDiscovered() {
  const levels = [];
  for (const b of g.bodies) {
    if (isDiscoverable(b.level) && !discovered.has(b.level) && !levels.includes(b.level)) {
      levels.push(b.level);
    }
  }
  commitDiscovered(levels);
}

// ── discovery cards ────────────────────────────────────────────────────────
// Non-blocking by construction: the card is a DOM overlay over a canvas that
// keeps simulating, the layer is pointer-inert apart from the card itself,
// and nothing here touches the loop. Several discoveries in one chain queue
// up rather than stacking on top of each other.

const CARD_DWELL_MS = 2500;   // how long a card sits before it leaves
const CARD_GAP_MS = 900;      // and the beat before the next one arrives
const CARD_LEAVE_MS = 220;    // matches the .leaving animation in style.css

const cardQueue = [];
let cardShowing = null;
let cardTimer = null;

function queueDiscoveryCards(levels) {
  for (const level of levels) cardQueue.push(level);
  pumpCards();
}

function pumpCards() {
  if (cardShowing || !cardQueue.length) return;
  showCard(cardQueue.shift());
}

function showCard(level) {
  const f = FRUITS[level - 1];
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML =
    '<p class="card-kicker"></p>' +
    '<canvas class="card-art" role="img"></canvas>' +
    '<div class="card-name">' +
      '<span class="card-hanzi"></span>' +
      '<span class="card-pinyin"></span>' +
      '<span class="card-en"></span>' +
      '<span class="card-score"></span>' +
    '</div>';
  // textContent for every fruit string — the table is ours, but the habit is
  // the fleet's and costs nothing.
  card.querySelector('.card-kicker').textContent = 'First one! 第一次!';
  card.querySelector('.card-hanzi').textContent = f.hanzi;
  card.querySelector('.card-pinyin').textContent = f.pinyin;
  card.querySelector('.card-en').textContent = f.name;
  card.querySelector('.card-score').textContent = `+${f.score}`;
  card.setAttribute('aria-label', `New fruit discovered: ${f.hanzi} ${f.pinyin}, ${f.name}, plus ${f.score} points`);

  const art = card.querySelector('.card-art');
  art.setAttribute('aria-label', f.name);
  $('cards').appendChild(card);
  paintChip(art, level, 0.34);       // after append: clientWidth is the CSS size

  card.addEventListener('click', () => dismissCard(card));
  cardShowing = card;
  cardTimer = Arcade.session.setTimeout(() => dismissCard(card), CARD_DWELL_MS);
  sfx('discover');
}

function dismissCard(card) {
  if (cardShowing !== card) return;
  cardShowing = null;
  if (cardTimer) { cardTimer.cancel(); cardTimer = null; }
  card.classList.add('leaving');
  Arcade.session.setTimeout(() => card.remove(), CARD_LEAVE_MS);
  if (cardQueue.length) Arcade.session.setTimeout(pumpCards, CARD_GAP_MS);
}

function clearCards() {
  cardQueue.length = 0;
  if (cardTimer) { cardTimer.cancel(); cardTimer = null; }
  cardShowing = null;
  $('cards').textContent = '';
}

// ── chain banner ───────────────────────────────────────────────────────────
// A chain of three or more gets a word. Banner rather than a fourth HUD stat:
// the HUD is already three items wide on a phone, and the celebration wants
// to be an event anyway.

const BANNER_MS = 2000;
const CHAIN_HANZI = ['三', '四', '五', '六', '七', '八', '九', '十'];
let bannerTimer = null;

function showChainBanner(n) {
  const el = $('banner');
  const hanzi = CHAIN_HANZI[n - 3];
  el.textContent = hanzi ? `${n}-chain! ${hanzi}连!` : `${n}-chain!`;
  el.hidden = false;
  // restart the entry animation even if a banner is already up
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  if (bannerTimer) bannerTimer.cancel();
  bannerTimer = Arcade.session.setTimeout(() => { el.hidden = true; bannerTimer = null; }, BANNER_MS);
}

function hideChainBanner() {
  if (bannerTimer) { bannerTimer.cancel(); bannerTimer = null; }
  $('banner').hidden = true;
}

// ── screens ────────────────────────────────────────────────────────────────
function show(screen) {
  $('menu').hidden = screen !== 'menu';
  $('over').hidden = screen !== 'over';
  $('hud').hidden = screen === 'menu';
  // The chart is a collection book now, so it is rebuilt every time the menu
  // comes up rather than once at boot — the peach you just found is filled in
  // by the time you look. It also has to be painted while the sheet is
  // VISIBLE: a hidden sheet is display:none, and a chip canvas measured there
  // has no CSS size to scale its backing store from.
  if (screen === 'menu') buildChart();
}

function beginGame(resumed) {
  resetEffects(fx);
  clearCards();
  hideChainBanner();
  if (!resumed) start(g);
  runStartedAt = resumed ? null : performance.now();
  firstWatermelonAt = null;
  wasInDanger = false;
  show('game');
  refreshHud();
  loop.start();
  canvas.focus();
}

function endGame() {
  loop.kick();                       // one last frame with the final board
  clearCards();
  hideChainBanner();
  $('final-score').textContent = String(g.score);
  const isBest = g.score > best;
  if (isBest) best = g.score;
  $('new-best').hidden = !isBest;
  show('over');
  fillSummary();

  // records/scores/stats — all fire-and-forget
  if (g.score > 0) {
    Arcade.scores.add('classic', { score: g.score });
    Arcade.records.best('high-score', { value: g.score, direction: 'higher', format: 'integer', label: 'High score' });
  }
  if (g.tally.chainBest > 0) {
    Arcade.records.best('best-chain', { value: g.tally.chainBest, direction: 'higher', format: 'integer', label: 'Best chain' });
  }
  // Only a run we timed from its own start competes here — see runStartedAt.
  if (runStartedAt != null && firstWatermelonAt != null) {
    Arcade.records.best('fastest-watermelon', {
      value: firstWatermelonAt - runStartedAt,
      direction: 'lower',
      format: 'duration-ms',      // the launcher's own format id (arcade-records-core.js)
      label: 'Fastest watermelon',
    });
  }
  Arcade.stats.update('play', (prev) => {
    const p = prev || {};
    return {
      games: (p.games || 0) + 1,
      merges: (p.merges || 0) + g.tally.merges,
      watermelons: (p.watermelons || 0) + g.tally.watermelons,
      annihilations: (p.annihilations || 0) + g.tally.annihilations,
      bestChain: Math.max(p.bestChain || 0, g.tally.chainBest),
      bestLevel: Math.max(p.bestLevel || 0, g.tally.bestLevel),
    };
  });
  Arcade.state.remove(SAVE_KEY);
  saveDirty = false;
  loop.stop();
}

// ── the game-over summary ──────────────────────────────────────────────────
// Built from g.tally, which is exactly what the stats fold above banks — so
// the screen can never quietly disagree with the launcher's counters.

function fillSummary() {
  const level = Math.min(Math.max(g.tally.bestLevel, 1), MAX_LEVEL);
  const f = FRUITS[level - 1];
  const art = $('over-fruit');
  art.setAttribute('aria-label', f.name);
  $('over-fruit-hanzi').textContent = f.hanzi;
  $('over-fruit-pinyin').textContent = f.pinyin;
  paintChip(art, level, 0.32);       // the sheet is already shown, so it has a size

  // Merges always show (zero is a real result — you dropped and never matched);
  // the rarer rows only earn their space once they happen.
  const rows = [['Merges', g.tally.merges]];
  if (g.tally.chainBest > 1) rows.push(['Best chain', `×${g.tally.chainBest}`]);
  if (g.tally.watermelons > 0) rows.push(['Watermelons', g.tally.watermelons]);
  if (g.tally.annihilations > 0) rows.push(['Annihilations', g.tally.annihilations]);

  const dl = $('over-stats');
  dl.textContent = '';
  for (const [label, value] of rows) {
    const wrap = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    wrap.append(dt, dd);
    dl.appendChild(wrap);
  }
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
      sfx(ev.level === MAX_LEVEL ? 'watermelon' : 'merge', { level: ev.level });
      // the sparkle DECORATES the merge — layered over it, never instead
      if (ev.chain > 1) sfx('chain', { chain: ev.chain });
      if (ev.level === MAX_LEVEL && firstWatermelonAt == null) firstWatermelonAt = tNow;
      hudStale = true; saveDirty = true;
    }
    else if (ev.type === 'annihilate') { sfx('annihilate'); hudStale = true; saveDirty = true; }
    else if (ev.type === 'gameover') { sfx('game-over'); }
    pushEvent(fx, ev, tNow, settings.reducedMotion);
  }

  // A chain that finished this batch, and any fruit made here for the first
  // time ever. Both are read from the batch as a whole (js/progress.js), which
  // is why they live outside the per-event loop.
  const chain = deepestChain(g.events);
  if (chain >= 3) showChainBanner(chain);
  const found = newDiscoveries(discovered, g.events);
  if (found.length) { commitDiscovered(found); queueDiscoveryCards(found); }

  const ended = g.events.some((e) => e.type === 'gameover');
  g.events.length = 0;

  // The plank creaks once as the pile crosses the line — on the way IN, not
  // for as long as you are in trouble. Leaving and re-entering creaks again.
  const danger = g.state === 'playing' && inDanger(g);
  if (danger && !wasInDanger) sfx('warning');
  wasInDanger = danger;

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
  // Every canvas in the DOM chrome is sized from CSS, which follows
  // --font-scale — so each one has to be re-painted, and only while its own
  // sheet is actually visible (a display:none canvas measures 0).
  if (!$('menu').hidden) buildChart();
  if (!$('over').hidden) fillSummary();
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
// It doubles as the collection book: a fruit you have never MADE is a dimmed
// silhouette under a question mark (style.css does the dimming, so the painter
// stays the one painter and knows nothing about progress).
function buildChart() {
  const holder = $('chart');
  holder.textContent = '';
  FRUITS.forEach((f, i) => {
    const level = i + 1;
    const locked = isDiscoverable(level) && !discovered.has(level);
    const cell = document.createElement('figure');
    cell.className = locked ? 'chip locked' : 'chip';
    cell.title = locked ? 'Not yet made' : `${f.name} · ${f.pinyin} · +${f.score}`;

    const c = document.createElement('canvas');
    c.className = 'chip-art';
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', locked ? 'Undiscovered fruit' : f.name);
    cell.appendChild(c);

    const cap = document.createElement('figcaption');
    cap.textContent = locked ? '?' : f.hanzi;
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
  clearCards();
  hideChainBanner();
  const rec = Arcade.records.get('high-score');
  best = rec && typeof rec.value === 'number' ? rec.value : 0;
  loadDiscovered();

  const save = Arcade.state.get(SAVE_KEY);
  if (save && restore(g, save)) {
    bankBoardAsDiscovered();
    runStartedAt = null;             // a resumed run doesn't compete for time
    firstWatermelonAt = null;
    wasInDanger = inDanger(g);       // already over the line ⇒ already creaked
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
applyResize();
bootFromState();          // reads the discovery set, then show() builds the chart
// Real state on every boot (also what proves the storage bridge in the
// acceptance checklist — the first save write otherwise waits for gameplay).
Arcade.stats.update('session', (p) => ({ launches: ((p && p.launches) || 0) + 1 }));

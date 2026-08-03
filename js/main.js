// shuǐ guǒ tān boot + the FREE PLAY host.
//
// Boot contract (GAME_INTEGRATION.md §2): everything that reads state waits
// on Arcade.ready. The render loop is Arcade.loop (fleet standard), timers
// honor suspend, saves flush synchronously in onSuspend.
//
// This file used to be the whole game. It is now the boot path plus one of
// three hosts: the campaign's farm and market live in js/farm-host.js and
// js/market-host.js, and which screen is up is js/mode.js's business. Free play
// itself is UNCHANGED — same save key, same score lane, same records, same
// rules — and pinned that way by tests/free-play-isolation.

import { FRUITS, MAX_LEVEL, PHYS, FRIENDS } from './constants.js';
import { makeGame, start, tick, serialize, restore, inDanger } from './game.js';
import { makeRenderer } from './render.js';
import { bindInput } from './input.js';
import { makeEffects, pushEvent, pruneEffects, resetEffects, cheer } from './effects.js';
import {
  readDiscovered, packDiscovered, newDiscoveries, deepestChain, isDiscoverable,
} from './progress.js';
import { sfx } from './sfx.js';
import { makeRng } from './arcade-rng.js';
import { paintChip } from './chips.js';
import { makeRouter } from './mode.js';
import { chainMultiplier, friendCut } from './economy.js';
import { earn, hasFarm } from './campaign.js';
import {
  FIRST_FRIEND, friendOf, openFriends, isBalanced, weightedDraw,
} from './friends.js';
import { fruitCard, lockedCard, paintCardsIn } from './cards.js';
import { multiplier } from './format.js';
import { makeCampaignSave, bootScreen } from './campaign-save.js';
import { makeFarmHost } from './farm-host.js';
import { makeMarketHost } from './market-host.js';

const $ = (id) => document.getElementById(id);

const SAVE_KEY = 'save';
const DISCOVERED_KEY = 'discovered';
const now = () => performance.now();

// Spawn sequence rng. Seeded per game from entropy; state rides the save so a
// restored game continues the same sequence.
const rng = makeRng((Math.random() * 0xffffffff) >>> 0);

// Whose stall is being minded. The dropper reads this variable live rather than
// closing over a friend, so choosing a different one re-stocks the sky without
// rebuilding the game — it is the same board, the same save and the same rules
// whoever is watching.
//
// And it is emphatically not a CRATE: a friend's stall is infinite, the weights
// changing only what the sky sends down and never how much of it there is. The
// board stays exactly as strict about a hostile save as it always was.
let friend = FIRST_FRIEND;
const g = makeGame({ rng, now, drawFruit: () => weightedDraw(friend.weights, rng) });
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
// This board is somebody's stall, and they sit on the plank and watch you work
// it. This renderer only ever draws free play, so the market host's own perch
// is left alone.
//
// Nothing ever changes who is minding the stall without re-perching them, so
// the two moves are one function rather than a pairing every call site has to
// remember.
function setFriend(f) {
  friend = f;
  R.setPerch(f.level);
}
setFriend(friend);
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

// The campaign's first-make of a level is the same moment wearing a different
// hat: you didn't just meet this fruit, you earned the right to grow it. Same
// card, same queue, same dwell — one line of copy apart.
export function queueSeedCards(levels) {
  for (const level of levels) cardQueue.push({ level, kicker: 'New seed! 新种子!' });
  pumpCards();
}

// The opening, said out loud — three cards, one per beat, on the card idiom the
// game already has rather than a dialog system it does not want. Each is keyed
// to a phase transition and so fires once; none of them pauses anything, and any
// of them can be tapped away. The art is the cherry all three times, because the
// cherry is what the player is holding, growing and about to buy.
//
// The word budget is the pillar, not a nicety: a card is a kicker and a
// bilingual name and nothing else, which is why none of these explains the rule
// it points at. The card says what matters — merging is how you earn, that
// mountainside is for sale — and the thing itself teaches the rest.
//
// Beat one: what a market day is FOR. A player who is never told this drops
// seventy fruit without a single merge and packs up with nothing, which is
// exactly what a playtest did.
function queueMarketCard() {
  cardQueue.push({
    level: 1, kicker: 'Merge to earn! 合并!',
    hanzi: '合并', pinyin: 'hébìng', en: 'Merge', score: null,
  });
  pumpCards();
}

// Beat two: it lands as the camera settles on the sign it names, so "there is a
// farm up there and it is for sale" needs no sentence — the price is painted on
// the board the card is pointing at.
function queueForSaleCard() {
  cardQueue.push({
    level: 1, kicker: 'For sale! 出售!',
    hanzi: '出售', pinyin: 'chūshòu', en: 'The farm', score: null,
  });
  pumpCards();
}

// Beat three, and the one narrated moment in the campaign: four words on the
// same card. The art is the cherry, because the cherry tree is literally what
// the player just bought.
function queueFarmCard() {
  cardQueue.push({
    level: 1, kicker: 'Your farm! 你的农场!',
    hanzi: '农场', pinyin: 'nóngchǎng', en: 'Farm', score: null,
  });
  pumpCards();
}

function pumpCards() {
  if (cardShowing || !cardQueue.length) return;
  showCard(cardQueue.shift());
}

// A card is a kicker, one piece of art and a bilingual name. Three things in
// the game are exactly that shape — a fruit made for the first time, a seed
// unlocked, and the farm changing hands — so they are one card with three sets
// of words rather than three overlays. `entry` is a bare level for the common
// case, or { level, kicker, hanzi, pinyin, en, score } to override the words.
function showCard(entry) {
  const spec = typeof entry === 'number' ? { level: entry } : entry;
  const level = spec.level;
  const kicker = spec.kicker || 'First one! 第一次!';
  const f = { ...FRUITS[level - 1], ...spec };
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
  card.querySelector('.card-kicker').textContent = kicker;
  card.querySelector('.card-hanzi').textContent = f.hanzi;
  card.querySelector('.card-pinyin').textContent = f.pinyin;
  card.querySelector('.card-en').textContent = f.en || f.name;
  card.querySelector('.card-score').textContent = spec.score === null ? '' : `+${f.score}`;
  card.setAttribute('aria-label', `${kicker} ${f.hanzi} ${f.pinyin}, ${f.en || f.name}`);

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

// `extra` is a tail the host may hang off the end — during a market day, the
// bonus the combo is actually paying (js/economy.js owns the number, this owns
// none of it). Free play passes nothing and reads exactly as it always has.
function showChainBanner(n, extra) {
  const el = $('banner');
  const hanzi = CHAIN_HANZI[n - 3];
  const base = hanzi ? `${n}-chain! ${hanzi}连!` : `${n}-chain!`;
  el.textContent = extra ? `${base} ${extra}` : base;
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
// One router owns all seven; free play registers the three it drives. The
// chart is rebuilt every time the free-play menu comes up rather than once at
// boot — it is a collection book now, so the peach you just found is filled in
// by the time you look. It also has to be painted while its sheet is VISIBLE:
// a hidden sheet is display:none, and a chip canvas measured there has no CSS
// size to scale its backing store from. The router settles the DOM before it
// calls onEnter, which is what makes that safe.
const router = makeRouter();

router
  .add('mode', { sheet: $('mode'), onEnter: paintModeBadge })
  .add('menu', { sheet: $('menu'), onEnter: () => { buildChart(); buildFriends(); } })
  .add('game', { chrome: [$('hud')] })
  .add('over', { sheet: $('over') });

function show(screen) { router.route(screen); }

// `who` is the friend whose stall this is; omitted it stays whoever it was,
// which is what Again 再来 wants — you are still minding the same stall.
function beginGame(resumed, who) {
  if (who) setFriend(who);
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
  // The BOARD is only comparable with other boards stocked the same way, so only
  // an evenly-stocked stall competes (js/friends.js §isBalanced). 葡萄's cozy
  // stall rains small fruit and is a chain paradise; 苹果's fills fast and pays
  // fast. A high score or a best chain out of either would be a lie sitting on
  // the same board as everybody else's honest one — and the sheet must not
  // congratulate a score the board then refuses, so the banner is gated with
  // them.
  //
  // The collection book is NOT gated: a first pear is a first pear wherever you
  // made it, and `discovered` fills from any stall as it always has.
  const ranked = isBalanced(friend);
  const isBest = ranked && g.score > best;
  if (isBest) best = g.score;
  $('new-best').hidden = !isBest;
  show('over');
  fillSummary();
  paySplit();

  // records/scores/stats — all fire-and-forget, and gated on `ranked` above
  if (ranked && g.score > 0) {
    Arcade.scores.add('classic', { score: g.score });
    Arcade.records.best('high-score', { value: g.score, direction: 'higher', format: 'integer', label: 'High score' });
  }
  if (ranked && g.tally.chainBest > 0) {
    Arcade.records.best('best-chain', { value: g.tally.chainBest, direction: 'higher', format: 'integer', label: 'Best chain' });
  }
  // Only a run we timed from its own start competes here — see runStartedAt.
  if (ranked && runStartedAt != null && firstWatermelonAt != null) {
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

// ── the friend's split ─────────────────────────────────────────────────────
// You minded 草莓's stall; at close they split the till with you, into the
// campaign. It is the one thing this mode is allowed to write into the
// campaign, and CASH IS ALL OF IT — no seeds, no unlocks, no crate, no farm, no
// phase change. Seed unlocks stay campaign-merge-only (js/campaign.js
// §noteMerges is never called from here), which is what keeps a lucky evening
// on a friend's stall from skipping the whole progression.
//
// No farm means no split: there is nowhere for the money to go, and a player
// who has never opened the campaign sees the game-over sheet they always saw
// and writes not one campaign byte.
function paySplit() {
  const line = $('friend-cut');
  const c = campaignSave.get();
  const cut = hasFarm(c) ? friendCut(g.score) : 0;
  if (cut <= 0) { line.hidden = true; line.textContent = ''; return; }
  earn(c, cut);
  campaignSave.touch();
  campaignSave.flush();
  const f = FRUITS[friend.level - 1];
  line.textContent = `${f.hanzi} splits the till 分成 +${cut}元`;
  line.hidden = false;
}

// ── save plumbing ──────────────────────────────────────────────────────────
// Whose stall it was rides alongside js/game.js's payload rather than inside
// it: the game module owns a board, and who is watching it is the host's. It is
// additive, so a save written before the cast existed resumes into 草莓's stall
// — which is where it was, since that was the only one there was.
function flushSave() {
  if (g.state === 'playing') {
    const board = serialize(g);
    board.friend = friend.level;      // nobody else holds it; no copy needed
    Arcade.state.set(SAVE_KEY, board);
  }
  saveDirty = false;
}

// ── the loop ───────────────────────────────────────────────────────────────
const FIXED = 1 / 60 / PHYS.substeps;
let acc = 0;

const loop = Arcade.loop((deltaMs) => {
  if (!router.is('game')) return;
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
  if (chain >= 3) { showChainBanner(chain); cheer(fx, tNow, settings.reducedMotion); }
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
// Three hosts, one set of Arcade hooks. Each hook asks the router who is
// driving and tells only them — a host that is not on screen must never write
// a save or start a loop.

Arcade.onSuspend(() => {
  if (router.is('game') && g.state === 'playing') flushSave();  // synchronous: the grace window
  if (router.is('market')) market.flush();
  campaignSave.flushIfDirty();
  loop.stop();
  farmLoop.stop();
  marketLoop.stop();
});

Arcade.onResume(() => {
  if (router.is('game')) { if (g.state === 'playing') loop.start(); else loop.kick(); }
  else if (router.is('farm')) { farm.enter(); }
  else if (router.is('market')) { marketLoop.start(); }
});

Arcade.onSettingsChange(() => {
  pullSettings();
  // Every canvas in the DOM chrome is sized from CSS, which follows
  // --font-scale — so each one has to be re-painted, and only while its own
  // sheet is actually visible (a display:none canvas measures 0).
  if (!$('menu').hidden) buildChart();
  if (!$('over').hidden) fillSummary();
  if (router.is('market')) market.refreshHud();
  if (router.is('farm')) farm.refresh();
  applyResize();
});

Arcade.onStateReplaced(() => {
  // Treat like a fresh boot: recompute everything from storage, both modes.
  loop.stop();
  farmLoop.stop();
  marketLoop.stop();
  campaignSave.reload();
  bootFromState();
});

// One canvas, three views. Whoever is driving owns the transform, so a resize
// has to reach all of them and then repaint the one on screen.
function applyResize() {
  R.resize();
  farm.resize();
  market.resize();
  if (router.is('game')) { if (g.state === 'playing') loop.kick(); else drawIdle(); }
  else if (router.is('farm')) farmLoop.kick();
  else if (router.is('market')) marketLoop.kick();
}
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

// ── whose stall to mind ────────────────────────────────────────────────────
// One card per friend, on the seed-card idiom the shop and the plot picker
// already use (js/cards.js): the real fruit, its bilingual name, and the one
// word that says how their stall is stocked. Friends whose seed has not been
// earned in a campaign run are dashed silhouettes under the same hint the shop
// gives, because it is the same rule.
//
// With only 草莓 open the whole chooser is hidden and the plain Play button
// stands in for it — a menu of one is a speed bump. It is rebuilt every time
// the menu comes up rather than once at boot, exactly like the chart, so the
// grape you unlocked at market this evening is live by the time you look.

function buildFriends() {
  const holder = $('friends');
  const c = campaignSave.get();
  const open = openFriends(c);
  const many = open.length >= 2;
  holder.textContent = '';
  // Nobody to choose between: the button below is the whole interface.
  holder.hidden = !many;
  $('friends-hint').hidden = !many || open.length === FRIENDS.length;
  $('play').hidden = many;
  if (!many) return;

  for (const f of FRIENDS) {
    holder.appendChild(open.includes(f)
      ? fruitCard({
        level: f.level, meta: f.flavor,
        onPick: () => { sfx('menu-click'); beginGame(false, f); },
      })
      : lockedCard(f.level, 'A grower you have not met — merge one at market'));
  }
  paintCardsIn(holder);          // the sheet is up now, so the chips have a size
}

// ── the campaign ───────────────────────────────────────────────────────────
// Two more hosts on the same canvas and the same frame. Free play above this
// line is untouched; everything below is additive.

const campaignSave = makeCampaignSave(Arcade.state);
const wallNow = () => Date.now();

const farmLoop = Arcade.loop(() => {
  if (!router.is('farm')) return;
  farm.draw(performance.now());
});

const marketLoop = Arcade.loop((deltaMs) => {
  if (!router.is('market')) return;
  market.frame(deltaMs);
});

const farm = makeFarmHost({
  canvas,
  save: campaignSave,
  getSettings: () => settings,
  wallNow,
  loop: farmLoop,
  rng,
  onFarmBought: queueFarmCard,
});

const market = makeMarketHost({
  canvas,
  router,
  save: campaignSave,
  getSettings: () => settings,
  rng,
  loop: marketLoop,
  session: Arcade.session,
});

// The campaign borrows free play's two celebrations wholesale: a chain is a
// chain, and a first-make is a card. Only the kicker differs — and the chain
// banner, which during a market day says what the combo is paying, because
// every reward on screen there is money.
market.setHooks({
  onChain: (n) => showChainBanner(n, `×${multiplier(chainMultiplier(n))}`),
  onUnlock: (levels) => { queueSeedCards(levels); commitDiscovered(levels); },
});

router
  .add('farm', { chrome: [$('farm-hud')], onEnter: farm.enter, onExit: farm.exit })
  .add('market', { chrome: [$('market-hud')], onEnter: market.enter, onExit: market.exit })
  .add('appraisal', { sheet: $('appraisal') });

// 🌱 on the Campaign button until the player owns a farm — the one nudge in the
// game, and it retires the moment it has been acted on.
function paintModeBadge() {
  $('campaign-badge').hidden = hasFarm(campaignSave.get());
}

// Was the run being appraised the gift run? The appraisal lands in `buy-farm`
// either way, but a player who went back to market because they came up short
// of 500元 is not living the opening again — they already know where the farm
// is, so the camera move and its card belong to the first arrival only.
let cameFromGiftRun = false;

// Going to market. The gift run and every run after it take the same path;
// what differs is only what is in the crate.
function toMarket() {
  clearCards();
  hideChainBanner();
  const gift = campaignSave.get().phase === 'gift-run';
  if (!market.begin()) return;
  cameFromGiftRun = gift;
  router.route('market');
  // Beat one: the gift crate pulses beside the dropper, and one card says what
  // to do with it. The pulse points at the thing to use and stops the moment it
  // is used; the card is skippable and the first fruit is already droppable
  // behind it, so neither one is a gate.
  $('crate-strip').classList.toggle('pulse', gift);
  if (gift) queueMarketCard();
}

function toCampaign() {
  clearCards();
  hideChainBanner();
  const c = campaignSave.get();
  // The opening, in one branch: no farm yet means there is only one thing to
  // do, so the game does it rather than offering it.
  if (c.phase === 'gift-run') { toMarket(); return; }
  if (c.phase === 'buy-farm') { router.route('farm'); return; }
  router.route('farm');
}

$('play-campaign').addEventListener('click', () => { sfx('menu-click'); toCampaign(); });
$('play-free').addEventListener('click', () => { sfx('menu-click'); router.route('menu'); });
$('menu-to-mode').addEventListener('click', () => { sfx('menu-click'); router.route('mode'); });
$('farm-to-menu').addEventListener('click', () => { sfx('menu-click'); router.route('mode'); });
$('to-market').addEventListener('click', () => { sfx('menu-click'); toMarket(); });
// The pulse retires on the first drop, not on a timer: it was pointing at
// something, and it has been understood.
canvas.addEventListener('pointerup', () => $('crate-strip').classList.remove('pulse'));

$('pack-up').addEventListener('click', () => { sfx('menu-click'); market.finishRun('packed'); });
$('appraisal-done').addEventListener('click', () => {
  sfx('menu-click');
  const c = campaignSave.get();
  // Beat two: the first time, the view pans up off the road to the weedy
  // terrace with the 出售 sign on it. One scripted camera move in the whole
  // game, and it exists so that "there is a farm up there" needs no sentence.
  const opening = c.phase === 'buy-farm' && cameFromGiftRun;
  if (opening) farm.panUp();
  // After the gift run the farm is for sale, and buying it is the only move —
  // so the appraisal hands the player straight to it (js/farm-host.js stages
  // the 出售 sign) rather than asking them to find it.
  router.route(c.phase === 'gift-run' ? 'mode' : 'farm');
  // …and the card that names the sign goes up after the route, so the farm is
  // what it lands over rather than the appraisal sheet.
  if (opening) queueForSaleCard();
});

// ── input ──────────────────────────────────────────────────────────────────
// One binding for a canvas two games share. The adapter answers "who is being
// driven right now", which is null on every screen that is not a board.
bindInput(canvas, {
  game: () => (router.is('game') ? g : router.is('market') ? market.game() : null),
  toWorldX: (px) => R.toWorldX(px),
});

// ── free play's own buttons ────────────────────────────────────────────────
$('play').addEventListener('click', () => { sfx('menu-click'); beginGame(false); });
$('again').addEventListener('click', () => { sfx('menu-click'); beginGame(false); });
$('to-menu').addEventListener('click', () => {
  sfx('menu-click');
  g.state = 'menu';
  show('menu');
  drawIdle();
});

// ── boot ───────────────────────────────────────────────────────────────────
// Resume rules (js/campaign-save.js §bootScreen): a mid-drop board wins over
// everything, campaign before free play because it is the more specific state,
// and otherwise the front door. A campaign in progress does NOT open the farm
// on launch — the farm is a place you choose to go.
function bootFromState() {
  resetEffects(fx);
  clearCards();
  hideChainBanner();
  const rec = Arcade.records.get('high-score');
  best = rec && typeof rec.value === 'number' ? rec.value : 0;
  loadDiscovered();

  const where = bootScreen({
    marketSave: campaignSave.readMarket(),
    freePlaySave: Arcade.state.get(SAVE_KEY),
  });

  if (where === 'market' && market.resume()) {
    router.route('market');
    return;
  }

  const save = Arcade.state.get(SAVE_KEY);
  if (where !== 'mode' && save && restore(g, save)) {
    // Back to the stall you were minding. `friendOf` answers with 草莓 for
    // anything it does not recognise, including the saves written before there
    // was a cast — which is where those runs were, because it was the only
    // stall there was.
    setFriend(friendOf(save.friend));
    bankBoardAsDiscovered();
    runStartedAt = null;             // a resumed run doesn't compete for time
    firstWatermelonAt = null;
    wasInDanger = inDanger(g);       // already over the line ⇒ already creaked
    show('game');
    refreshHud();
    loop.start();
    return;
  }

  g.state = 'menu';
  show('mode');
  applyResize();
}

await Arcade.ready;
pullSettings();
applyResize();
bootFromState();          // reads the discovery set, then show() builds the chart
// Real state on every boot (also what proves the storage bridge in the
// acceptance checklist — the first save write otherwise waits for gameplay).
Arcade.stats.update('session', (p) => ({ launches: ((p && p.launches) || 0) + 1 }));

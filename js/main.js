// shuǐ guǒ tān boot + the FREE PLAY host.
//
// Boot contract (GAME_INTEGRATION.md §2): everything that reads state waits
// on Arcade.ready. The render loop is Arcade.loop (fleet standard), timers
// honor suspend, saves flush synchronously in onSuspend.
//
// This file used to be the whole game. It is now the boot path plus one of
// three hosts: the campaign's farm and market live in js/farm-host.js and
// js/market-host.js, and which screen is up is js/mode.js's business.
//
// This host minds SOMEBODY'S STALL. Same save key, same score lane, same
// records, same rules, and the same isolation promise it has always kept — the
// only campaign state it may write is cash, and only as the stallholder's split
// (see §paySplit). What changed is where the fruit comes from: a friend hands
// over a finite morning's produce, the wholesaler an endless crate, and the
// endless one is free play exactly as it always was, down to the rng sequence
// (js/friends.js §weightedDraw).

import { FRUITS, MAX_LEVEL, PHYS, FRIENDS, WHOLESALER } from './constants.js';
import {
  makeGame, start, tick, serialize, restore, inDanger, setStock, finish,
  isSoldOut, isSettled,
} from './game.js';
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
import { chainMultiplier, friendCut, priceOfEquipment, tidyBonusPercent } from './economy.js';
import {
  earn, hasFarm, crateSize, canGoToMarket, couldUseAHand, seedCount, isUnlocked,
} from './campaign.js';
import {
  countOf, levelsIn, totalCount, drawFromCrate, packCounts, unpackCounts,
} from './counts.js';
import {
  STALLS, stallOf, stallName, stallAlt, openFriends, isEndless, isRanked,
  stockCrate, weightedDraw, crateSizeOf,
  makeStallClock, noteStallSold, msUntilRestock, packStallClock, unpackStallClock,
} from './friends.js';
import { fruitCard, lockedCard, paintCardsIn } from './cards.js';
import { fruitTile, lockedTile, fruitStats, chainNote } from './collection.js';
import { renderQueue } from './queue.js';
import { multiplier, money, countdown } from './format.js';
import { makeCampaignSave, bootScreen } from './campaign-save.js';
import { makeFarmHost } from './farm-host.js';
import { makeMarketHost } from './market-host.js';

const $ = (id) => document.getElementById(id);

const SAVE_KEY = 'save';
const DISCOVERED_KEY = 'discovered';
// Whose stall is picking again, and until when. Free play's own key, alongside
// its board — a friend's farm is not campaign state (the campaign has never
// heard of the cast's fields) and the isolation promise stays exactly as narrow
// as it was: this mode writes `save`, `stalls`, and the campaign's CASH.
const STALLS_KEY = 'stalls';
const now = () => performance.now();

// Spawn sequence rng. Seeded per game from entropy; state rides the save so a
// restored game continues the same sequence.
const rng = makeRng((Math.random() * 0xffffffff) >>> 0);

// Whose stall is being minded, and what is left of what they picked this
// morning. The dropper reads both variables live rather than closing over
// either, so choosing a different stall re-stocks it without rebuilding the
// game — it is the same board, the same save and the same rules whoever is
// watching.
//
// `crate` is the whole difference between a friend's stall and the wholesaler's:
// a friend hands you a MORNING'S PRODUCE, which empties and ends the run, and
// the wholesaler hands you an endless one (`null` here — nothing to count).
// Either way the fruit that comes down is only ever what a sky can send, so the
// board stays exactly as strict about a hostile save as it always was.
let stall = WHOLESALER;
let crate = null;

// …and how long until each of them has picked another morning. One farm, one
// morning: selling a friend's crate shuts their stall until `restockMs` has
// passed (js/friends.js §the morning after). The wholesaler is never in here —
// nobody's field is behind an endless crate — so there is always somewhere to
// go, which is what keeps this a limit rather than a wait.
let stallClock = makeStallClock();

function drawFruit() {
  return crate ? drawFromCrate(crate, rng) : weightedDraw(stall.weights, rng);
}

const g = makeGame({ rng, now, drawFruit });
let best = 0;
let saveDirty = false;
// Set when the crate runs dry, so the run can wait for the pile to stop rolling
// before it closes — a fruit still in the air might yet merge.
let soldOutAt = null;

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

// How long to wait for the pile to stop rolling once the crate is empty before
// calling the day. The market host's own number, for the same reason: closing
// mid-chain would rob the player of the score.
const SOLD_OUT_GRACE_MS = 4000;

const canvas = $('board');
const R = makeRenderer(canvas);
// This board is somebody's stall, and they sit on the plank and watch you work
// it. This renderer only ever draws free play, so the market host's own perch
// is left alone.
//
// Nothing ever changes who is minding the stall without re-perching them and
// re-stocking the dropper, so all three moves are one function rather than a
// trio every call site has to remember. A null crate is the endless stall; any
// other value is a morning's produce that the game must know can run out, which
// is what `finite` tells js/game.js.
function setStall(s, stock = null) {
  stall = s;
  crate = stock;
  R.setPerch(s.level);
  setStock(g, { draw: drawFruit, finite: !!stock });
}
setStall(stall);
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

function refreshHud() {
  $('score').textContent = String(g.score);
  $('best').textContent = String(Math.max(best, g.score));
  renderQueue($('queue-chips'), g.queue, $('next-label'));
  // Nothing coming and nothing left to come: the day is done, and the line that
  // names the next fruit says so instead of going quietly blank.
  if (g.queue.length === 0 && crate && totalCount(crate) === 0) {
    $('next-label').textContent = 'Sold out 卖完了';
  }
  buildStallStrip();
  refreshPackUp();
}

// What is left of this morning's produce, as chips with counts — the market
// HUD's strip, on the free-play board, because a friend's crate emptying is
// exactly the same clock. The endless stall has no clock and says so: one chip
// of the wholesaler's own fruit under an ∞, rather than a strip that is
// mysteriously always blank.
function buildStallStrip() {
  const holder = $('stall-strip');
  holder.textContent = '';
  const cells = crate
    ? levelsIn(crate).map((level) => [level, `×${countOf(crate, level)}`, ''])
    : [[stall.level, '∞', ' endless']];
  for (const [level, caption, extra] of cells) {
    const cell = document.createElement('figure');
    cell.className = caption === '∞' ? 'crate-chip endless' : 'crate-chip';
    const art = document.createElement('canvas');
    art.className = 'chip-art';
    art.setAttribute('role', 'img');
    art.setAttribute('aria-label', `${FRUITS[level - 1].name}${extra}`);
    const cap = document.createElement('figcaption');
    cap.textContent = caption;
    cell.append(art, cap);
    holder.appendChild(cell);
    paintChip(art, level, 0.3);
  }
}

// "Pack up 收摊" is the smart play and reads as the cowardly one, so once there
// is a bonus to be had the button says what it pays — the market's own idiom,
// asked of the same figure that will actually be paid (js/economy.js
// §friendCut). A run nobody is splitting a till with advertises nothing.
function refreshPackUp() {
  const tidy = splitFor('packed') - splitFor('toppled');
  $('stall-pack-up').textContent = tidy > 0
    ? `Pack up 收摊 +${tidyBonusPercent()}%`
    : 'Pack up 收摊';
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
// collection is rebuilt every time it comes up rather than once at boot, so the
// peach you just found is filled in by the time you look. It also has to be
// painted while its sheet is VISIBLE: a hidden sheet is display:none, and a
// chip canvas measured there has no CSS size to scale its backing store from.
// The router settles the DOM before it calls onEnter, which is what makes that
// safe.
const router = makeRouter();

router
  // The two screens that can show a stall picking again stop the countdown
  // timer on the way out — nothing on any other screen is waiting for it.
  .add('mode', { sheet: $('mode'), onEnter: refreshMap, onExit: stopClock })
  .add('menu', { sheet: $('menu'), onEnter: buildCollection, onExit: closeFruit })
  .add('stall', { sheet: $('stall'), onEnter: buildStallSheet })
  // One header per board (the queue rail lives inside it) and one counter over
  // the foot of the board (the crate and Pack up) — see index.html. Arriving
  // re-fits the world, because the counter is a band the world may not use.
  .add('game', { chrome: [$('hud'), $('stall-counter')], onEnter: applyResize })
  .add('over', { sheet: $('over'), onExit: stopClock });

function show(screen) { router.route(screen); }

// `who` is the stall this is, and `stock` the crate they handed over — a fresh
// one every time, because a crate is a morning and mornings do not repeat.
// Omitted, both stay whatever they were, which is what a resume wants.
function beginGame(resumed, who, stock = null) {
  if (who) setStall(who, stock);
  resetEffects(fx);
  clearCards();
  hideChainBanner();
  if (!resumed) start(g);
  runStartedAt = resumed ? null : performance.now();
  firstWatermelonAt = null;
  wasInDanger = false;
  soldOutAt = null;
  show('game');
  refreshHud();
  loop.start();
  canvas.focus();
}

// Every ending is a sale here too (the campaign's pillar, and it was always
// true of this board — the stall filling up has never cost the player their
// score). What the reason changes is the heading, the sound, and whether the
// friend's split earns the Tidy Stall.
const OVER_TITLES = {
  toppled: 'The stall is full! 满了!',
  packed: 'Packed up! 收摊了!',
  'sold-out': 'Sold out! 卖完了!',
};

function endGame(reason = 'toppled') {
  loop.kick();                       // one last frame with the final board
  clearCards();
  hideChainBanner();
  $('over-title').textContent = OVER_TITLES[reason] || OVER_TITLES.toppled;
  $('final-score').textContent = String(g.score);
  // The BOARD is only comparable with other boards stocked the same way AND run
  // on the same clock, so only the endless, evenly-stocked stall competes
  // (js/friends.js §isRanked) — the wholesaler's. 葡萄's cozy crate rains small
  // fruit and is a chain paradise; 苹果's fills fast and pays fast; and any crate
  // at all caps what a run can possibly score. A high score or a best chain out
  // of one of those would be a lie sitting on the same board as everybody else's
  // honest one — and the sheet must not congratulate a score the board then
  // refuses, so the banner is gated with them.
  //
  // The collection book is NOT gated: a first pear is a first pear wherever you
  // made it, and `discovered` fills from any stall as it always has.
  const ranked = isRanked(stall, crate == null);
  const isBest = ranked && g.score > best;
  if (isBest) best = g.score;
  $('new-best').hidden = !isBest;
  show('over');
  fillSummary();
  paySplit(reason);
  // Their morning is sold. The clock starts at the END of the day rather than
  // when the crate was handed over, so the wait is the whole of it however long
  // the run took — and a run left open overnight costs the friend nothing.
  closeStall();

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
  // English first: the name the player can read, then the words to learn.
  $('over-fruit-name').textContent = f.name;
  $('over-fruit-alt').textContent = `${f.hanzi} ${f.pinyin}`;
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
//
// The wholesaler takes their share exactly like a friend does — an endless crate
// is stock somebody fronted you, not a gift — so this path is the same one
// whichever stall it was.
function paySplit(reason) {
  const line = $('friend-cut');
  const c = campaignSave.get();
  const cut = splitFor(reason);
  if (cut <= 0) { line.hidden = true; line.textContent = ''; return; }
  earn(c, cut);
  campaignSave.touch();
  campaignSave.flush();
  line.textContent = `${stallName(stall)} splits the till +${cut}元`;
  line.hidden = false;
}

// What this ending would pay into the campaign, asked without paying it — the
// Pack up button wears the difference. Zero for a player with no farm, which is
// the same "nowhere for it to go" rule paySplit itself runs on.
function splitFor(reason) {
  return hasFarm(campaignSave.get()) ? friendCut(g.score, reason) : 0;
}

// ── the morning after ──────────────────────────────────────────────────────
// A friend has one farm and you have just sold everything on it, so their stall
// is shut until they have picked another morning (js/friends.js §restockMsOf).
//
// The wholesaler is what makes that a LIMIT rather than a wait: their crate has
// no field behind it and no clock on it, so there is always a board to play.
// And nothing anywhere expires, spoils or is lost by staying away — a friend
// who has restocked simply waits, however long it takes you to come back.
function closeStall() {
  const wait = noteStallSold(stallClock, stall, wallNow());
  // Written the moment it happens, like the discovery set: a stall that was
  // sold out and then forgotten by a reload would be a friend with two farms.
  if (wait) Arcade.state.set(STALLS_KEY, packStallClock(stallClock));
  refreshRestock();
}

// The game-over sheet's half of it: how long they will be, and what Again means
// while they are. Again never becomes a dead button — it becomes the way to
// somebody else's stall, which is the honest answer to "can I play more".
function refreshRestock() {
  const left = msUntilRestock(stallClock, stall, wallNow());
  const note = $('restock-note');
  note.hidden = left <= 0;
  note.textContent = left <= 0 ? ''
    : `${stallName(stall)} is picking again — another crate in ${countdown(left)}.`;
  $('again').textContent = left > 0 ? 'Another stall 换一摊' : 'Again 再来';
  if (left > 0) armClock();
}

// The countdown the map's cards wear.
function restockLabel(left) { return `Back in ${countdown(left)}`; }

// ── the clock on the two screens that have one ─────────────────────────────
// A countdown that only moves when you leave the screen and come back is not a
// countdown. One timer serves the map and the game-over sheet, it is armed only
// while one of them is showing a wait, and it is an Arcade session timer, so it
// stops with the app rather than running in a background tab.
const CLOCK_TICK_MS = 1000;
let clockTimer = null;

function armClock() {
  if (clockTimer) return;
  clockTimer = Arcade.session.setTimeout(tickClock, CLOCK_TICK_MS);
}

function stopClock() {
  if (clockTimer) { clockTimer.cancel(); clockTimer = null; }
}

function tickClock() {
  clockTimer = null;
  if (router.is('mode')) tickStallCards();
  else if (router.is('over')) refreshRestock();
}

// One second on the map. A card that is still waiting is relabelled in place; a
// card that has just come back is a different card — a door rather than a
// countdown — so the corner is rebuilt for it.
function tickStallCards() {
  const t = wallNow();
  for (const card of $('friends').children) {
    // A grower nobody has met is a silhouette with no line to write a clock on,
    // and no clock to write: skip it rather than rebuilding the corner at it
    // every second (a leftover clock for a stall that is no longer open would
    // otherwise never stop disagreeing with its own card).
    const line = card.querySelector('.seed-price');
    if (!line) continue;
    const left = msUntilRestock(stallClock, stallOf(Number(card.dataset.level)), t);
    if ((left > 0) !== (card.dataset.restocking === '1')) { buildStalls(); return; }
    if (left > 0) line.textContent = restockLabel(left);
  }
  if (anyRestocking()) armClock();
}

// Is anything on the map actually counting down? Asked of the cards rather than
// of the clock, so a stored wait for a stall that is not on the map (a campaign
// reset, a save from another device) cannot arm a timer with nothing to do.
function anyRestocking() {
  return [...$('friends').children].some((card) => card.dataset.restocking === '1');
}

// ── save plumbing ──────────────────────────────────────────────────────────
// Whose stall it was, and what is left of their crate, ride alongside
// js/game.js's payload rather than inside it: the game module owns a board, and
// the morning that feeds it is the host's — the same seam the market run keeps
// (js/campaign-save.js).
//
// Both fields are additive, and their absence means something exact. A save
// written before the cast existed resumes into 草莓's stall, which is where it
// was, since that was the only one there was. A save written before crates
// existed carries none, and an endless run is what it was — so it resumes as
// one, on the leaderboard it was already competing for.
function flushSave() {
  if (g.state === 'playing') {
    const board = serialize(g);
    board.friend = stall.level;       // nobody else holds it; no copy needed
    if (crate) board.crate = packCounts(crate);
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
    // Toppling is the pile getting away from you; the other two are the stall
    // being put away, and they get the market's own contented little cue.
    else if (ev.type === 'gameover') { sfx(ev.reason === 'toppled' ? 'game-over' : 'pack-up'); }
    pushEvent(fx, ev, tNow, settings.reducedMotion);
  }

  // A chain that finished this batch, and any fruit made here for the first
  // time ever. Both are read from the batch as a whole (js/progress.js), which
  // is why they live outside the per-event loop.
  const chain = deepestChain(g.events);
  if (chain >= 3) { showChainBanner(chain); cheer(fx, tNow, settings.reducedMotion); }
  const found = newDiscoveries(discovered, g.events);
  if (found.length) { commitDiscovered(found); queueDiscoveryCards(found); }

  const over = g.events.find((e) => e.type === 'gameover');
  g.events.length = 0;

  // The plank creaks once as the pile crosses the line — on the way IN, not
  // for as long as you are in trouble. Leaving and re-entering creaks again.
  const danger = g.state === 'playing' && inDanger(g);
  if (danger && !wasInDanger) sfx('warning');
  wasInDanger = danger;

  // Sold out: the crate and both hands are empty. Wait for the pile to stop
  // rolling first — a fruit still in the air might yet merge, and closing the
  // stall mid-chain would rob the player of the score. The endless stall never
  // reaches this at all, which is the whole of what makes it endless.
  if (g.state === 'playing' && isSoldOut(g)) {
    if (soldOutAt == null) soldOutAt = tNow;
    if (isSettled(g) || tNow - soldOutAt > SOLD_OUT_GRACE_MS) finish(g, 'sold-out');
  } else {
    soldOutAt = null;
  }

  if (hudStale) refreshHud();
  if (over) { endGame(over.reason); return; }

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
  if (!$('menu').hidden) { buildCollection(); if (!$('fruit').hidden) buildFruitSheet(); }
  if (!$('mode').hidden) refreshMap();
  if (!$('stall').hidden) buildStallSheet();
  if (!$('over').hidden) fillSummary();
  if (router.is('game')) refreshHud();
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

// How much of the foot of the canvas the counter bar is standing on, in CSS px,
// measured rather than declared: it is a rem-sized bar and the launcher's
// --font-scale moves it. Zero on the screens that have no counter — the farm,
// and every sheet — so nothing but a board ever reserves the band.
//
// The two counters are the same bar, so whichever is up answers for both; the
// board screens are the only ones where the number is ever used.
function counterBand() {
  const bar = [$('stall-counter'), $('market-counter')].find((el) => !el.hidden);
  if (!bar) return 0;
  const foot = canvas.getBoundingClientRect().bottom;
  return Math.max(0, foot - bar.getBoundingClientRect().top);
}

// One canvas, three views. Whoever is driving owns the transform, so a resize
// has to reach all of them and then repaint the one on screen. Routing to a
// board calls this too (see the router's onEnter hooks): the counter appearing
// changes how much canvas the world is allowed, and that is a resize in every
// sense except the window's.
function applyResize() {
  const band = counterBand();
  R.setBottomInset(band);
  market.setBottomInset(band);
  R.resize();
  farm.resize();
  market.resize();
  if (router.is('game')) { if (g.state === 'playing') loop.kick(); else drawIdle(); }
  else if (router.is('farm')) farmLoop.kick();
  else if (router.is('market')) marketLoop.kick();
}
window.addEventListener('resize', applyResize);

function drawIdle() { R.draw(g, settings, performance.now(), fx); }

// ── the collection book ────────────────────────────────────────────────────
// Real fruit, drawn by the real painter, one tile each, up the chain and off
// the bottom of the shelf — this is where a player learns what they are
// chasing. A fruit you have never MADE is a dimmed silhouette under a question
// mark (style.css does the dimming, so the painter stays the one painter and
// knows nothing about progress), and it is the one tile that does not open.
//
// Rebuilt every time the book comes up rather than once at boot, and painted
// only while its sheet is VISIBLE: a hidden sheet is display:none, and a chip
// canvas measured there has no CSS size to scale its backing store from.
function buildCollection() {
  const holder = $('collection');
  holder.textContent = '';
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const locked = isDiscoverable(level) && !discovered.has(level);
    holder.appendChild(locked
      ? lockedTile(level)
      : fruitTile({ level, onPick: () => { sfx('menu-click'); openFruit(level); } }));
  }
  // How far through the book they are. Level 1 falls out of the dropper and was
  // never anybody's achievement, so the count is of what can be MADE.
  const made = [...discovered].filter(isDiscoverable).length;
  $('collection-count').textContent = `${made} of ${MAX_LEVEL - 1} made · 图鉴`;
  paintCardsIn(holder);
}

// ── one fruit, in full ─────────────────────────────────────────────────────
// A drawer over the book (js/collection.js builds what it says): the fruit at
// card size, where it sits in the chain, and every number the tables know about
// it — what it scores, what a merchant pays, how it is grown and what a seed
// costs. The campaign's own numbers are read, never written; free play has
// always been allowed to look at the campaign, and this screen is a book.
let inspecting = null;

function openFruit(level) {
  inspecting = level;
  $('fruit').hidden = false;
  buildFruitSheet();
}

function closeFruit() {
  inspecting = null;
  $('fruit').hidden = true;
}

function buildFruitSheet() {
  if (inspecting == null) return;
  const level = inspecting;
  const f = FRUITS[level - 1];
  const c = campaignSave.get();
  const farmed = hasFarm(c);

  $('fruit-name').textContent = f.name;
  $('fruit-alt').textContent = `${f.hanzi} ${f.pinyin}`;
  $('fruit-chain').textContent = chainNote(level);

  const dl = $('fruit-stats');
  dl.textContent = '';
  for (const [label, value] of fruitStats(level, { seeds: seedCount(c, level), hasFarm: farmed })) {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    row.append(dt, dd);
    dl.appendChild(row);
  }

  // The one line that is about this player rather than about this fruit: the
  // right to PLANT a level is earned by merging one at market, and the seed
  // drawer is where that shows up. Nothing to say to a player with no farm.
  const note = $('fruit-note');
  const plantable = farmed && !isUnlocked(c, level);
  note.hidden = !plantable;
  note.textContent = plantable ? 'Merge one at the market to earn the right to plant it.' : '';

  // Along the chain, skipping what has not been made — the neighbours are the
  // two fruit anybody looking at this one is about to ask about.
  const prev = nextInspectable(level, -1);
  const next = nextInspectable(level, 1);
  setNav($('fruit-prev'), prev, '‹ Smaller');
  setNav($('fruit-next'), next, 'Bigger ›');

  paintChip($('fruit-art'), level, 0.34);   // the sheet is up, so it has a size
}

function setNav(button, level, fallback) {
  button.disabled = level == null;
  button.textContent = level == null ? fallback
    : (fallback.startsWith('‹') ? `‹ ${FRUITS[level - 1].name}` : `${FRUITS[level - 1].name} ›`);
  button.dataset.level = level == null ? '' : String(level);
}

function nextInspectable(from, step) {
  for (let level = from + step; level >= 1 && level <= MAX_LEVEL; level += step) {
    if (!isDiscoverable(level) || discovered.has(level)) return level;
  }
  return null;
}

// ── whose stall to mind ────────────────────────────────────────────────────
// The stalls' corner of the map. One card each, on the seed-card idiom the shop
// and the plot picker already use (js/cards.js): the real fruit, its name, and
// the one word that says how the stall is stocked. Friends whose seed has not
// been earned in a campaign run are dashed silhouettes under the same hint the
// shop gives, because it is the same rule.
//
// The wholesaler leads, always open and always endless, so there is never a
// menu of one and never a launch with nothing to play. Rebuilt every time the
// map comes up, exactly like the collection, so the grape you unlocked at market
// this evening is live by the time you look.
//
// A friend whose morning you already sold wears the wait instead of the offer:
// greyed, with the countdown where the flavour word goes. Greyed rather than
// hidden, as everywhere — a stall you cannot open yet is a reason to come back,
// and the door beside it (the wholesaler's) is always open.

function buildStalls() {
  const holder = $('friends');
  const c = campaignSave.get();
  const open = openFriends(c);
  const t = wallNow();
  holder.textContent = '';
  $('friends-hint').hidden = open.length === FRIENDS.length;

  for (const s of STALLS) {
    const known = s === WHOLESALER || open.includes(s);
    if (!known) {
      holder.appendChild(lockedCard(s.level, 'A grower you have not met — merge one at the market'));
      continue;
    }
    const left = msUntilRestock(stallClock, s, t);
    const card = fruitCard({
      level: s.level, title: s.title, alt: s.alt,
      meta: left > 0 ? restockLabel(left) : s.flavor,
      note: left > 0 ? 'Picking again 收成中'
        : (isEndless(s) ? 'Endless crate' : `${crateSizeOf(s)} fruit`),
      enabled: left <= 0,
      onPick: () => { sfx('menu-click'); openStall(s); },
    });
    if (left > 0) card.dataset.restocking = '1';
    holder.appendChild(card);
  }
  paintCardsIn(holder);          // the sheet is up now, so the chips have a size
  if (anyRestocking()) armClock();
}

// ── the launch window ──────────────────────────────────────────────────────
// What is in today's crate, before you commit to selling it. A friend's produce
// is picked fresh each time you knock (js/friends.js §stockCrate), so this is
// genuinely today's — and it is the one thing worth knowing before you choose
// whose morning to spend: a crate of cherries is a long patient day and a crate
// of persimmons is a short loud one.
//
// It is a screen rather than a drawer because the map is behind it and there is
// nothing to see through to.

let pending = null;      // { stall, crate } — the offer currently on screen

function openStall(s) {
  // The card is already greyed while they are picking; this is the same rule
  // said where the crate is actually taken, so no path can knock on a stall
  // that has nothing in it.
  if (msUntilRestock(stallClock, s, wallNow()) > 0) return;
  pending = { stall: s, crate: stockCrate(s, rng) };
  router.route('stall');
}

function buildStallSheet() {
  if (!pending) return;
  const { stall: s, crate: stock } = pending;
  // English on the line you read, both languages on the line under it — the
  // card idiom, and it keeps the title to one line at any font scale.
  $('stall-title').textContent = `${stallName(s)}'s crate`;
  $('stall-alt').textContent = `${stallAlt(s)} · ${s.flavor}`;

  const holder = $('stall-crate');
  holder.textContent = '';
  const cells = stock
    ? levelsIn(stock).map((level) => [level, `×${countOf(stock, level)}`])
    : [[s.level, '∞']];
  for (const [level, caption] of cells) {
    const cell = document.createElement('figure');
    cell.className = stock ? 'crate-chip' : 'crate-chip endless';
    const art = document.createElement('canvas');
    art.className = 'chip-art';
    art.setAttribute('role', 'img');
    art.setAttribute('aria-label', FRUITS[level - 1].name);
    const cap = document.createElement('figcaption');
    cap.textContent = caption;
    cell.append(art, cap);
    holder.appendChild(cell);
    paintChip(art, level, 0.3);
  }

  // One line, and it is the deal: what you are selling, and what it is worth to
  // you. Both halves are true of the wholesaler too — an endless crate is stock
  // somebody fronted you, and they take their share of it like anybody else.
  $('stall-note').textContent = stock
    ? `${totalCount(stock)} fruit to sell — they split the day's till with you`
    : 'A crate that never empties — they split the day\'s till with you';
}

function launchStall() {
  if (!pending) { router.route('mode'); return; }
  const { stall: s, crate: stock } = pending;
  pending = null;
  beginGame(false, s, stock);
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
  // …and the same on the market's board: enter, then re-fit around the counter.
  .add('market', {
    chrome: [$('market-hud'), $('market-counter')],
    onEnter: (from) => { market.enter(from); applyResize(); },
    onExit: market.exit,
  })
  .add('appraisal', { sheet: $('appraisal') });

// The map, brought up to date on every look — same discipline as the farm:
// no timers, every spot derived from campaign state right now. A place you
// cannot go yet is greyed rather than hidden, the shop's own rule.
function refreshMap() {
  const c = campaignSave.get();
  const owned = hasFarm(c);

  // 🌱 on the farm until the player owns it — the one nudge in the game, and
  // it retires the moment it has been acted on.
  $('campaign-badge').hidden = owned;
  $('farm-note').textContent = owned
    ? `Cash ${money(c.cash)}元`
    : `For sale — ${money(priceOfEquipment('farm'))}元`;

  // The market needs something in the crate; the shop needs ground to plant.
  const crate = crateSize(c);
  $('map-crate').textContent = String(crate);
  $('map-market').disabled = !canGoToMarket(c);
  $('map-shop').disabled = !owned;

  // The same quiet 🍓 the farm's map button wears: an empty crate and nothing
  // ripening soon means a friend could use a hand, and here the friends are.
  $('friends-badge').hidden = !couldUseAHand(c, wallNow());

  // The opening, said in one line under the map instead of left to be guessed.
  const hint = $('map-hint');
  if (c.phase === 'gift-run') {
    hint.textContent = 'A friend left you a crate of fruit. Sell it at the market — merging pairs pays best.';
    hint.hidden = false;
  } else if (c.phase === 'buy-farm') {
    hint.textContent = 'The farm up the mountain is for sale. Tap it to take a look.';
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }

  buildStalls();
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
$('map-market').addEventListener('click', () => { sfx('menu-click'); toMarket(); });
// The shop is a drawer over the farm, so the map walks there and opens it —
// one tap, and the player still sees where the shop lives.
$('map-shop').addEventListener('click', () => {
  sfx('menu-click');
  if (!hasFarm(campaignSave.get())) return;
  router.route('farm');
  farm.openShop();
});
// The launch window: take the crate, or put it back and go somewhere else.
$('stall-open').addEventListener('click', () => { sfx('menu-click'); launchStall(); });
for (const id of ['stall-back', 'stall-x']) {
  $(id).addEventListener('click', () => { sfx('menu-click'); pending = null; router.route('mode'); });
}
$('to-collection').addEventListener('click', () => { sfx('menu-click'); router.route('menu'); });
// The book's drawer: two ways to shut it, and two ways along the chain without
// shutting it at all.
for (const id of ['fruit-x', 'fruit-close']) {
  $(id).addEventListener('click', () => { sfx('menu-click'); closeFruit(); });
}
for (const id of ['fruit-prev', 'fruit-next']) {
  $(id).addEventListener('click', () => {
    const level = Number($(id).dataset.level);
    if (!level) return;
    sfx('menu-click');
    openFruit(level);
  });
}
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

// ── the stall's own buttons ────────────────────────────────────────────────
// Packing up is the deliberate ending, and it is the smart one: it earns the
// Tidy Stall on the friend's split, exactly as it does on a market day.
$('stall-pack-up').addEventListener('click', () => { sfx('menu-click'); finish(g, 'packed'); });
// Again 再来 is the same stall with a fresh morning behind it — a crate is a
// day's picking, and yesterday's is sold. While that friend is picking the next
// one there is no morning to hand over, so the same button goes to the map,
// where the wholesaler is always open. One button, never a dead one.
$('again').addEventListener('click', () => {
  sfx('menu-click');
  if (msUntilRestock(stallClock, stall, wallNow()) > 0) {
    g.state = 'menu';
    show('mode');
    return;
  }
  beginGame(false, stall, stockCrate(stall, rng));
});
$('to-menu').addEventListener('click', () => {
  sfx('menu-click');
  g.state = 'menu';
  show('mode');            // back to the map — the one place everything is
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
  closeFruit();
  stopClock();
  const rec = Arcade.records.get('high-score');
  best = rec && typeof rec.value === 'number' ? rec.value : 0;
  loadDiscovered();
  // Who is still picking. Read as defensively as the crate is (js/friends.js
  // §unpackStallClock): a clock we cannot believe is an open stall.
  stallClock = unpackStallClock(Arcade.state.get(STALLS_KEY));

  const where = bootScreen({
    marketSave: campaignSave.readMarket(),
    freePlaySave: Arcade.state.get(SAVE_KEY),
  });

  if (where === 'market' && market.resume()) {
    router.route('market');
    return;
  }

  const save = Arcade.state.get(SAVE_KEY);
  // Back to the stall you were minding, with what was left of their crate.
  // `stallOf` answers with 草莓 for anything it does not recognise, including
  // the saves written before there was a cast — which is where those runs were,
  // because it was the only stall there was — and a save with no crate on it is
  // an endless run, which is what every one of those was too.
  //
  // The stall goes back BEFORE the board does: js/game.js asks whether this game
  // can run out before it will believe a save with an empty hand in it.
  if (where !== 'mode' && save) setStall(stallOf(save.friend), save.crate ? unpackCounts(save.crate) : null);
  if (where !== 'mode' && save && restore(g, save)) {
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
bootFromState();          // reads the discovery set, then show() builds the book
// Real state on every boot (also what proves the storage bridge in the
// acceptance checklist — the first save write otherwise waits for gameplay).
Arcade.stats.update('session', (p) => ({ launches: ((p && p.launches) || 0) + 1 }));

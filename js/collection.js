// The collection book: every fruit as a tile, and one fruit in full.
//
// The book used to be a single line of chips with arrows between them — a
// picture of the chain, which is what it was for, but nothing to LOOK at. A
// player learning eleven fruit spends more time here than anywhere else in the
// DOM, and every number about a fruit already exists in js/constants.js: what
// it scores, what a merchant pays for it, how it is grown, how long it takes
// and what a seed costs. None of it was ever on screen in one place.
//
// So the book is tiles now, and a tile opens. This module is the two halves of
// that: `fruitStats` is the sheet's contents as data — pure, no DOM, so what a
// fruit's page SAYS is testable without a browser — and the tile builders are
// DOM in the register js/cards.js already speaks (the same `.chip-art` canvas
// and `data-level`, so js/cards.js §paintCardsIn paints these too).
//
// One rule it inherits from the chart it replaces: a fruit you have never MADE
// is a silhouette under a question mark, and it does not open. The mystery is
// the reason to go and get the pear, and a page of stats about a fruit the
// player has never seen would spend it for nothing.

import {
  FRUITS, MAX_LEVEL, ANNIHILATE_SCORE, scoreOf, bounceOf, farmOf, isPerennial,
  growthOf, cycleOf, yieldOf, seedCostOf,
} from './constants.js';
import { mergeValue } from './economy.js';
import { money, span } from './format.js';

// How a plot of it is worked, in the shop's own words.
const KINDS = {
  bed: 'Bed 苗床',
  tree: 'Tree 果树',
  vine: 'Vine 藤架',
};

// `bounce` is a fruit's personality in one number (js/constants.js), and the
// number itself is a coefficient of restitution — true, and not what anybody
// wants to read on a card. These are the same fact in the language the rest of
// the book is written in.
function bounceWord(level) {
  const b = bounceOf(level);
  if (b >= 0.42) return 'Springy 弹';
  if (b >= 0.30) return 'Lively 活';
  if (b >= 0.20) return 'Soft 软';
  return 'Heavy 沉';
}

/**
 * Where this fruit sits in the chain, in one sentence.
 *
 * The chart said this with arrows. A sentence says it better for the fruit the
 * player is actually looking at, and it is the one thing on the page that is
 * about the game rather than about the fruit.
 */
export function chainNote(level) {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return '';
  const below = level > 1 ? FRUITS[level - 2] : null;
  const above = level < MAX_LEVEL ? FRUITS[level] : null;
  const from = below
    ? `Two ${below.name} ${below.hanzi} merge into one.`
    : 'Falls from the dropper — the first link in the chain.';
  const to = above
    ? `Two of these make a ${above.name} ${above.hanzi}.`
    : `Two of these annihilate — the ultimate merge, +${ANNIHILATE_SCORE}.`;
  return `${from} ${to}`;
}

/**
 * One fruit's page, as rows.
 *
 * Pure: the campaign's own numbers arrive as arguments rather than being read
 * out of a save here, which keeps this module honest for free play (where there
 * may be no campaign at all) and testable without one.
 *
 *   seeds    how many of that seed are in the drawer
 *   hasFarm  is there a farm for any of that to matter to
 *
 * The farm rows show whether or not there is a farm, because the book is the
 * book of the whole game — what a peach tree costs is worth knowing before you
 * own the ground. Only the drawer count waits for a farm to exist.
 */
export function fruitStats(level, { seeds = 0, hasFarm = false } = {}) {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return [];
  const f = FRUITS[level - 1];
  const perennial = isPerennial(level);
  const rows = [
    ['Score 分数', `+${money(scoreOf(level))}`],
    ['At market 市场', `${money(mergeValue(level))}元`],
    ['Size 大小', `×${f.scale}`],
    ['Bounce 弹性', bounceWord(level)],
    ['Grows 种法', KINDS[farmOf(level).kind] || '—'],
    ['First crop 头茬', span(growthOf(level))],
  ];
  if (perennial) rows.push(['Then every 周期', span(cycleOf(level))]);
  rows.push([`Harvest 收成`, `×${yieldOf(level)}`]);
  rows.push([perennial ? 'Sapling 树苗' : 'Seed 种子', `${money(seedCostOf(level))}元`]);
  if (hasFarm) rows.push(['In the drawer 抽屉', `×${seeds}`]);
  return rows;
}

/**
 * One fruit, as something to press. The tile idiom: rank, the real fruit, its
 * name in both languages, and what making one scores.
 *
 * Deliberately NOT js/cards.js §fruitCard: a seed card's job is a price and a
 * decision, and a tile's is a specimen in a book. They share the chip canvas and
 * the `--fruit` tint so the two grids read as the same game.
 */
export function fruitTile({ level, onPick }) {
  const f = FRUITS[level - 1];
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.className = 'fruit-tile';
  cell.style.setProperty('--fruit', f.color);
  cell.innerHTML =
    '<span class="tile-rank"></span>' +
    '<canvas class="chip-art" role="img"></canvas>' +
    '<span class="tile-name"></span><span class="tile-alt"></span>' +
    '<span class="tile-score"></span>';
  cell.querySelector('.tile-rank').textContent = String(level);
  cell.querySelector('.tile-name').textContent = f.name;
  cell.querySelector('.tile-alt').textContent = `${f.hanzi} ${f.pinyin}`;
  cell.querySelector('.tile-score').textContent = `+${scoreOf(level)}`;
  cell.querySelector('.chip-art').setAttribute('aria-label', f.name);
  cell.setAttribute('aria-label', `${f.name} ${f.hanzi} ${f.pinyin}, scores ${scoreOf(level)}`);
  if (onPick) cell.addEventListener('click', onPick);
  cell.dataset.level = String(level);
  return cell;
}

/**
 * One fruit you have never made.
 *
 * A figure, not a button — there is nothing to open, so there is nothing to tab
 * to either. The painter draws the real fruit and knows nothing about progress;
 * style.css flattens it to a silhouette, the same treatment (and the same
 * class) the shop's locked seeds wear.
 */
export function lockedTile(level) {
  const cell = document.createElement('figure');
  cell.className = 'fruit-tile locked';
  cell.innerHTML =
    '<span class="tile-rank"></span>' +
    '<canvas class="chip-art" role="img" aria-label="Undiscovered fruit"></canvas>' +
    '<span class="tile-name">?</span>';
  cell.querySelector('.tile-rank').textContent = String(level);
  cell.setAttribute('aria-label', `Fruit ${level} — not yet made`);
  cell.dataset.level = String(level);
  return cell;
}

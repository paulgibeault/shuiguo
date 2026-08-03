// The fruit card, in one place.
//
// A real fruit at its best, what it is called in both languages, and one line
// of whatever the card is FOR — a price in the shop, a count in the plot
// picker, a flavour word in the chooser of friends. Three surfaces wanted the
// same card, and the third one is what made it worth extracting: a picker that
// looked nearly like the shop would be worse than one that looked nothing like
// it.
//
// It carries the bilingual name for the same reason the discovery cards do:
// this is a game about learning eleven fruit, and these grids are where a
// player spends the most time reading. The card also wears the fruit's OWN
// colour as a custom property the stylesheet mixes into its border and wash, so
// a grid reads as a row of specific fruit rather than a row of boxes — and the
// one table that decides what a cherry looks like stays js/constants.js.
//
// DOM only. The chip canvases are deliberately NOT painted here: a canvas
// measures 0 while its sheet is display:none, so every caller paints its own
// cards once its own sheet is actually up (see paintCardsIn below).

import { FRUITS } from './constants.js';
import { paintChip } from './chips.js';

/**
 * One fruit, as something to press.
 *
 * Unaffordable and unavailable cards are greyed, never hidden — seeing what you
 * cannot have yet is most of the reason to go and earn it.
 *
 *   level    which fruit
 *   meta     the one number or word this card is about
 *   enabled  false greys it and takes it out of the tab order
 *   onPick   what pressing it does
 *   note     a second, quieter line (held counts, flavour)
 */
export function fruitCard({ level, meta = '', enabled = true, onPick, note = '' }) {
  const f = FRUITS[level - 1];
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.className = enabled ? 'seed-card' : 'seed-card off';
  cell.disabled = !enabled;
  cell.style.setProperty('--fruit', f.color);
  cell.innerHTML =
    '<canvas class="chip-art" role="img"></canvas>' +
    '<span class="seed-hanzi"></span><span class="seed-pinyin"></span>' +
    '<span class="seed-en"></span><span class="seed-price"></span>' +
    '<span class="seed-held"></span>';
  cell.querySelector('.seed-hanzi').textContent = f.hanzi;
  cell.querySelector('.seed-pinyin').textContent = f.pinyin;
  cell.querySelector('.seed-en').textContent = f.name;
  cell.querySelector('.seed-price').textContent = meta;
  cell.querySelector('.seed-held').textContent = note;
  cell.querySelector('.chip-art').setAttribute('aria-label', f.name);
  cell.setAttribute('aria-label', `${f.name} ${f.hanzi} ${f.pinyin}${meta ? `, ${meta}` : ''}`);
  if (onPick) cell.addEventListener('click', onPick);
  cell.dataset.level = String(level);
  return cell;
}

/**
 * One fruit you have not earned yet.
 *
 * A figure, not a button: there is nothing to click, so there is nothing to tab
 * to either. The chip painter draws the real fruit and knows nothing about
 * progress — style.css flattens it to a silhouette, the same treatment (and the
 * same class) the menu's collection chart uses.
 */
export function lockedCard(level, label) {
  const cell = document.createElement('figure');
  cell.className = 'seed-card locked';
  cell.innerHTML =
    '<canvas class="chip-art" role="img" aria-label="Undiscovered fruit"></canvas>' +
    '<span class="seed-hanzi">?</span>';
  cell.setAttribute('aria-label', label);
  cell.dataset.level = String(level);
  return cell;
}

/** Paint every card in a holder. Call it only while the holder is visible. */
export function paintCardsIn(holder, share = 0.3) {
  for (const cell of holder.children) {
    const art = cell.querySelector('.chip-art');
    if (art) paintChip(art, Number(cell.dataset.level), share);
  }
}

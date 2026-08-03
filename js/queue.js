// The line of fruit coming up, drawn along the rail.
//
// The NEXT preview used to be one fruit in a box in the header. It is
// js/game.js §QUEUE_DEPTH deep now, because a stall with a finite crate is
// something you PLAN against, and you cannot plan against one fruit. A row of
// small icons, biggest first and fading into the future, running the full width
// of the fascia under the score.
//
// DOM only, and the same chip painter as everything else (js/chips.js), so the
// pear up here is recognisably the pear that lands down there. Both hosts share
// it: free play and a market day differ in what stocks the queue, never in what
// the queue looks like.
//
// Canvases are sized from CSS, which follows the launcher's --font-scale, so
// this must be called while its own strip is actually visible — a display:none
// canvas measures 0 and would scale its backing store from nothing.

import { FRUITS } from './constants.js';
import { paintChip } from './chips.js';

// How much of each icon the fruit fills. A touch smaller than a card's chip:
// accessories (a pineapple crown, a cherry stem) have to fit in a 1.5rem box.
const SHARE = 0.32;

/**
 * Repaint one queue strip.
 *
 * `levels` is js/game.js's queue, head first — empty is a legitimate state (the
 * crate ran dry) and draws nothing at all rather than a row of blanks.
 * `label`, when given, gets the head fruit's bilingual name: the queue says
 * WHAT is coming and the label says what it is CALLED, which is the same
 * bilingual-learning job the one-fruit preview had.
 */
export function renderQueue(holder, levels, label) {
  holder.textContent = '';
  levels.forEach((level, i) => {
    const f = FRUITS[level - 1];
    if (!f) return;
    const art = document.createElement('canvas');
    art.className = i === 0 ? 'queue-chip head' : 'queue-chip';
    art.setAttribute('role', 'img');
    art.setAttribute('aria-label', i === 0 ? `Next: ${f.name}` : `Then: ${f.name}`);
    holder.appendChild(art);
    paintChip(art, level, SHARE);      // after append: clientWidth is the CSS size
  });
  if (!label) return;
  const head = levels.length ? FRUITS[levels[0] - 1] : null;
  label.textContent = head ? `${head.name} ${head.hanzi}` : '';
}

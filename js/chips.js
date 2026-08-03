// One fruit, alone and centred, filling a small square canvas.
//
// Extracted from js/main.js because four different surfaces now want it: the
// NEXT preview, the menu's evolution chart, the farm shop's seed cards, and the
// crate strip on the appraisal sheet. It is the SAME painter the board uses
// (js/fruit-art.js), which is the whole point — a fruit is recognisably itself
// everywhere in the game, at every size.
//
// Canvases here are sized from CSS, which follows the launcher's --font-scale,
// so every caller has to re-paint on a settings change and has to do it while
// its own sheet is VISIBLE: a display:none canvas measures 0 and would scale
// its backing store from nothing.

import { radiusOf } from './constants.js';
import { paintFruit } from './fruit-art.js';

const DEFAULT_SIZE = 44;

/**
 * Set a chip canvas up and hand its context to `draw(ctx, size)`.
 *
 * The origin is dropped a little below centre before `draw` is called:
 * accessories grow upward, so a pineapple crown or a cherry stem would
 * otherwise clip out of the top of the box.
 */
export function withChip(el, draw) {
  const ctx = el.getContext('2d');
  const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
  const size = el.clientWidth || DEFAULT_SIZE;
  const px = Math.round(size * dpr);
  if (el.width !== px) { el.width = px; el.height = px; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size * 0.56);
  draw(ctx, size);
  ctx.restore();
}

/**
 * Paint one fruit into a chip canvas.
 *
 * `share` is the fruit's radius as a fraction of the canvas: it must leave room
 * for the accessories, which reach past r (see ART.maxExtent in fruit-art.js).
 */
export function paintChip(el, level, share) {
  withChip(el, (ctx, size) => {
    const worldR = radiusOf(level);
    const k = (size * share) / worldR;
    ctx.scale(k, k);
    paintFruit(ctx, level, worldR);
  });
}

// Input for shuǐ guǒ tān (GRD §4): touch/drag anywhere aims the dropper along its
// line; release drops. A tap snaps the dropper to that x and drops. Keyboard
// (arrows + space) is a first-class citizen too — cheap, and it makes the
// game playable with a screen reader's focus on the canvas.
//
// Release always drops at the LAST AIMED x, never at the release point: on a
// touch screen the finger rolls a few pixels on lift-off, and a drop that
// drifts from where you lined it up feels like the game cheated you.
//
// TWO HOSTS, ONE CANVAS. Free play and the campaign's market run share the
// board, so the binding is made ONCE and asks an adapter which game — if any —
// is currently being driven. Binding twice would give every drag two dropped
// fruit; asking each frame means the farm screen, the menus and the appraisal
// all correctly receive nothing at all.

import { aim, drop } from './game.js';

// Cancel gesture: pull down and let go to put the fruit back. Both conditions
// must hold so a normal aim-drag near the bottom of the board can't cancel by
// accident — you have to travel 80 px down AND end up in the bottom quarter.
const CANCEL_DROP_PX = 80;
const CANCEL_ZONE = 0.75;

/**
 * adapter: {
 *   game()          the game being driven right now, or null
 *   toWorldX(px)    that game's view transform
 *   onDropped(g)    optional, after a successful drop
 *   onInput()       optional, the moment input reaches a live board
 * }
 *
 * `onInput` exists because under power saver a settled board stops rendering
 * altogether (GAME_INTEGRATION §6d) — so the aim that moves the ghost and the
 * release that drops the fruit both have to bring the loop back before they
 * change anything. It fires for aiming as well as for dropping: sliding the
 * dropper across a stopped board is a visible change with no event of its own.
 */
export function bindInput(canvas, adapter) {
  let pointerDown = false;
  let downY = 0;

  // The game only if it is actually take-able input: a finished board and a
  // sold-out dropper both correctly refuse, inside js/game.js.
  const active = () => {
    const g = adapter.game();
    return g && g.state === 'playing' ? g : null;
  };

  // Every handler below that is about to touch a live board calls this first.
  const woke = () => { if (adapter.onInput) adapter.onInput(); };

  const tryDrop = (g) => {
    if (drop(g) && adapter.onDropped) adapter.onDropped(g);
  };

  // A release that reads as "never mind" — dragged well down the board, or
  // let go outside the canvas entirely (pointer capture keeps delivering it).
  const isCancel = (e) => {
    const rect = canvas.getBoundingClientRect();
    const outside =
      e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top || e.clientY > rect.bottom;
    if (outside) return true;
    return e.clientY - downY > CANCEL_DROP_PX &&
           e.clientY > rect.top + rect.height * CANCEL_ZONE;
  };

  canvas.addEventListener('pointerdown', (e) => {
    const g = active();
    if (!g) return;
    woke();
    pointerDown = true;
    downY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    aim(g, adapter.toWorldX(e.clientX));
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    const g = active();
    if (!pointerDown || !g) return;
    woke();
    aim(g, adapter.toWorldX(e.clientX));
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!pointerDown) return;
    pointerDown = false;
    const g = active();
    if (!g) return;
    woke();
    if (isCancel(e)) return;          // aim is kept; nothing is dropped
    tryDrop(g);
  });

  canvas.addEventListener('pointercancel', () => { pointerDown = false; });

  canvas.addEventListener('keydown', (e) => {
    const g = active();
    if (!g) return;
    woke();
    const step = e.shiftKey ? 24 : 8;
    if (e.key === 'ArrowLeft')       { aim(g, g.dropX - step); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { aim(g, g.dropX + step); e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') {
      tryDrop(g);
      e.preventDefault();
    }
  });
}

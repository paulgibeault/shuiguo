// Input for shuǐ guǒ tān (GRD §4): touch/drag anywhere aims the dropper along its
// line; release drops. A tap snaps the dropper to that x and drops. Keyboard
// (arrows + space) is a first-class citizen too — cheap, and it makes the
// game playable with a screen reader's focus on the canvas.
//
// Release always drops at the LAST AIMED x, never at the release point: on a
// touch screen the finger rolls a few pixels on lift-off, and a drop that
// drifts from where you lined it up feels like the game cheated you.

import { aim, drop } from './game.js';

// Cancel gesture: pull down and let go to put the fruit back. Both conditions
// must hold so a normal aim-drag near the bottom of the board can't cancel by
// accident — you have to travel 80 px down AND end up in the bottom quarter.
const CANCEL_DROP_PX = 80;
const CANCEL_ZONE = 0.75;

export function bindInput(canvas, g, toWorldX, onDropped) {
  let pointerDown = false;
  let downY = 0;

  const tryDrop = () => {
    if (drop(g)) onDropped();
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
    if (g.state !== 'playing') return;
    pointerDown = true;
    downY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    aim(g, toWorldX(e.clientX));
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointerDown || g.state !== 'playing') return;
    aim(g, toWorldX(e.clientX));
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!pointerDown) return;
    pointerDown = false;
    if (g.state !== 'playing') return;
    if (isCancel(e)) return;          // aim is kept; nothing is dropped
    tryDrop();
  });

  canvas.addEventListener('pointercancel', () => { pointerDown = false; });

  canvas.addEventListener('keydown', (e) => {
    if (g.state !== 'playing') return;
    const step = e.shiftKey ? 24 : 8;
    if (e.key === 'ArrowLeft')       { aim(g, g.dropX - step); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { aim(g, g.dropX + step); e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') {
      tryDrop();
      e.preventDefault();
    }
  });
}

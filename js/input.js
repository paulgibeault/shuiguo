// Input for shuǐguǒ (GRD §4): touch/drag anywhere aims the dropper along its
// line; release drops. A tap snaps the dropper to that x and drops. Keyboard
// (arrows + space) is a first-class citizen too — cheap, and it makes the
// game playable with a screen reader's focus on the canvas.

import { aim, drop } from './game.js';

export function bindInput(canvas, g, toWorldX, onDropped) {
  let pointerDown = false;
  let movedFar = false;
  let downX = 0;

  const tryDrop = (worldX) => {
    if (drop(g, worldX)) onDropped();
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (g.state !== 'playing') return;
    pointerDown = true;
    movedFar = false;
    downX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
    aim(g, toWorldX(e.clientX));
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointerDown || g.state !== 'playing') return;
    if (Math.abs(e.clientX - downX) > 6) movedFar = true;
    aim(g, toWorldX(e.clientX));
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!pointerDown) return;
    pointerDown = false;
    if (g.state !== 'playing') return;
    // drag-release and tap both drop at the released x (GRD: tap snaps & drops)
    tryDrop(toWorldX(e.clientX));
  });

  canvas.addEventListener('pointercancel', () => { pointerDown = false; });

  canvas.addEventListener('keydown', (e) => {
    if (g.state !== 'playing') return;
    const step = e.shiftKey ? 24 : 8;
    if (e.key === 'ArrowLeft')       { aim(g, g.dropX - step); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { aim(g, g.dropX + step); e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') {
      tryDrop(undefined);
      e.preventDefault();
    }
  });
}

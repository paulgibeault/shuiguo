// The renderer is composition, not artwork, and almost all of it is pinned
// elsewhere: the fruit by tests/fruit-art, the stall by tests/scene, the juice
// by its closed-form readers. What is only here is the CONFIGURATION the hosts
// hand it — and there is exactly one piece of that, because the rule is that
// this file never learns what a mode is.
//
// The friend on the plank is that piece. A host says "somebody is minding this
// stall"; the renderer draws a fruit on the scene's perch and knows nothing
// else about why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './fake-dom.js';
import { makeRenderer } from '../js/render.js';
import { makeGame, start } from '../js/game.js';
import { makeRng } from '../js/arcade-rng.js';
import { makeEffects, resetEffects, cheer, isCheering, FX } from '../js/effects.js';
import { FRIENDS } from '../js/constants.js';

const FRIEND_LEVEL = FRIENDS[0].level;

// The recording context is tests/fake-dom's — a painter that starts calling a
// new ctx method should fail in one place, not four.
function stubCanvas() {
  const ctx = makeCtx();
  return { width: 400, height: 700, getContext: () => ctx, ctx };
}

function idleGame() {
  const g = makeGame({ rng: makeRng(9), now: () => 0 });
  start(g);
  g.events.length = 0;
  return g;
}

function paintCount(R, g, settings, tMs, ctx) {
  const before = ctx.calls.length;
  R.draw(g, settings, tMs);
  return ctx.calls.length - before;
}

for (const theme of ['light', 'dark']) {
  test(`a friend on the plank is drawn in ${theme} theme, and only when one is set`, () => {
    const canvas = stubCanvas();
    const R = makeRenderer(canvas);
    const g = idleGame();
    const settings = { theme, fontScale: 1, reducedMotion: false };

    const empty = paintCount(R, g, settings, 1000, canvas.ctx);
    R.setPerch(FRIEND_LEVEL);
    const minded = paintCount(R, g, settings, 1000, canvas.ctx);
    assert.ok(minded > empty, `nobody appeared on the plank in ${theme} theme`);

    R.setPerch(null);
    assert.equal(paintCount(R, g, settings, 1000, canvas.ctx), empty,
      'the friend stayed after the stall stopped being theirs');
  });
}

// Present and still, not absent: the friend is who the board belongs to, and
// removing them under reduced motion would remove the fiction rather than the
// motion. What goes is the blinking and the cheer.
test('a perched friend is still there under reduced motion', () => {
  const canvas = stubCanvas();
  const R = makeRenderer(canvas);
  const g = idleGame();
  const still = { theme: 'light', fontScale: 1, reducedMotion: true };

  const empty = paintCount(R, g, still, 0, canvas.ctx);
  R.setPerch(FRIEND_LEVEL);
  assert.ok(paintCount(R, g, still, 0, canvas.ctx) > empty, 'reduced motion took the friend away');
});

// The cheer is a face, and a face that changes is motion however brief. It is
// turned away at js/effects.js's door like everything else that moves, so under
// reduced motion there is nothing for the renderer to suppress.
test('a cheer never gets past the door under reduced motion', () => {
  const fx = makeEffects();
  cheer(fx, 0, true);
  assert.equal(fx.cheeredAt, null, 'a cheer got through reduced motion');
  assert.ok(!isCheering(fx, 10));

  cheer(fx, 0, false);
  assert.ok(isCheering(fx, 10), 'a cheer was not recorded at all');
  assert.ok(!isCheering(fx, FX.cheerMs + 1), 'the pleased face never wore off');
});

// The mood lives on the effects list with every other decaying visual, so it is
// cleared by the one reset path rather than by a second, narrower channel —
// walking into 葡萄's stall must not find them already delighted about a chain
// somebody else's board made.
test('starting a run clears the last stall\'s mood along with its juice', () => {
  const canvas = stubCanvas();
  const R = makeRenderer(canvas);
  const g = idleGame();
  const settings = { theme: 'light', fontScale: 1, reducedMotion: false };
  const fx = makeEffects();

  R.setPerch(FRIEND_LEVEL);
  cheer(fx, 0, false);
  resetEffects(fx);
  assert.equal(fx.cheeredAt, null, 'the mood outlived the run it belonged to');

  R.setPerch(6);
  R.draw(g, settings, 100, fx);
  assert.equal(canvas.ctx.depth, 0, 'the renderer left the context unbalanced');
});

// ── letting the screen rest (GAME_INTEGRATION §6d) ─────────────────────────
// The claim power saver makes on this renderer is exact: with the board
// settled, every frame is the frame before it. That is what earns the host the
// right to stop asking for frames at all — and it is checked here rather than
// by naming the lanterns, the leaf and the blinks one at a time, because the
// property is "nothing on this canvas depends on the clock", not "these three
// things were remembered".
//
// Dark theme on purpose: it is the busiest the stall ever gets (the lanterns
// only hang in the evening).
function frameShapes(settings) {
  const canvas = stubCanvas();
  const R = makeRenderer(canvas);
  const g = idleGame();
  R.setPerch(FRIEND_LEVEL);
  const shapes = [];
  for (let t = 0; t < 30000; t += 250) {
    const before = canvas.ctx.calls.length;
    R.draw(g, settings, t);
    shapes.push(canvas.ctx.calls.length - before);
  }
  return shapes;
}

test('under power saver a settled board draws the same frame at every moment', () => {
  const saving = frameShapes({ theme: 'dark', fontScale: 1, reducedMotion: false, powerSaver: true });
  assert.equal(new Set(saving).size, 1,
    'something on the settled board was still keeping time under power saver');
});

test('…and with power saver off the stall is alive again', () => {
  const alive = frameShapes({ theme: 'dark', fontScale: 1, reducedMotion: false, powerSaver: false });
  assert.ok(new Set(alive).size > 1,
    'the scenery stopped moving even with power saver off — the gate is too wide');
});

// The other half of §6d, and the half that is easy to get wrong: a state an
// animation used to carry must still be legible once the animation is gone.
// The friend is the visible case — present and neutral, never absent.
test('power saver takes the friend\'s blink, never the friend', () => {
  const canvas = stubCanvas();
  const R = makeRenderer(canvas);
  const g = idleGame();
  const saving = { theme: 'light', fontScale: 1, reducedMotion: false, powerSaver: true };

  const empty = paintCount(R, g, saving, 0, canvas.ctx);
  R.setPerch(FRIEND_LEVEL);
  assert.ok(paintCount(R, g, saving, 0, canvas.ctx) > empty, 'power saver took the friend away');
});

// The juice door, from the power-saver side. js/effects.js has always kept
// decoration out and information in; power saver comes in through the same one.
test('power saver is refused at the same door reduced motion is', () => {
  const fx = makeEffects();
  cheer(fx, 0, true);
  assert.equal(fx.cheeredAt, null, 'a cheer got through a request to hold still');
});

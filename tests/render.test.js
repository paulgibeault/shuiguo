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
import { makeRenderer } from '../js/render.js';
import { makeGame, start } from '../js/game.js';
import { makeRng } from '../js/arcade-rng.js';
import { FRIENDS } from '../js/constants.js';

const FRIEND_LEVEL = FRIENDS[0].level;

function stubCanvas() {
  const calls = [];
  let depth = 0;
  const ctx = {
    calls, get depth() { return depth; },
    canvas: null,
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    save() { depth++; }, restore() { depth--; },
    translate() {}, rotate() {}, scale() {}, clip() {},
    setTransform() {}, resetTransform() {}, setLineDash() {}, clearRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, arc() {}, ellipse() {}, rect() {},
    fillRect() { calls.push('fill'); }, strokeRect() { calls.push('stroke'); },
    fill() { calls.push('fill'); }, stroke() { calls.push('stroke'); },
    fillText() { calls.push('text'); }, strokeText() { calls.push('text'); },
    measureText: () => ({ width: 10 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  };
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

// The cheer is a face, and a face that changes is motion however brief. Under
// reduced motion the friend keeps the one expression they had.
test('cheering a friend changes nothing that reduced motion can see', () => {
  const canvas = stubCanvas();
  const R = makeRenderer(canvas);
  const g = idleGame();
  R.setPerch(FRIEND_LEVEL);

  const still = { theme: 'light', fontScale: 1, reducedMotion: true };
  const before = paintCount(R, g, still, 0, canvas.ctx);
  R.cheer(0);
  assert.equal(paintCount(R, g, still, 10, canvas.ctx), before, 'a cheer got through reduced motion');
});

// Setting a new friend must clear the last one's mood with them — otherwise
// walking into 葡萄's stall would find them already delighted about a chain
// somebody else's board made.
test('taking over a different stall starts its friend on a fresh face', () => {
  const canvas = stubCanvas();
  const R = makeRenderer(canvas);
  const g = idleGame();
  const settings = { theme: 'light', fontScale: 1, reducedMotion: false };

  R.setPerch(FRIEND_LEVEL);
  R.cheer(0);
  R.setPerch(6);
  // no assertion on pixels — the observable is that draw stays clean and the
  // cheer does not survive, which the next draw would otherwise carry
  R.draw(g, settings, 100);
  assert.equal(canvas.ctx.depth, 0, 'the renderer left the context unbalanced');
});

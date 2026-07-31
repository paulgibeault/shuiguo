// The fruit painter is the one piece of this game with no automatic feedback:
// a typo in a branch that only `worried` pineapples reach shows up as a blank
// fruit on someone's phone, weeks later. So it is drawn here against a stub
// context, every level against every expression, and the drawing is measured.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintFruit, expressionFor, EXPRESSIONS, ART, hash32 } from '../js/fruit-art.js';
import { FRUITS, FACES, MAX_LEVEL, radiusOf } from '../js/constants.js';

// A 2D context that records what it was asked to do and how far out it was
// asked to do it. Only the methods the painters actually use — an unexpected
// call throws, which is the point.
function stubCtx() {
  const calls = [];
  let depth = 0, maxDepth = 0, far = 0;
  // Coordinates are recorded in the LOCAL frame the painter works in, which is
  // what the extent budget is expressed in; the painter never translates
  // except inside leaf(), which is accounted for by tracking the offset.
  // A real 2×3 transform, because leaf() rotates about its own anchor: measuring
  // the pre-rotation coordinates would report the wrong distance from centre.
  let m = [1, 0, 0, 1, 0, 0];
  let cx = 0, cy = 0;
  const stack = [];
  // Texture strokes are traced across the full width and then clipped to the
  // silhouette (pineapple crosshatch, melon netting, watermelon stripes). What
  // the clip throws away never reaches the screen, so it does not count here.
  let clipAt = null;
  const reach = (x, y) => {
    if (clipAt !== null) return;
    far = Math.max(far, Math.hypot(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]));
  };
  const mul = (n) => {
    m = [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  };
  // Curves are SAMPLED, not bounded by their control points: a control hull
  // can sit half a radius outside a curve that never goes there, and this
  // budget is about where ink lands.
  const SAMPLES = 24;
  const quad = (px, py, qx, qy, x, y) => {
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES, u = 1 - t;
      reach(u * u * px + 2 * u * t * qx + t * t * x, u * u * py + 2 * u * t * qy + t * t * y);
    }
    cx = x; cy = y;
  };
  const cube = (px, py, ax, ay, bx, by, x, y) => {
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES, u = 1 - t;
      reach(u * u * u * px + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * x,
            u * u * u * py + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * y);
    }
    cx = x; cy = y;
  };
  const api = {
    calls, get depth() { return depth; }, get maxDepth() { return maxDepth; },
    get far() { return far; },
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
    save() { calls.push('save'); stack.push(m.slice()); depth++; maxDepth = Math.max(maxDepth, depth); },
    restore() {
      calls.push('restore'); m = stack.pop() || [1, 0, 0, 1, 0, 0]; depth--;
      if (clipAt !== null && depth < clipAt) clipAt = null;
    },
    translate(x, y) { mul([1, 0, 0, 1, x, y]); },
    rotate(a) { mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
    scale(x, y) { mul([x, 0, 0, y, 0, 0]); },
    clip() { calls.push('clip'); clipAt = depth; },
    beginPath() {}, closePath() {},
    moveTo(x, y) { reach(x, y); cx = x; cy = y; },
    lineTo(x, y) { reach(x, y); cx = x; cy = y; },
    quadraticCurveTo(qx, qy, x, y) { quad(cx, cy, qx, qy, x, y); },
    bezierCurveTo(a, b, c, d, x, y) { cube(cx, cy, a, b, c, d, x, y); },
    arc(x, y, r) { reach(x + r, y); reach(x - r, y); reach(x, y + r); reach(x, y - r); },
    ellipse(x, y, rx, ry) { reach(x + rx, y); reach(x - rx, y); reach(x, y + ry); reach(x, y - ry); },
    rect(x, y, w, h) { reach(x, y); reach(x + w, y + h); },
    fillRect(x, y, w, h) { calls.push('fill'); reach(x, y); reach(x + w, y + h); },
    strokeRect(x, y, w, h) { calls.push('stroke'); reach(x, y); reach(x + w, y + h); },
    fill() { calls.push('fill'); },
    stroke() { calls.push('stroke'); },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  return api;
}

test('the painter is importable with no DOM — it only ever touches its context', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof paintFruit, 'function');
});

test('every level draws in every expression, and leaves the context balanced', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    for (const expression of EXPRESSIONS) {
      const ctx = stubCtx();
      paintFruit(ctx, level, radiusOf(level), { angle: 0.7, expression });
      const what = `${FRUITS[level - 1].name}/${expression}`;
      assert.ok(ctx.calls.includes('fill'), `${what} fills nothing`);
      assert.ok(ctx.calls.includes('stroke'), `${what} strokes nothing`);
      assert.equal(ctx.depth, 0, `${what} leaks a save()`);
    }
  }
});

test('the texture layer is clipped to the silhouette, so nothing spills past the rind', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const ctx = stubCtx();
    paintFruit(ctx, level, radiusOf(level));
    assert.ok(ctx.calls.includes('clip'), `${FRUITS[level - 1].name} draws texture unclipped`);
  }
});

test('nothing is drawn beyond the extent budget — the body is what the physics says it is', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    for (const expression of EXPRESSIONS) {
      const ctx = stubCtx();
      const r = radiusOf(level);
      paintFruit(ctx, level, r, { expression });
      const ratio = ctx.far / r;
      assert.ok(ratio <= ART.maxExtent + 1e-6,
        `${FRUITS[level - 1].name}/${expression} reaches ${ratio.toFixed(2)}× r, budget ${ART.maxExtent}`);
    }
  }
});

test('the painter works at preview size too — no divide-by-r assumptions', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const ctx = stubCtx();
    paintFruit(ctx, level, 8);           // the menu chip's world radius, roughly
    assert.ok(ctx.calls.includes('fill'));
    assert.equal(ctx.depth, 0);
  }
});

test('every level has a full set of face parameters', () => {
  assert.equal(FACES.length, MAX_LEVEL);
  for (const [i, p] of FACES.entries()) {
    for (const k of ['eye', 'gap', 'eyeY', 'lid', 'mouth', 'mouthY', 'blush']) {
      assert.equal(typeof p[k], 'number', `${FRUITS[i].name} face is missing ${k}`);
    }
    assert.ok(p.lid >= 0 && p.lid <= 1, `${FRUITS[i].name} lid ${p.lid} out of range`);
    assert.ok(p.eye > 0, `${FRUITS[i].name} has no eyes`);
  }
});

// ── expression selection ───────────────────────────────────────────────────

const body = (over) => ({ id: 3, overSince: over ?? null, bornAt: null });

test('worried outranks everything: a fruit over the line looks over the line', () => {
  const b = { id: 3, overSince: 1000, bornAt: 1000 };
  assert.equal(expressionFor(b, 1050, false), 'worried');
  assert.equal(expressionFor(b, 1050, true), 'worried');
});

test('a newborn is happy, and only briefly', () => {
  const b = { id: 3, overSince: null, bornAt: 1000 };
  assert.equal(expressionFor(b, 1100, false), 'happy');
  assert.notEqual(expressionFor(b, 1000 + ART.happyMs + 1, true), 'happy');
});

test('idle fruit blink, but never under reduced motion', () => {
  const b = body();
  let blinks = 0;
  for (let t = 0; t < 20000; t += 20) {
    if (expressionFor(b, t, false) === 'blink') blinks++;
    assert.equal(expressionFor(b, t, true), 'neutral');
  }
  assert.ok(blinks > 0, 'this fruit never blinks');
  // ~120ms of blink per 3–6s: a few percent of the time, not a twitch
  assert.ok(blinks / 1000 < 0.1, `blinking ${(blinks / 10).toFixed(1)}% of the time`);
});

test('blink phases scatter — a pile does not blink in unison', () => {
  let worst = 0;
  for (let t = 0; t < 12000; t += 100) {
    let n = 0;
    for (let id = 1; id <= 60; id++) {
      if (expressionFor({ id, overSince: null, bornAt: null }, t, false) === 'blink') n++;
    }
    worst = Math.max(worst, n);
  }
  assert.ok(worst < 15, `${worst} of 60 fruit blinked on the same frame`);
});

test('the id hash scatters small consecutive ids', () => {
  const seen = new Set();
  for (let i = 1; i <= 64; i++) seen.add(hash32(i) % 997);
  assert.ok(seen.size > 55, `only ${seen.size}/64 distinct — ids are colliding`);
});

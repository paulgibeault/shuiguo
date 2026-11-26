// Where everything on the mountainside is. Geometry is the one thing the
// painter and the hit-tester must agree on to the unit, and it fails silently:
// a tile whose tap box has drifted off the tile it belongs to looks fine in
// review and is maddening in the hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYOUT, worldHeight, groundYOf, terraceGeom, tileW, tileGeom, plotGeom, tileAtPoint,
  forSaleBox, terracePriceBox, maxScroll, scrollToTerrace, streamXAt, streamRightAt, groundYAt, streamCrossing, tilesBeforeStream,
} from '../js/farm-layout.js';
import { WORLD, MAX_TERRACES, TUNING } from '../js/constants.js';

const COLS = TUNING.tilesPerTerrace;

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

test('the world is the stall\'s width, and tall enough for every terrace and some sky', () => {
  assert.equal(LAYOUT.width, WORLD.width);
  assert.equal(LAYOUT.cols, COLS);
  const top = groundYOf(MAX_TERRACES - 1);
  assert.ok(top - LAYOUT.treeH > 0, 'the top terrace grows off the top of the world');
  assert.ok(groundYOf(0) + LAYOUT.wallH < worldHeight(), 'the bottom wall falls off the world');
});

test('terraces stack upward, a band apart', () => {
  for (let i = 1; i < MAX_TERRACES; i++) {
    assert.equal(groundYOf(i - 1) - groundYOf(i), LAYOUT.bandH);
    assert.ok(LAYOUT.bandH > LAYOUT.plantH + LAYOUT.wallH - 1, 'a bed is taller than its shelf');
  }
});

test('tiles fill their shelf in order, without overlapping or spilling off it', () => {
  for (let ti = 0; ti < MAX_TERRACES; ti++) {
    const t = terraceGeom(ti);
    let lastRight = -Infinity;
    for (let col = 0; col < COLS; col++) {
      const g = tileGeom(ti, col);
      assert.ok(g.x >= t.left && g.x + g.w <= t.right, `tile ${ti}:${col} spills off its shelf`);
      assert.ok(g.x >= lastRight, `tile ${ti}:${col} overlaps the one before`);
      lastRight = g.x + g.w;
      assert.equal(g.groundY, groundYAt(ti, g.cx), `tile ${ti}:${col} floats off its own ground line`);
    }
  }
});

// Terraces run edge to edge; the stream crosses each of them. No tile may
// stand in the water, and the row parts around it rather than shuffling up.
test('every shelf runs edge to edge, and its tiles part around the stream', () => {
  for (let ti = 0; ti < MAX_TERRACES; ti++) {
    const t = terraceGeom(ti);
    assert.ok(t.left <= 0 && t.right >= LAYOUT.width, `terrace ${ti + 1} does not reach both edges`);
    const water = streamCrossing(ti);
    const split = tilesBeforeStream(ti);
    for (let col = 0; col < LAYOUT.cols; col++) {
      const g = tileGeom(ti, col);
      assert.ok(g.x >= 0 && g.x + g.w <= LAYOUT.width, `tile ${ti}:${col} is off the world`);
      assert.ok(g.x + g.w < water.lo || g.x > water.hi, `tile ${ti}:${col} is in the stream`);
      assert.equal(g.x + g.w < water.lo, col < split, `tile ${ti}:${col} is on the wrong bank`);
    }
  }
});

test('the stream wanders: it crosses the shelves in different places', () => {
  const xs = Array.from({ length: MAX_TERRACES }, (_, i) => streamCrossing(i).x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 30, 'the stream runs straight down one column');
});

// The point of the contour: ten shelves that are not ten copies of one ruled
// line. Each bows and tilts its own way, and the rows of tiles drift — but
// gently, never enough to crowd the shelf above.
test('shelves follow the hill: they bow, and no two are cut the same', () => {
  const shapes = new Set();
  for (let ti = 0; ti < MAX_TERRACES; ti++) {
    const ys = [40, 120, 200, 280, 350].map((x) => groundYAt(ti, x) - groundYOf(ti));
    assert.ok(Math.max(...ys) - Math.min(...ys) > 15, `terrace ${ti + 1} is ruled nearly level`);
    for (const d of ys) assert.ok(Math.abs(d) < 50, `terrace ${ti + 1} sweeps ${d.toFixed(1)} off its level`);
    // they sweep a long way, but together: a shelf always has room for a bed
    // and its wall under the shelf above
    if (ti + 1 < MAX_TERRACES) {
      for (let x = 0; x <= LAYOUT.width; x += 4) {
        const gap = groundYAt(ti, x) - groundYAt(ti + 1, x);
        assert.ok(gap >= LAYOUT.plantH + LAYOUT.wallH, `terraces ${ti + 1}/${ti + 2} pinch to ${gap.toFixed(1)} at x=${x}`);
      }
    }
    shapes.add(ys.map((d) => d.toFixed(1)).join() + tileGeom(ti, 0).x.toFixed(1));
  }
  assert.equal(shapes.size, MAX_TERRACES, 'two shelves were cut identically');
  const starts = new Set(Array.from({ length: MAX_TERRACES }, (_, i) => Math.round(tileGeom(i, 0).x)));
  assert.ok(starts.size > 3, 'the rows of tiles line up in columns down the mountain');
});

test('a tile is big enough to hit with a thumb on a phone', () => {
  // 360 world units across a ~390 CSS px phone
  const cssPerUnit = 390 / WORLD.width;
  assert.ok(tileW() * cssPerUnit >= 44, `a tile is ${(tileW() * cssPerUnit).toFixed(1)}px wide`);
});

test('a two-tile plot spans both tiles and the gap between them', () => {
  const a = tileGeom(2, 3), b = tileGeom(2, 4);
  const p = plotGeom(2, 3, 2);
  assert.equal(p.x, a.x);
  assert.equal(p.x + p.w, b.x + b.w);
  assert.ok(Math.abs(p.cx - (a.x + b.x + b.w) / 2) < 1e-9);
  assert.equal(p.h, LAYOUT.treeH);
  assert.equal(plotGeom(2, 3, 1).h, LAYOUT.plantH);
});

test('tapping a tile finds the tile that was drawn there, and nothing else', () => {
  for (let ti = 0; ti < MAX_TERRACES; ti++) {
    for (let col = 0; col < COLS; col++) {
      const g = tileGeom(ti, col);
      for (const x of [g.x + 1, g.cx, g.x + g.w - 1]) {
        const gy = groundYAt(ti, x);
        for (const y of [gy - 1, gy - LAYOUT.plantH + 6, gy + LAYOUT.wallH - 1]) {
          assert.deepEqual(tileAtPoint(x, y, MAX_TERRACES), { ti, col }, `(${x}, ${y})`);
        }
      }
    }
  }
  assert.equal(tileAtPoint(180, 2, MAX_TERRACES), null, 'the sky is a tile');
  assert.equal(tileAtPoint(180, worldHeight() - 2, MAX_TERRACES), null, 'the road is a tile');
  assert.equal(tileAtPoint(LAYOUT.left - 10, groundYOf(0) - 5, MAX_TERRACES), null, 'the stream is a tile');
  // a terrace nobody owns does not take taps
  assert.equal(tileAtPoint(tileGeom(3, 0).cx, groundYOf(3) - 1, 2), null);
});

test('the bands are contiguous: anywhere over an owned shelf hits it', () => {
  const x = tileGeom(0, 2).cx;
  for (let y = groundYAt(MAX_TERRACES - 1, x) - LAYOUT.bandH + LAYOUT.wallH + 1; y <= groundYAt(0, x) + LAYOUT.wallH; y += 3) {
    assert.ok(tileAtPoint(x, y, MAX_TERRACES), `a dead strip at y=${y}`);
  }
});

test('the 出售 sign stands over the shelf it sells, clear of its price markers', () => {
  for (let i = 1; i < MAX_TERRACES; i++) {
    const box = forSaleBox(i);
    const t = terraceGeom(i);
    assert.ok(box.y + box.h <= t.groundY, 'the sign is buried in its shelf');
    if (i + 1 < MAX_TERRACES) {
      const cx = box.x + box.w / 2;
      assert.ok(box.y > groundYAt(i + 1, cx) + LAYOUT.wallH - 10, 'the sign hangs over the shelf above');
    }
    assert.ok(!overlaps(box, terracePriceBox(i)), `sign and marker overlap on terrace ${i + 1}`);
  }
});

test('the camera frames a terrace and never scrolls off the world', () => {
  for (const viewH of [500, 690, 900, 3000]) {
    for (let i = 0; i < MAX_TERRACES; i++) {
      const y = scrollToTerrace(i, viewH);
      assert.ok(y >= 0 && y <= maxScroll(viewH));
      if (viewH < worldHeight()) {
        assert.ok(groundYOf(i) >= y && groundYOf(i) <= y + viewH, `terrace ${i + 1} out of frame in a ${viewH} view`);
      }
    }
  }
  assert.equal(maxScroll(worldHeight() + 100), 0);
});

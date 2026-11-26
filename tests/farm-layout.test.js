// Where everything on the mountainside is. Geometry is the one thing the
// painter and the hit-tester must agree on to the unit, and it fails silently:
// a tile whose tap box has drifted off the tile it belongs to looks fine in
// review and is maddening in the hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYOUT, worldHeight, groundYOf, terraceGeom, tileW, tileGeom, plotGeom, tileAtPoint,
  forSaleBox, terracePriceBox, maxScroll, scrollToTerrace, streamXAt,
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
      assert.equal(g.groundY, t.groundY);
    }
  }
});

test('the stream has the strip left of every shelf to itself', () => {
  for (let y = 0; y < worldHeight(); y += 50) {
    assert.ok(streamXAt(y) + LAYOUT.streamW < LAYOUT.left, `the stream runs onto the shelves at y=${y}`);
  }
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
  assert.equal(p.cx, (a.x + b.x + b.w) / 2);
  assert.equal(p.h, LAYOUT.treeH);
  assert.equal(plotGeom(2, 3, 1).h, LAYOUT.plantH);
});

test('tapping a tile finds the tile that was drawn there, and nothing else', () => {
  for (let ti = 0; ti < MAX_TERRACES; ti++) {
    for (let col = 0; col < COLS; col++) {
      const g = tileGeom(ti, col);
      for (const y of [g.groundY - 1, g.groundY - LAYOUT.plantH, g.groundY + LAYOUT.wallH - 1]) {
        for (const x of [g.x + 1, g.cx, g.x + g.w - 1]) {
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
  for (let y = groundYOf(MAX_TERRACES - 1) - LAYOUT.bandH + LAYOUT.wallH + 1; y <= groundYOf(0) + LAYOUT.wallH; y += 3) {
    assert.ok(tileAtPoint(x, y, MAX_TERRACES), `a dead strip at y=${y}`);
  }
});

test('the 出售 sign stands over the shelf it sells, clear of its price markers', () => {
  for (let i = 1; i < MAX_TERRACES; i++) {
    const box = forSaleBox(i);
    const t = terraceGeom(i);
    assert.ok(box.y + box.h <= t.groundY, 'the sign is buried in its shelf');
    if (i + 1 < MAX_TERRACES) {
      assert.ok(box.y > groundYOf(i + 1) + LAYOUT.wallH - 10, 'the sign hangs over the shelf above');
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

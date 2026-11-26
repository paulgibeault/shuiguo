// Where everything on the mountainside is.
//
// Pure geometry, in world units — no context, no DOM, no state. The scene
// painter (js/farm-scene.js) draws to these numbers and the farm host
// (js/farm-host.js) hit-tests against them, so what the player taps and what
// the player sees can never drift apart: there is exactly one copy of the
// arithmetic, and it is this one.
//
// The mountain is taller than the screen. The world is LAYOUT.width wide — the
// same 360 units the stall is — and as tall as ten terraces need, and the host
// scrolls a window up and down it. Terrace 0 is the bottom one, nearest the
// road; the stream runs down the left-hand side of every shelf, which is why
// the left-hand tiles are the wet ones (js/terrain.js).

import { WORLD, MAX_TERRACES, TUNING } from './constants.js';

export const LAYOUT = {
  width: WORLD.width,
  cols: TUNING.tilesPerTerrace,
  bandH: 112,           // ground line to ground line, one terrace to the next
  wallH: 22,            // the stone retaining wall under each shelf
  soilH: 10,            // the lip of turned earth along the shelf
  left: 40,             // the shelf starts here: the stream has the strip to its left
  right: 354,
  tilePad: 4,           // inside the shelf, before the first tile and after the last
  tileGap: 4,
  skyH: 200,            // world above the top terrace's ground line
  footH: 136,           // world below the bottom terrace's ground line: wall, road, house
  plantH: 70,           // height budget for a one-tile plant
  treeH: 104,           // …and for a two-tile tree, whose crown leans over the shelf above
  streamX: 6,           // the stream's left bank at the bottom of the world …
  streamW: 26,          // … and its width
  // The 出售 sign is the entire "buy a terrace" interaction, so it is sized as a
  // destination rather than as set dressing.
  signW: 96, signH: 54,
  markerW: 58, markerH: 16, markerInset: 8,
};

export function worldHeight() {
  return LAYOUT.skyH + (MAX_TERRACES - 1) * LAYOUT.bandH + LAYOUT.footH;
}

// Ground line of terrace i: the top of its wall, where its plants stand.
export function groundYOf(i) {
  return worldHeight() - LAYOUT.footH - i * LAYOUT.bandH;
}

export function terraceGeom(i) {
  return {
    groundY: groundYOf(i),
    left: LAYOUT.left,
    right: LAYOUT.right,
    width: LAYOUT.right - LAYOUT.left,
  };
}

export function tileW() {
  const { left, right, tilePad, tileGap, cols } = LAYOUT;
  return (right - left - 2 * tilePad - (cols - 1) * tileGap) / cols;
}

// One tile of ground: { x, cx, w, groundY } — x is its left edge.
export function tileGeom(ti, col) {
  const w = tileW();
  const x = LAYOUT.left + LAYOUT.tilePad + col * (w + LAYOUT.tileGap);
  return { x, cx: x + w / 2, w, groundY: groundYOf(ti) };
}

// Where a thing `span` tiles wide standing at `col` sits, and how tall it may
// be drawn. A two-tile plant is centred over both tiles and swallows the gap
// between them.
export function plotGeom(ti, col, span = 1) {
  const first = tileGeom(ti, col);
  const last = tileGeom(ti, col + span - 1);
  const w = last.x + last.w - first.x;
  return {
    x: first.x,
    cx: first.x + w / 2,
    w,
    groundY: first.groundY,
    h: span > 1 ? LAYOUT.treeH : LAYOUT.plantH,
  };
}

// Which tile a tap at world (x, y) landed on, among the first `terraceCount`
// terraces. Each terrace owns the whole band above its ground line up to the
// wall of the one above, plus its own wall — so the bands are contiguous and a
// tap anywhere on a shelf finds it. Horizontally, the gap between two tiles is
// split down the middle.
export function tileAtPoint(x, y, terraceCount) {
  const { bandH, wallH, cols, tileGap } = LAYOUT;
  for (let ti = 0; ti < Math.min(terraceCount, MAX_TERRACES); ti++) {
    const g = groundYOf(ti);
    if (y > g + wallH || y <= g + wallH - bandH) continue;
    for (let col = 0; col < cols; col++) {
      const t = tileGeom(ti, col);
      if (x >= t.x - tileGap / 2 && x <= t.x + t.w + tileGap / 2) return { ti, col };
    }
    return null;
  }
  return null;
}

// The 出售 sign over terrace i, upright — the box a tap is tested against.
export function forSaleBox(i) {
  const t = terraceGeom(i);
  return {
    x: t.left + t.width / 2 - LAYOUT.signW / 2,
    y: t.groundY - LAYOUT.signH - LAYOUT.soilH - 14,
    w: LAYOUT.signW,
    h: LAYOUT.signH,
  };
}

// The small price marker on every shelf above the one for sale: scenery.
export function terracePriceBox(i) {
  const t = terraceGeom(i);
  return {
    x: t.right - LAYOUT.markerW - LAYOUT.markerInset,
    y: t.groundY - LAYOUT.markerH - LAYOUT.soilH - 4,
    w: LAYOUT.markerW,
    h: LAYOUT.markerH,
  };
}

// The stream's left bank at world height y. A gentle meander, the same curve
// every frame — the painter and anything that wants to sit beside the water
// both ask here.
export function streamXAt(y) {
  const u = y / worldHeight();
  return LAYOUT.streamX + Math.sin(u * 17) * 3;
}

// The camera's legal range, for a view `viewH` world units tall: 0 shows the
// top of the sky, maxScroll shows the road.
export function maxScroll(viewH) {
  return Math.max(0, worldHeight() - viewH);
}

// Where to put the camera so terrace i sits comfortably in a view `viewH`
// tall: its ground line a little below the middle, so the shelf above it — the
// next thing to buy — is in view as well.
export function scrollToTerrace(i, viewH) {
  const target = groundYOf(Math.max(0, i)) - viewH * 0.62;
  return Math.min(maxScroll(viewH), Math.max(0, target));
}

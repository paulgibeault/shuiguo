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
  bandH: 112,           // ground line to ground line, one terrace to the next (on average)
  wallH: 22,            // the stone retaining wall under each shelf
  soilH: 10,            // the lip of turned earth along the shelf
  // Nominal shelf extent — the envelope every shelf fits inside. No shelf is
  // actually cut to it: each one starts where the stream's bank happens to be
  // at its height and runs out into the hillside at its own length
  // (terraceGeom), so the mountain does not read as ten copies of one strip.
  left: 40,
  right: 356,
  tileW: 42,            // every tile the same width, so a thumb always fits …
  tileGap: 4,           // … and the ROW of them drifts a little shelf to shelf
  shelfPad: 6,          // shelf earth either side of the row, at the least
  // The hill's own shape (see groundYAt): a valley that carries the stream,
  // and a spur of ridge to its right.
  valleyDepthTop: 8,    // how far the contours kink uphill at the valley, at the spring …
  valleyDepthFoot: 30,  // … and at the foot, where the stream has cut deeper
  valleyW: 46,          // how quickly the valley's kink fades out either side
  spurHeight: 20,       // how far the contours bulge downhill over the spur
  spurW: 82,
  skyH: 200,            // world above the top terrace's ground line
  footH: 136,           // world below the bottom terrace's ground line: wall, road, house
  plantH: 70,           // height budget for a one-tile plant
  treeH: 104,           // …and for a two-tile tree, whose crown leans over the shelf above
  streamX: 6,           // nominal left bank, for painters that want a constant
  streamW: 26,          // nominal width — the real one breathes (streamWAt)
  // The 出售 sign is the entire "buy a terrace" interaction, so it is sized as a
  // destination rather than as set dressing.
  signW: 96, signH: 54,
  markerW: 58, markerH: 16, markerInset: 8,
};

export function worldHeight() {
  return LAYOUT.skyH + (MAX_TERRACES - 1) * LAYOUT.bandH + LAYOUT.footH;
}

// A small, fixed, per-terrace number in [0, 1) — the shelf's personality. A
// hash rather than an rng so any module can ask for terrace 4's without
// replaying terraces 0–3.
function jitter(i, salt) {
  const v = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

// Ground line of terrace i, NOMINALLY: the level the shelf is cut around. The
// real ground bows and tilts along its length — ask groundYAt for a point.
export function groundYOf(i) {
  return worldHeight() - LAYOUT.footH - i * LAYOUT.bandH;
}

// ── the hill ───────────────────────────────────────────────────────────────
//
// The terraces are cut along CONTOUR LINES of one hillside, and the hillside
// has a shape, so the terraces and the stream obey the two rules every real
// contour map does:
//
//   where contours cross a valley they kink UPHILL, in a V pointing upstream —
//   and the stream runs down the bottom of that valley, so it crosses every
//   terrace exactly at the point of the V;
//
//   where they cross a spur of ridge they bulge DOWNHILL, in a broad U.
//
// Both features drift slowly across the hill as it climbs (a real valley
// wanders, it does not zigzag), the valley is shallow near the spring and cut
// deeper towards the foot, and the stream grows with it. Neighbouring
// terraces therefore run almost parallel — what one shelf does, the one above
// does slightly less of — which is what reads as terrain rather than noise.

// How far down the hill world height y is: 0 at the top terrace, 1 at the foot.
function downhill(y) {
  const top = groundYOf(MAX_TERRACES - 1);
  const foot = groundYOf(0);
  return Math.max(0, Math.min(1, (y - top) / (foot - top)));
}

// The valley floor — the line the stream follows down the hill.
export function streamCenterAt(y) {
  return 50 + Math.sin(y / 520 + 0.9) * 16;
}

// The spur's crest: a broad shoulder of hill right of the valley.
function spurAt(y) {
  return 238 + Math.sin(y / 640 + 2.2) * 30;
}

// The ground line of terrace i at world x: its nominal level, kinked uphill
// (smaller y) at the valley and bulged downhill over the spur.
export function groundYAt(i, x) {
  const y0 = groundYOf(i);
  const k = downhill(y0);
  const { valleyDepthTop, valleyDepthFoot, valleyW, spurHeight, spurW } = LAYOUT;
  const depth = valleyDepthTop + (valleyDepthFoot - valleyDepthTop) * k;
  const valley = -depth * Math.exp(-Math.abs(x - streamCenterAt(y0)) / valleyW);
  const d = (x - spurAt(y0)) / spurW;
  const spur = spurHeight * (0.75 + 0.25 * k) * Math.exp(-d * d);
  return y0 + valley + spur;
}

// ── the stream ─────────────────────────────────────────────────────────────
// It rises at a spring near the top as a trickle and gathers water on the way
// down: narrow at the top, widest at the foot.

export function streamWAt(y) {
  return 12 + 15 * downhill(y);
}
// The stream's left bank at world height y.
export function streamXAt(y) {
  return streamCenterAt(y) - streamWAt(y) / 2;
}
export function streamRightAt(y) {
  return streamCenterAt(y) + streamWAt(y) / 2;
}

// ── the shelves ────────────────────────────────────────────────────────────
//
// Every terrace runs the full width of the hill, edge to edge, and the stream
// crosses each one on its way down — over the shelf and down the face of its
// wall in a little fall. The row of tiles parts around the water: some tiles
// on the near bank, the rest on the far one, never one in the stream.

// Where the stream crosses terrace i: the extent of the water, [lo, hi], over
// the strip a tile and its soil actually occupy (just above the ground line
// down to the foot of the wall).
export function streamCrossing(i) {
  const cx = streamCenterAt(groundYOf(i));
  const gy = groundYAt(i, cx);
  let lo = Infinity, hi = -Infinity;
  for (let y = gy - 30; y <= gy + LAYOUT.wallH; y += 2) {
    lo = Math.min(lo, streamXAt(y));
    hi = Math.max(hi, streamRightAt(y));
  }
  return { lo, hi, x: (lo + hi) / 2, y: gy };
}

const BANK = 5;   // dry bank between the water and the nearest tile

// How terrace i's row parts around the stream: how many tiles stand on the
// near (left) bank, and where each group starts. The near group hugs the
// water when it is there at all; the far group drifts by the shelf's own
// personality within whatever room is left.
function rowOf(i) {
  const { tileW: w, tileGap: gap, cols, shelfPad, width } = LAYOUT;
  const { lo, hi } = streamCrossing(i);
  const span = (n) => (n > 0 ? n * w + (n - 1) * gap : 0);
  // All on the far bank if they fit there; otherwise the fewest on the near
  // bank that leaves room for the rest; and if neither bank will quite do, the
  // far group squeezes up to the water and the world's edge.
  const fitsNear = (n) => n === 0 || shelfPad + span(n) <= lo - BANK;
  const fitsFar = (n) => hi + BANK + span(cols - n) <= width - 2;
  let near = 0;
  while (near < cols && !(fitsNear(near) && fitsFar(near))) near++;
  if (near === cols) near = 0;
  const nearX = lo - BANK - span(near);
  const farMin = hi + BANK;
  const farMax = width - 2 - span(cols - near);
  const farX = Math.min(farMax, farMin + jitter(i, 4) * Math.max(0, Math.min(18, farMax - farMin)));
  return { near, nearX, farX };
}

// How many of terrace i's tiles stand on the near side of the stream. A thing
// two tiles wide cannot straddle the water (js/farm.js asks this).
export function tilesBeforeStream(i) { return rowOf(i).near; }

// One terrace's extent: edge to edge, a little past each side so no wall ends
// in view. `groundY` is the ground line at the middle; use groundYAt for
// anywhere else.
export function terraceGeom(i) {
  const left = -6;
  const right = LAYOUT.width + 6;
  return { groundY: groundYAt(i, LAYOUT.width / 2), left, right, width: right - left };
}

export function tileW() { return LAYOUT.tileW; }

// One tile of ground: { x, cx, w, groundY } — x is its left edge, and groundY
// is where the shelf's real ground line passes under its middle.
export function tileGeom(ti, col) {
  const w = LAYOUT.tileW;
  const row = rowOf(ti);
  const x = col < row.near
    ? row.nearX + col * (w + LAYOUT.tileGap)
    : row.farX + (col - row.near) * (w + LAYOUT.tileGap);
  return { x, cx: x + w / 2, w, groundY: groundYAt(ti, x + w / 2) };
}

// Where a thing `span` tiles wide standing at `col` sits, and how tall it may
// be drawn. A two-tile plant is centred over both tiles and swallows the gap
// between them.
export function plotGeom(ti, col, span = 1) {
  const first = tileGeom(ti, col);
  const last = tileGeom(ti, col + span - 1);
  const w = last.x + last.w - first.x;
  const cx = first.x + w / 2;
  return {
    x: first.x,
    cx,
    w,
    groundY: groundYAt(ti, cx),
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
    const g = groundYAt(ti, x);
    const above = ti + 1 < MAX_TERRACES ? groundYAt(ti + 1, x) : g - bandH;
    if (y > g + wallH || y <= above + wallH) continue;
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
  const cx = t.left + t.width / 2;
  return {
    x: cx - LAYOUT.signW / 2,
    y: groundYAt(i, cx) - LAYOUT.signH - LAYOUT.soilH - 14,
    w: LAYOUT.signW,
    h: LAYOUT.signH,
  };
}

// The small price marker on every shelf above the one for sale: scenery.
export function terracePriceBox(i) {
  const t = terraceGeom(i);
  const x = Math.min(t.right, LAYOUT.width) - LAYOUT.markerW - LAYOUT.markerInset;
  return {
    x,
    y: groundYAt(i, x + LAYOUT.markerW / 2) - LAYOUT.markerH - LAYOUT.soilH - 4,
    w: LAYOUT.markerW,
    h: LAYOUT.markerH,
  };
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

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
  // The hill's own shape. Terraces are cut along contour lines, so a wall
  // sweeps up and down the slope by a good part of a terrace — but its
  // neighbours sweep with it, the way real contour lines run nearly parallel,
  // so shelves never pinch together. `contourAmp` is the hill's swing; the
  // shape drifts by `contourDrift` radians per terrace, so the top of the
  // mountain is a different hillside from the bottom; and each shelf adds a
  // little bow of its own.
  contourAmp: 28,
  contourDrift: 0.45,
  contourOwn: 4,
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

// The real ground line of terrace i at world x. A gentle bow plus a slight
// tilt, both fixed per terrace, so the walls follow the hill like dry-stone
// terraces do instead of ruling ten level lines across it. Small enough
// (≤ ~9 units) that shelves never crowd each other.
export function groundYAt(i, x) {
  const { contourAmp, contourDrift, contourOwn, width } = LAYOUT;
  const u = x / width;
  // the hillside: one long sweep and a shorter swell, both drifting slowly
  // from terrace to terrace
  const hill = Math.sin(u * Math.PI * 1.3 + i * contourDrift + 0.8) * contourAmp
    + Math.sin(u * Math.PI * 2.6 - i * contourDrift * 1.7 + 2.1) * contourAmp * 0.35;
  // …and this shelf's own bow, so no two are the same line moved up
  const own = Math.sin(u * Math.PI * (1.4 + jitter(i, 1)) + jitter(i, 2) * 6.28) * contourOwn;
  return groundYOf(i) + hill + own;
}

// ── the stream ─────────────────────────────────────────────────────────────
// It meanders: two slow sine swings on its centre line, and its width breathes
// between narrows and pools. The shelves start at its right bank, wherever
// that is at their height.

export function streamCenterAt(y) {
  // a wide, lazy meander out into the slope and back, with a smaller wiggle
  // riding on it — a mountain stream finds its own way down
  return 44 + Math.sin(y / 170 + 0.4) * 21 + Math.sin(y / 61 + 1.3) * 6;
}
export function streamWAt(y) {
  return LAYOUT.streamW - 3 + Math.sin(y / 90 + 2) * 4;
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

// The lie of the land: why the same seed does better in one spot than another.
//
// Pure rules, no state. js/farm.js asks here how fast a plot grows and how much
// it bears, and the farm host asks here what to tell the player about a spot
// before they plant in it — one answer, so the stars on the seed card and the
// speed in the ground can never disagree.
//
// Two things are fixed by where a tile IS:
//
//   altitude  the bottom shelves are warm valley ground, the top ones cool
//             ridge; which band a terrace is in is a fact about the mountain
//   moisture  the stream crosses every shelf, so the tiles beside it are wet
//             and the ones furthest from it are dry
//
// and three are made by what stands NEXT to it, on the same shelf:
//
//   pond      wets the ground either side of it, wherever it is dug
//   beehive   the plants either side bear more fruit
//   compost   the plants either side grow faster
//
// plus a small bonus for VARIETY — a different crop either side grows a little
// faster than a row of the same thing. Every effect is a kindness: the worst
// spot on the mountain grows a crop slower, never fails it. Nothing here can
// stop a plant from ripening.

import { MAX_TERRACES, TUNING, farmOf, yieldOf, isStructure } from './constants.js';
import { streamCrossing, tileGeom } from './farm-layout.js';

export const ALTITUDES = ['low', 'mid', 'high'];
export const MOISTURES = ['dry', 'damp', 'wet'];

export const ALTITUDE_NAMES = { low: 'Valley 谷地', mid: 'Hillside 山腰', high: 'Ridge 高山' };
export const MOISTURE_NAMES = { dry: 'Dry 干', damp: 'Damp 润', wet: 'Wet 湿' };

// Grades, worst to best. The index is grade + 2.
export const GRADES = [
  { grade: -2, name: 'Bad',   hanzi: '很差', stars: 0 },
  { grade: -1, name: 'Poor',  hanzi: '差',   stars: 1 },
  { grade:  0, name: 'Fair',  hanzi: '一般', stars: 2 },
  { grade:  1, name: 'Good',  hanzi: '好',   stars: 3 },
  { grade:  2, name: 'Ideal', hanzi: '极佳', stars: 4 },
];
export function gradeInfo(grade) { return GRADES[Math.max(-2, Math.min(2, grade)) + 2]; }

// Three bands up the mountain, cut as evenly as ten shelves allow: the valley
// gets the starter shelf and the two above it, the ridge gets the top three.
export function altitudeOf(ti) {
  const third = MAX_TERRACES / 3;
  if (ti < Math.round(third)) return 'low';
  if (ti < Math.round(third * 2) + 0) return 'mid';
  return 'high';
}

// Soil is wettest beside the stream and dries out with distance from it. The
// stream crosses every shelf (js/farm-layout.js), so "beside the stream" is a
// measure along the shelf from the water's edge to the tile's nearest edge:
// within about a tile and a bit is wet, within about three is damp, and past
// that the ground is dry.
const WET_WITHIN = 60;
const DAMP_WITHIN = 150;

export function baseMoistureOf(ti, col) {
  const { lo, hi } = streamCrossing(ti);
  const t = tileGeom(ti, col);
  const d = Math.max(0, lo - (t.x + t.w), t.x - hi);
  return d < WET_WITHIN ? 'wet' : d < DAMP_WITHIN ? 'damp' : 'dry';
}

// ── what is next to what ───────────────────────────────────────────────────

function covers(p, col) { return col >= p.col && col < p.col + p.span; }

// Everything standing on the tiles immediately either side of [col, col+span),
// on the same terrace. `ignore` is a plot to pretend is not there — the one
// being moved, when the question is "what would it be like over THERE".
export function neighboursOf(terrace, col, span, ignore) {
  const out = [];
  for (const p of terrace.plots) {
    if (p === ignore) continue;
    if (covers(p, col - 1) || covers(p, col + span)) out.push(p);
  }
  return out;
}

// A tile's soil once ponds are counted. A pond wets the tiles either side of
// it; the pond's own tile is water, not soil, and nothing grows there.
export function moistureAt(terrace, ti, col, ignore) {
  for (const p of terrace.plots) {
    if (p === ignore || p.kind !== 'pond') continue;
    if (col === p.col - 1 || col === p.col + p.span) return 'wet';
  }
  return baseMoistureOf(ti, col);
}

// The soil a plant `span` wide drinks from: the wettest of its tiles. Roots go
// where the water is, and it keeps the rule to one sentence.
export function moistureFor(terrace, ti, col, span, ignore) {
  let best = 0;
  for (let c = col; c < col + span; c++) {
    best = Math.max(best, MOISTURES.indexOf(moistureAt(terrace, ti, c, ignore)));
  }
  return MOISTURES[best];
}

// How well one preference is met: +1 exactly, 0 one step off (or no opinion),
// −1 two steps off.
function match(pref, actual, scale) {
  if (pref === 'any') return 0;
  const d = Math.abs(scale.indexOf(pref) - scale.indexOf(actual));
  return d === 0 ? 1 : d === 1 ? 0 : -1;
}

/**
 * Everything the ground does to a plant of `level`, standing `span` wide at
 * `col` on terrace `ti`. Pure: it reads the terrace, never writes it.
 *
 * Returns {
 *   grade      −2..+2, the altitude and soil matches summed
 *   altitude, moisture      what the spot actually is
 *   speed      growth multiplier, all bonuses included
 *   yield      fruit per harvest, all bonuses included
 *   bees, compost, variety  the neighbour effects that applied (variety is a count)
 * }
 */
export function fitOf(farm, ti, col, level, ignore) {
  const terrace = farm.terraces[ti];
  const row = farmOf(level);
  const span = row.span;
  const altitude = altitudeOf(ti);
  const moisture = moistureFor(terrace, ti, col, span, ignore);
  const grade = match(row.alt, altitude, ALTITUDES) + match(row.water, moisture, MOISTURES);

  const near = neighboursOf(terrace, col, span, ignore);
  const bees = near.some((p) => p.kind === 'beehive');
  const compost = near.some((p) => p.kind === 'compost');
  const others = new Set();
  for (const p of near) if (!isStructure(p.kind) && p.level && p.level !== level) others.add(p.level);
  const variety = Math.min(2, others.size);

  const speed = (TUNING.gradeSpeed[grade] ?? 1)
    * (compost ? 1 + TUNING.compostSpeed : 1)
    * (1 + TUNING.varietySpeed * variety);

  const base = yieldOf(level);
  const share = (grade === 2 ? TUNING.idealYieldBonus : 0) + (bees ? TUNING.beeYieldBonus : 0);
  const bearing = base + Math.floor(base * share);

  return { grade, altitude, moisture, speed, yield: bearing, bees, compost, variety };
}

// The same question for a plot already in the ground.
export function fitOfPlot(farm, ti, plot) {
  return fitOf(farm, ti, plot.col, plot.level);
}

// The player-facing reasons, short enough for a seed card: what the fruit
// wants, and whether this spot has it.
export function likesOf(level) {
  const row = farmOf(level);
  const parts = [];
  if (row.alt !== 'any') parts.push(ALTITUDE_NAMES[row.alt].split(' ')[0].toLowerCase());
  if (row.water !== 'any') parts.push(`${row.water} soil`);
  return parts.length ? `Likes ${parts.join(', ')}` : 'Grows anywhere';
}

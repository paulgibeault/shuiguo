// A crate, as a data structure: how many of each level are in it.
//
// Pure module — js/constants.js for MAX_LEVEL and nothing else. No clock, no
// rng of its own, no DOM.
//
// This used to live inside js/campaign.js, because the campaign's crate and its
// seed drawer were the only two multisets in the game. A friend's stall has one
// now too, and free play must not have to import the CAMPAIGN's state module to
// count fruit — so the multiset and the weighted draw over it moved down here,
// where both halves of the game can reach them, and js/campaign.js re-exports
// the four verbs its own callers already knew.
//
// The hostile-save discipline is part of the structure rather than of whoever
// stores it: `unpack` believes integer levels in range and positive counts under
// a cap, and quietly drops everything else.

import { MAX_LEVEL } from './constants.js';

// A crate is a bare map so a level named `constructor` cannot mean anything.
export function emptyCounts() { return Object.create(null); }

export function isLevel(level) {
  return Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL;
}

export function countOf(counts, level) {
  const n = counts[level];
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function totalCount(counts) {
  let n = 0;
  for (const level of Object.keys(counts)) n += countOf(counts, level);
  return n;
}

// Levels present, low to high — the order every chip strip is drawn in.
export function levelsIn(counts) {
  return Object.keys(counts)
    .map(Number)
    .filter((level) => countOf(counts, level) > 0)
    .sort((a, b) => a - b);
}

export function addCount(counts, level, n = 1) {
  if (!isLevel(level) || !Number.isInteger(n) || n <= 0) return false;
  counts[level] = countOf(counts, level) + n;
  return true;
}

export function takeCount(counts, level, n = 1) {
  if (countOf(counts, level) < n) return false;
  const left = counts[level] - n;
  if (left > 0) counts[level] = left; else delete counts[level];
  return true;
}

// One fruit out of a crate, weighted by what is left — the same feel as the rng
// dropper, out of stock that empties — and null once there is nothing in it.
// That null is what propagates through js/game.js to end a run.
export function drawFromCrate(crate, rng) {
  const total = totalCount(crate);
  if (total <= 0) return null;
  let pick = Math.floor(rng() * total);
  if (!(pick >= 0)) pick = 0;
  if (pick >= total) pick = total - 1;
  for (const level of levelsIn(crate)) {
    const n = countOf(crate, level);
    if (pick < n) { takeCount(crate, level, 1); return level; }
    pick -= n;
  }
  return null;   // unreachable while totalCount agrees with the keys
}

// ── save shape ─────────────────────────────────────────────────────────────

export function packCounts(counts) {
  const out = {};
  for (const level of levelsIn(counts)) out[level] = countOf(counts, level);
  return out;
}

export function unpackCounts(raw) {
  const counts = emptyCounts();
  if (!raw || typeof raw !== 'object') return counts;
  for (const key of Object.keys(raw)) {
    const level = Number(key);
    const n = raw[key];
    // Integer keys only, and a cap: a crate is a crate, not a shipping container.
    if (isLevel(level) && Number.isInteger(n) && n > 0 && n <= 9999) counts[level] = n;
  }
  return counts;
}

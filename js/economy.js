// What a market day is worth, and what everything costs.
//
// Pure module — imports js/constants.js and nothing else. No clock, no rng, no
// DOM. The hosts do the arithmetic nowhere: if a number in the campaign came
// from adding or multiplying anything, it came from here.
//
// One currency (元) and one exchange rate: 1 score point = 1 元. Score and cash
// never convert the other way — the free-play leaderboard is arcade pride and
// stays out of the economy entirely.

import { TUNING, MAX_LEVEL, MAX_TERRACES, scoreOf, seedCostOf } from './constants.js';

// Endings that count as putting the stall away neatly. Topping out is never
// punished beyond ending the run (design pillar: every ending is a sale), but
// stopping ON PURPOSE should feel like the smart play rather than the cowardly
// one — so it, and selling the crate to the last cherry, earn the Tidy Stall.
const TIDY_REASONS = new Set(['packed', 'sold-out']);

export function isTidy(reason) { return TIDY_REASONS.has(reason); }

// The Tidy Stall bonus as the number a button can wear. "Pack up 收摊" reads as
// quitting when it is in fact the smart play, and the cheapest way to say so is
// to print the reward on it — from the knob, so the button and the till can
// never quote different percentages.
export function tidyBonusPercent() { return Math.round(TUNING.tidyBonus * 100); }

// The appraisal, itemized. The sheet in js/market-host.js lands these lines one
// at a time — coins off each fruit, then the stamp — so every number the player
// watches arrive has its own field here rather than being backed out of a total.
//
//   score        merge score earned during the run (g.score)
//   boardLevels  the levels still sitting on the counter when the run ended
//   reason       'toppled' | 'packed' | 'sold-out'
//   isFirstRun   the gift run, which is floored so the farm is always affordable
//
// Deep merging is intrinsically the high-paying play — a watermelon built from
// scratch banked 1+2+…+1024 on the way up — while an unmerged board still sells
// at face value. No fruit is ever wasted, including annihilated ones: they paid
// ANNIHILATE_SCORE as score on the way out.
export function appraise({ score = 0, boardLevels = [], reason = 'toppled', isFirstRun = false } = {}) {
  const runScore = Math.max(0, Math.floor(score) || 0);

  let boardValue = 0;
  for (const level of boardLevels) {
    if (Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL) boardValue += scoreOf(level);
  }

  const subtotal = runScore + boardValue;
  const tidyBonus = isTidy(reason) ? Math.round(subtotal * TUNING.tidyBonus) : 0;
  // The floor is a top-up, never a cap: a good first run keeps everything it
  // earned and simply sees no top-up line at all.
  const beforeFloor = subtotal + tidyBonus;
  const floorTopUp = isFirstRun ? Math.max(0, TUNING.firstRunFloor - beforeFloor) : 0;

  return { runScore, boardValue, tidyBonus, floorTopUp, total: beforeFloor + floorTopUp };
}

// ── prices ─────────────────────────────────────────────────────────────────
// Every shop row reads its number through one of these, so a price exists in
// exactly one place (constants.js) and the shop can never quote one figure and
// charge another.

export const priceOfSeed = seedCostOf;

// Terrace 1 IS the starter farm and is bought as a farm, not as a terrace —
// terraceCosts[0] is 0 for that reason. Asking for a terrace beyond the
// mountainside returns null: "not for sale", which is what the shop renders.
export function priceOfTerrace(index) {
  if (!Number.isInteger(index) || index <= 0 || index >= MAX_TERRACES) return null;
  return TUNING.terraceCosts[index];
}

export const EQUIPMENT = {
  farm: TUNING.starterFarmCost,
  sprinkler: TUNING.sprinklerCost,
  irrigation: TUNING.irrigationCost,
  trellis: TUNING.trellisCost,
  fertilizer: TUNING.fertilizerCost,
};

export function priceOfEquipment(what) {
  return Object.prototype.hasOwnProperty.call(EQUIPMENT, what) ? EQUIPMENT[what] : null;
}

// Trivial by design, and that is the point: hosts stay arithmetic-free, and
// "can I afford this" means the same thing (and greys the same rows) everywhere.
// A null price is unbuyable, not free.
export function canBuy(cash, price) {
  return typeof price === 'number' && isFinite(price) && typeof cash === 'number' && cash >= price;
}

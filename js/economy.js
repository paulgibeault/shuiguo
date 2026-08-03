// What a market day is worth, and what everything costs.
//
// Pure module — imports js/constants.js and nothing else. No clock, no rng, no
// DOM. The hosts do the arithmetic nowhere: if a number in the campaign came
// from adding or multiplying anything, it came from here.
//
// One currency (元). A fruit's FACE value is its arcade score at 1:1 — that is
// what it fetches sitting unmerged on the counter — but a merge is priced by
// the merchant's curve below and fetches considerably more. Cash never converts
// back into score: the free-play leaderboard is arcade pride and stays out of
// the economy entirely.

import {
  TUNING, MAX_LEVEL, MAX_TERRACES, ANNIHILATE_SCORE, scoreOf, seedCostOf,
} from './constants.js';

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

// ── the merchant's curve ───────────────────────────────────────────────────
//
// What one merge is WORTH to a merchant, as opposed to what it scores on an
// arcade board. The two are different questions and this is the only place the
// first one is answered: hosts add up what comes out of here and nothing else.
//
// Free play never calls any of it. FRUITS[].score stays the arcade table, and
// a free-play run's score is pride that buys nothing.

// A level's multiple of face value. Out-of-range levels price at face rather
// than throwing: a premium is a bonus, and the fallback for "I don't know this
// fruit" is to pay for it honestly.
export function tierPremium(level) {
  const p = TUNING.tierPremium[level - 1];
  return typeof p === 'number' && isFinite(p) && p > 0 ? p : 1;
}

// What a combo of `chain` merges multiplies the last of them by. A 1-chain is
// the absence of a combo and multiplies by exactly 1 — no epsilon, so a knob of
// 0 disables the whole idea cleanly.
export function chainMultiplier(chain) {
  const n = Number.isFinite(chain) && chain >= 1 ? Math.floor(chain) : 1;
  return 1 + TUNING.chainBonus * (n - 1);
}

// One merge, in 元. This is the number the float says (js/market-host.js) and
// the number the till counts, which is why there is one function and not two.
export function mergeValue(level, chain = 1) {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return 0;
  return Math.round(scoreOf(level) * tierPremium(level) * chainMultiplier(chain));
}

// Two watermelons, in 元. Priced off the top of the tier table so the ultimate
// merge can never pay worse than the merge below it — pinned by tests/economy,
// because "the biggest thing the board can do is a sacrifice" would be a bug
// nobody reports and everybody feels.
export function annihilateValue(chain = 1) {
  return Math.round(ANNIHILATE_SCORE * tierPremium(MAX_LEVEL) * chainMultiplier(chain));
}

// The appraisal, itemized. The sheet in js/market-host.js lands these lines one
// at a time — coins off each fruit, then the stamp — so every number the player
// watches arrive has its own field here rather than being backed out of a total.
//
//   earnings     元 banked by merges during the run, per mergeValue above
//   boardLevels  the levels still sitting on the counter when the run ended
//   reason       'toppled' | 'packed' | 'sold-out'
//   isFirstRun   the gift run, which is floored so the farm is always affordable
//
// Deep merging is the high-paying play by construction — that is what the tier
// premium buys — while an unmerged board sells at FACE value and earns none of
// it. That asymmetry is the point: fruit you never merged did not earn a
// merchant's price. Nothing is wasted either way, including annihilated fruit,
// which paid on the way out.
export function appraise({ earnings = 0, boardLevels = [], reason = 'toppled', isFirstRun = false } = {}) {
  const runEarnings = Math.max(0, Math.floor(earnings) || 0);

  let boardValue = 0;
  for (const level of boardLevels) {
    if (Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL) boardValue += scoreOf(level);
  }

  const subtotal = runEarnings + boardValue;
  const tidyBonus = isTidy(reason) ? Math.round(subtotal * TUNING.tidyBonus) : 0;
  // The floor is a top-up, never a cap: a good first run keeps everything it
  // earned and simply sees no top-up line at all.
  const beforeFloor = subtotal + tidyBonus;
  const floorTopUp = isFirstRun ? Math.max(0, TUNING.firstRunFloor - beforeFloor) : 0;

  return { runEarnings, boardValue, tidyBonus, floorTopUp, total: beforeFloor + floorTopUp };
}

// The friend's split of a stall you minded for them, in 元.
//
// Arcade score at 1:1, and the merchant's curve above deliberately does not
// apply: a friend's stall is an arcade board, and its score is arcade score.
// The cut then keeps a fraction of that, which is what makes minding a stall
// the fallback activity rather than the optimum — the answer to an empty crate
// and nothing ripening, not a replacement for a market day.
export function friendCut(score) {
  const earned = Math.max(0, Math.floor(score) || 0);
  return Math.floor(earned * TUNING.friendCut);
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

// Everything the campaign remembers between a market run and the next one:
// the till, the seed drawer, which seeds the player has earned the right to
// plant, the crate travelling between the two halves, and where in the opening
// they are.
//
// Pure module. It imports js/farm.js (also pure) because the farm IS campaign
// state and rides in the same save; it imports js/progress.js to reuse the
// first-make detection the free-play discovery cards already run on. It never
// imports js/game.js or any painter — the two halves of the game only meet in a
// host (see the data-flow rule in docs/farm-plan.md §2).
//
// Two rules hold everything else up:
//
//   Cash never goes negative. Every spend is a guarded verb that reports
//   whether it happened; there is no path that debits an unaffordable price.
//
//   Seed unlocks are CAMPAIGN-SCOPED. The menu chart / `discovered` stat stays
//   the global collection book that either mode fills in, but the right to
//   PLANT a level is earned only by merging one in a campaign run — otherwise a
//   single lucky free-play game would skip the whole progression.

import { TUNING, PINEAPPLE_LEVEL } from './constants.js';
import { isDiscoverable } from './progress.js';
import {
  makeStarterFarm, msUntilNextRipe, serialize as serializeFarm, restore as restoreFarm,
} from './farm.js';
import {
  emptyCounts, isLevel, countOf, totalCount, levelsIn, addCount, takeCount,
  packCounts, unpackCounts,
} from './counts.js';

// The crate and the seed drawer are both level→n multisets, and the structure
// itself lives in js/counts.js so free play can hold one without importing the
// campaign. These four are the verbs this module's own callers already knew, so
// they stay part of its surface.
export { countOf, totalCount, levelsIn, drawFromCrate } from './counts.js';

const SAVE_VERSION = 1;

// The cherry is the one seed nobody has to earn: it is what the starter farm is
// planted with, and merging is how every other level is unlocked.
export const STARTER_SEED = 1;

// ── the campaign ───────────────────────────────────────────────────────────
//
// Phases exist so the two onboarding beats can gate affordances without a line
// of dialog: 'gift-run' has no farm to visit yet, 'buy-farm' is the pan up the
// mountainside to the 出售 sign, and 'open' is the game.

export function makeCampaign() {
  const crate = emptyCounts();
  for (const [level, n] of Object.entries(TUNING.giftCrate)) addCount(crate, Number(level), n);
  return {
    phase: 'gift-run',
    cash: 0,
    seeds: emptyCounts(),
    unlocked: new Set([STARTER_SEED]),
    crate,
    farm: null,
    firstRunDone: false,
  };
}

// ── the till ───────────────────────────────────────────────────────────────

export function earn(c, amount) {
  if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) return 0;
  const gained = Math.floor(amount);
  c.cash += gained;
  return gained;
}

// The only way money leaves the campaign. Refuses rather than overdrawing, so
// "can never go broke-stuck" is a property of the code and not of the prices.
export function spend(c, price) {
  if (typeof price !== 'number' || !isFinite(price) || price < 0) return false;
  if (c.cash < price) return false;
  c.cash -= Math.floor(price);
  return true;
}

// ── the seed drawer ────────────────────────────────────────────────────────

export function seedCount(c, level) { return countOf(c.seeds, level); }
export function isUnlocked(c, level) { return c.unlocked.has(level); }

export function addSeeds(c, level, n = 1) { return addCount(c.seeds, level, n); }
export function takeSeed(c, level) { return takeCount(c.seeds, level, 1); }

// Levels the shop is allowed to sell, low to high.
export function unlockedLevels(c) {
  return [...c.unlocked].filter(isLevel).sort((a, b) => a - b);
}

// ── the crate ──────────────────────────────────────────────────────────────
//
// MVP crate: everything harvested and not yet dropped. Choosing what to pack is
// designed-for but not built (farm-plan §9) — the model already supports it.

export function crateSize(c) { return totalCount(c.crate); }

// A harvest goes straight in. Pineapples additionally pay out a bonus seed of a
// random unlocked level: without it the 24-hour joke would be strictly-worse
// economics, and with it the wait is an EVENT rather than an investment.
export function harvestInto(c, picked, rng) {
  if (!picked || !isLevel(picked.level) || !Number.isInteger(picked.count) || picked.count <= 0) {
    return null;
  }
  addCount(c.crate, picked.level, picked.count);
  let bonusSeed = null;
  if (picked.level === PINEAPPLE_LEVEL && rng) {
    const choices = unlockedLevels(c);
    if (choices.length) {
      bonusSeed = choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))];
      addSeeds(c, bonusSeed, 1);
    }
  }
  return { level: picked.level, count: picked.count, bonusSeed };
}

// Unsold fruit, back in the crate.
//
// The dropper takes its whole preview out of the harvest the moment the stall
// opens — the fruit in hand plus the queue above the awning — so a day that
// ends with any of it unsold has to put it back, or the preview would quietly
// tax every early pack-up by six fruit. Junk levels are dropped rather than
// repaired, as everywhere.
export function returnToCrate(c, levels) {
  let put = 0;
  for (const level of levels || []) if (addCount(c.crate, level, 1)) put++;
  return put;
}

// ── unlocks and the seed drip ──────────────────────────────────────────────
//
// A run's merges are tallied as they happen rather than reconstructed at the
// end, because whether a merge was drip-eligible depends on whether its level
// was already unlocked AT THAT MOMENT — the first pear of a run unlocks the
// pear, and only the pears after it can drip.

export function makeRunTally() {
  return { unlockedThisRun: [], dripEligible: emptyCounts() };
}

// Fold a drained event batch in. Returns the levels newly unlocked by it, in
// the order they happened, for the host to celebrate with a discovery card
// (reworded kicker: 新种子! new seed!) — the same idiom, a different reason.
export function noteMerges(c, tally, events) {
  const unlockedNow = [];
  for (const ev of events) {
    if (ev.type !== 'merge' || !isDiscoverable(ev.level)) continue;
    if (c.unlocked.has(ev.level)) {
      addCount(tally.dripEligible, ev.level, 1);
      continue;
    }
    c.unlocked.add(ev.level);
    addSeeds(c, ev.level, TUNING.firstUnlockSeeds);
    tally.unlockedThisRun.push(ev.level);
    unlockedNow.push(ev.level);
  }
  return unlockedNow;
}

// Rolled once, at appraisal, over the whole run's eligible merges — so the
// reward batches into one satisfying "seeds found in the till" line instead of
// dribbling out mid-run, and a restored board save cannot be re-rolled for it.
//
// `TUNING.seedDripChance: 0` means EXACTLY never. The comparison is `< chance`
// on a generator whose range is [0, 1), so a zero chance can never be met by
// any draw — no epsilon, no lucky zero.
export function rollSeedDrip(c, tally, rng) {
  const found = emptyCounts();
  const chance = TUNING.seedDripChance;
  if (!(chance > 0)) return found;
  for (const level of levelsIn(tally.dripEligible)) {
    let n = 0;
    for (let i = 0; i < countOf(tally.dripEligible, level); i++) if (rng() < chance) n++;
    if (n > 0) { addCount(found, level, n); addSeeds(c, level, n); }
  }
  return found;
}

// ── the phase machine ──────────────────────────────────────────────────────

// The gift run is a market run with no farm behind it. Afterwards the player is
// always solvent enough to buy one — js/economy.js floors that first appraisal.
export function finishFirstRun(c, total) {
  if (c.phase !== 'gift-run') return false;
  earn(c, total);
  c.firstRunDone = true;
  c.phase = 'buy-farm';
  return true;
}

export function canBuyFarm(c) {
  return c.phase === 'buy-farm' && c.cash >= TUNING.starterFarmCost;
}

export function buyFarm(c, wallNow) {
  if (!canBuyFarm(c)) return false;
  spend(c, TUNING.starterFarmCost);
  c.farm = makeStarterFarm(wallNow);
  for (const [level, n] of Object.entries(TUNING.starterSeeds)) addSeeds(c, Number(level), n);
  c.phase = 'open';
  return true;
}

// Can the player take a stall today? One rule in every phase: something has to
// be in the crate. `buy-farm` counts — a player who came up short of the farm
// has exactly one honest thing to do about it, which is go and earn the rest,
// and the fruit left in the gift crate is what they earn it with. Gating that
// phase out left the leftover crate unsellable and the Market button lit up
// over nothing.
export function canGoToMarket(c) {
  return crateSize(c) > 0;
}

// Is the opening over — is there a farm behind this player? The phase strings
// are this module's vocabulary and stay in it: hosts asked `c.phase === 'open'`
// in two places to mean this, which is a policy predicate spelled as a magic
// string somewhere that has no business knowing the phase machine exists.
export function hasFarm(c) {
  return !!c && c.phase === 'open';
}

// Is there nothing to do up here right now?
//
// Nothing in the crate to carry down the hill, and nothing ripening soon enough
// to be worth waiting for. It is the campaign's own read of its own dead spot —
// the farm host only paints the badge — and being a predicate rather than three
// conditions assembled in a host is what makes it testable without a DOM.
//
// `null` from msUntilNextRipe means nothing is on its way anywhere at all, which
// is the emptiest the farm gets and the case that most wants pointing somewhere.
export function couldUseAHand(c, wallNow) {
  if (!hasFarm(c) || !c.farm || canGoToMarket(c)) return false;
  const next = msUntilNextRipe(c.farm, wallNow);
  return next == null || next > TUNING.friendNudgeMs;
}

// ── save / restore ─────────────────────────────────────────────────────────
// Hostile-save discipline, as everywhere: validate field by field, discard what
// we cannot believe. The worst a crafted save may do is give the player a farm
// that is emptier than they left it — never cash, seeds, or unlocks they never
// earned beyond what the table itself allows.

const PHASES = new Set(['gift-run', 'buy-farm', 'open']);

export function serialize(c) {
  return {
    v: SAVE_VERSION,
    phase: c.phase,
    cash: Math.max(0, Math.floor(c.cash)),
    seeds: packCounts(c.seeds),
    unlocked: unlockedLevels(c),
    crate: packCounts(c.crate),
    farm: c.farm ? serializeFarm(c.farm) : null,
    firstRunDone: !!c.firstRunDone,
  };
}

export function restore(save) {
  if (!save || save.v !== SAVE_VERSION) return null;
  const c = makeCampaign();
  c.crate = unpackCounts(save.crate);
  c.seeds = unpackCounts(save.seeds);
  c.cash = typeof save.cash === 'number' && isFinite(save.cash) ? Math.max(0, Math.floor(save.cash)) : 0;
  c.firstRunDone = save.firstRunDone === true;

  c.unlocked = new Set([STARTER_SEED]);
  if (Array.isArray(save.unlocked)) {
    for (const level of save.unlocked) if (isLevel(level)) c.unlocked.add(level);
  }

  c.farm = save.farm ? restoreFarm(save.farm) : null;

  // The phase and the farm have to agree, or the host has a screen to show and
  // nothing to draw on it. The farm is the evidence: having one means the
  // opening is over, and not having one means it is not.
  const phase = PHASES.has(save.phase) ? save.phase : 'gift-run';
  if (c.farm) c.phase = 'open';
  else if (phase === 'open') c.phase = c.firstRunDone ? 'buy-farm' : 'gift-run';
  else c.phase = phase;
  if (c.phase === 'buy-farm') c.firstRunDone = true;
  return c;
}

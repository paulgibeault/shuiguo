// Whose stall you are minding, and how they stock it.
//
// Pure module — no DOM, no clock, no Arcade. It imports js/constants.js for the
// cast and js/campaign.js to ask whether a seed has been earned, and that is
// the whole of it. The hosts do no arithmetic here either: a friend's dropper
// is a function this file hands them.
//
// The one rule worth stating out loud: a BALANCED stall is one whose crate of
// the sky is stocked evenly, and an evenly-stocked stall is the only one whose
// runs are comparable with each other. That is why records are gated on it —
// derived from the weights rather than from a flag, so a friend added to the
// table later cannot accidentally be let onto the leaderboard by a field
// nobody remembered to set.

import { FRIENDS, MAX_SPAWN_LEVEL } from './constants.js';
import { isUnlocked } from './campaign.js';

// The first friend, and the one everybody has.
//
// 草莓's stall is not something you unlock — it is the endless stall this game
// has always had, and it is open on the very first launch, before there is a
// campaign to earn anything in. (The starter seeds are strawberries, but the
// RIGHT to plant them is earned at market like every other seed, so the seed
// drawer is the wrong thing to ask.) The unlock gate is what opens the REST of
// the cast, which is the half of the loop that needed a gate.
export const FIRST_FRIEND = FRIENDS[0];

// A friend out of the table by the fruit they are. Anything we do not recognise
// is the first friend — a stall you cannot identify is 草莓's, never nobody's.
export function friendOf(level) {
  return FRIENDS.find((f) => f.level === level) || FIRST_FRIEND;
}

// Whose stalls are open. Past the first, earned by merging that fruit in a
// campaign run and nowhere else, which is the whole of the progression tie-in.
export function openFriends(c) {
  return FRIENDS.filter((f) => isFriendOpen(c, f));
}

export function isFriendOpen(c, friend) {
  if (!friend) return false;
  if (friend === FIRST_FRIEND) return true;
  return !!c && isUnlocked(c, friend.level);
}

// Is this stall stocked evenly enough for its scores to mean the same thing as
// everybody else's? See the note at the top: this is the records gate.
export function isBalanced(friend) {
  const w = friend && friend.weights;
  if (!Array.isArray(w) || !w.length) return false;
  return w.every((n) => n === w[0] && n > 0);
}

// One draw from a friend's stock.
//
// Deliberately the same shape as js/campaign.js §drawFromCrate — one rng() call
// turned into an integer index and walked down the buckets — because that makes
// an EVENLY weighted draw byte-identical to the `rng.int(1, MAX_SPAWN_LEVEL)`
// free play has always used. 草莓's stall is not a re-implementation of the old
// dropper; it is the old dropper, reached a different way. tests/friends pins
// that against the real generator.
//
// Hostile weights never throw: anything that is not a non-negative integer
// counts as zero, and a stall with nothing in it at all falls back to an even
// spread rather than to an empty sky.
export function weightedDraw(weights, rng) {
  const ws = [];
  let total = 0;
  for (let i = 0; i < MAX_SPAWN_LEVEL; i++) {
    const w = Array.isArray(weights) ? weights[i] : null;
    const n = Number.isInteger(w) && w > 0 ? w : 0;
    ws.push(n);
    total += n;
  }
  if (total <= 0) {
    ws.fill(1);
    total = MAX_SPAWN_LEVEL;
  }

  let pick = Math.floor(rng() * total);
  if (!(pick >= 0)) pick = 0;
  if (pick >= total) pick = total - 1;
  for (let i = 0; i < MAX_SPAWN_LEVEL; i++) {
    if (pick < ws[i]) return i + 1;
    pick -= ws[i];
  }
  return 1;   // unreachable while the buckets sum to `total`
}

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

// What a stall ACTUALLY has in it: one bucket per spawn level, whatever the
// table happened to write down. Short lists are padded with zeros and anything
// that is not a positive integer counts as nothing, so a stall with an empty sky
// falls back to an even spread rather than being unplayable.
//
// Everything that reasons about a stall's stock goes through here, which is the
// point of it existing. Judging the raw literal instead let `[1, 1, 1]` read as
// evenly stocked to the records gate while it was in fact dropping only three of
// the five levels — ranked, and not comparable with anything.
// `fallback` says the table gave us nothing usable and this spread was invented
// to keep the stall playable — which the records gate needs to know, because a
// stall nobody described is not a stall anybody vouched for.
function stockOf(weights) {
  const ws = [];
  let total = 0;
  const list = Array.isArray(weights) ? weights : [];
  for (let i = 0; i < MAX_SPAWN_LEVEL; i++) {
    const w = list[i];
    const n = Number.isInteger(w) && w > 0 ? w : 0;
    ws.push(n);
    total += n;
  }
  if (total > 0) return { ws, total, fallback: false };
  ws.fill(1);
  return { ws, total: MAX_SPAWN_LEVEL, fallback: true };
}

// Is this stall stocked evenly enough for its scores to mean the same thing as
// everybody else's? See the note at the top: this is the records gate.
//
// Asked of the stock that is actually PLAYED, never of the literal in the
// table: judging the literal let `[1, 1, 1]` read as evenly stocked while it was
// in fact dropping three of the five levels — ranked, and comparable with
// nothing. A stall running on the invented fallback is not comparable either,
// even though it happens to play evenly, because nothing described it.
export function isBalanced(friend) {
  if (!friend) return false;
  const { ws, fallback } = stockOf(friend.weights);
  return !fallback && ws.every((n) => n === ws[0]);
}

// One draw from a friend's stock.
//
// Deliberately the same shape as js/campaign.js §drawFromCrate — one rng() call
// turned into an integer index and walked down the buckets — because that makes
// an EVENLY weighted draw byte-identical to the `rng.int(1, MAX_SPAWN_LEVEL)`
// free play has always used. 草莓's stall is not a re-implementation of the old
// dropper; it is the old dropper, reached a different way. tests/friends pins
// that against the real generator.
export function weightedDraw(weights, rng) {
  const { ws, total } = stockOf(weights);

  let pick = Math.floor(rng() * total);
  if (!(pick >= 0)) pick = 0;
  if (pick >= total) pick = total - 1;
  for (let i = 0; i < MAX_SPAWN_LEVEL; i++) {
    if (pick < ws[i]) return i + 1;
    pick -= ws[i];
  }
  return 1;   // unreachable while the buckets sum to `total`
}

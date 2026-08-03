// Whose stall you are minding, how they stock it, how much of it there is, and
// how long they need before there is any more.
//
// Pure module — no DOM, no clock of its own, no Arcade. It imports
// js/constants.js for the cast, js/counts.js for the crate it hands out and
// js/campaign.js to ask whether a seed has been earned, and that is the whole
// of it. Wall time arrives as an argument, as it does everywhere else in this
// repo. The hosts do no arithmetic here either: a stall's dropper, a stall's
// morning produce and the wait for the next one are all things this file hands
// them.
//
// Two rules worth stating out loud, and both are gates on the leaderboard:
//
//   A BALANCED stall is one whose sky is stocked evenly, and an evenly-stocked
//   stall is the only one whose runs are comparable with each other.
//
//   An ENDLESS stall is one with no crate behind it. A finite morning's produce
//   caps what a run can possibly score, so a crated run is not comparable with
//   an uncapped one either, however evenly the crate was packed.
//
// Both are derived — from the weights and from the crate size — rather than
// from a flag, so a stall added to the table later cannot accidentally be let
// onto the leaderboard by a field nobody remembered to set.

import { FRIENDS, WHOLESALER, FRUITS, MAX_SPAWN_LEVEL } from './constants.js';
import { isUnlocked } from './campaign.js';
import { emptyCounts, addCount } from './counts.js';

// The first friend, and the one everybody has.
//
// 草莓's stall is not something you unlock — it is the endless stall this game
// has always had, and it is open on the very first launch, before there is a
// campaign to earn anything in. (The starter seeds are strawberries, but the
// RIGHT to plant them is earned at market like every other seed, so the seed
// drawer is the wrong thing to ask.) The unlock gate is what opens the REST of
// the cast, which is the half of the loop that needed a gate.
export const FIRST_FRIEND = FRIENDS[0];

// Every stall there is to mind, in the order the map offers them: the
// wholesaler's endless one first, because it is always open and it is the board
// this game shipped with, then the cast.
export const STALLS = [WHOLESALER, ...FRIENDS];

// A friend out of the table by the fruit they are. Anything we do not recognise
// is the first friend — a stall you cannot identify is 草莓's, never nobody's.
export function friendOf(level) {
  return FRIENDS.find((f) => f.level === level) || FIRST_FRIEND;
}

// …and the same question asked of the whole board, including the wholesaler.
// This is what a save is read back through, so it has friendOf's forgiveness:
// a level nobody recognises lands in 草莓's stall rather than nowhere.
export function stallOf(level) {
  return level === WHOLESALER.level ? WHOLESALER : friendOf(level);
}

// What to call this stall, English first. A friend is called by the fruit they
// are; the wholesaler brought their own name.
export function stallName(stall) {
  if (!stall) return '';
  return stall.title || FRUITS[stall.level - 1].name;
}

// …and the line underneath it — the learning half of the same label.
export function stallAlt(stall) {
  if (!stall) return '';
  if (stall.alt) return stall.alt;
  const f = FRUITS[stall.level - 1];
  return `${f.hanzi} ${f.pinyin}`;
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

// ── the morning's produce ──────────────────────────────────────────────────

// How much a stall has to sell today. Zero means endless: nothing was picked
// this morning because nothing has to be — see WHOLESALER in js/constants.js.
export function crateSizeOf(stall) {
  const n = stall && stall.crate;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function isEndless(stall) { return crateSizeOf(stall) === 0; }

// Today's crate, picked from the stall's own weights.
//
// Deliberately drawn rather than tabulated: a crate packed from the same weights
// that used to stock the sky IS that stall, one morning of it, so the flavour a
// player learned from the endless version is the flavour they get in the crate —
// and no two mornings are quite the same. `null` for an endless stall, which is
// the shape the hosts read as "there is no clock on this one".
export function stockCrate(stall, rng) {
  if (isEndless(stall)) return null;
  const crate = emptyCounts();
  for (let i = 0; i < crateSizeOf(stall); i++) addCount(crate, weightedDraw(stall.weights, rng), 1);
  return crate;
}

// ── the morning after ──────────────────────────────────────────────────────
//
// A friend has one farm, and you have just sold everything on it. What that
// costs is time: their stall is shut until they have picked the next morning's
// produce, which is `restockMs` from the moment the day ended.
//
// It is a LIMIT, never a summons — the distinction the design pillars draw
// (docs/farm-plan.md §0), and three things keep it on the right side of it.
// The wholesaler has no clock at all, so there is always a board to play.
// Nothing expires, decays or is lost by not coming back: a restocked stall
// simply waits. And no clock outlives one wait, whatever the stored epoch says
// (see msUntilRestock), so a crafted save, a timezone move or a clock rolled
// forward and back can never shut a friend out for longer than their own
// morning takes.
//
// The clock is a bare level→epoch map, exactly like a crate — the free-play
// host stores it under its own key and the campaign never sees it.

export function restockMsOf(stall) {
  if (!stall || isEndless(stall)) return 0;      // no field behind it, nothing to grow
  const n = stall.restockMs;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function makeStallClock() { return Object.create(null); }

// Their morning is sold. Returns how long they will be picking, which is 0 for
// a stall that is never picking at all — so the caller can skip the save.
export function noteStallSold(clock, stall, wallNow) {
  const wait = restockMsOf(stall);
  if (!clock || !wait || !Number.isFinite(wallNow)) return 0;
  clock[stall.level] = wallNow + wait;
  return wait;
}

// How much longer, in ms. 0 means open, which is what every caller asks first.
//
// Capped at the stall's own wait, and that cap is the hostile-save discipline
// for this file: whatever epoch is in storage, and however far the wall clock
// has moved, the longest anybody is ever shut is one morning.
export function msUntilRestock(clock, stall, wallNow) {
  const wait = restockMsOf(stall);
  if (!clock || !wait || !Number.isFinite(wallNow)) return 0;
  const at = clock[stall.level];
  if (!Number.isFinite(at)) return 0;
  const left = at - wallNow;
  if (!(left > 0)) return 0;
  return Math.min(left, wait);
}

export function isStocked(clock, stall, wallNow) {
  return msUntilRestock(clock, stall, wallNow) === 0;
}

// Save shape, in js/counts.js's register: believe an integer epoch against a
// stall we recognise, drop everything else. A clock we cannot read is an open
// stall, which is the most generous thing a broken one can mean.
export function packStallClock(clock) {
  const out = {};
  for (const stall of STALLS) {
    const at = clock[stall.level];
    if (restockMsOf(stall) && Number.isFinite(at)) out[stall.level] = Math.floor(at);
  }
  return out;
}

export function unpackStallClock(raw) {
  const clock = makeStallClock();
  if (!raw || typeof raw !== 'object') return clock;
  for (const stall of STALLS) {
    if (!restockMsOf(stall)) continue;
    const at = raw[stall.level];
    if (Number.isInteger(at) && at > 0) clock[stall.level] = at;
  }
  return clock;
}

// Does THIS RUN belong on the leaderboard?
//
// Asked of the run and not only of the stall, because the two facts it needs
// come from different places: how the sky is stocked is the table's, and whether
// there is a crate behind it is the run's. A board saved before crates existed
// is an endless run of whatever stall it was in, and it finishes as one.
//
// See the header: a capped run and an uncapped one are not the same game, so
// only an endless, evenly-stocked board competes. That is the wholesaler's, and
// the wholesaler's alone.
export function isRanked(stall, endless) {
  return !!endless && isBalanced(stall);
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

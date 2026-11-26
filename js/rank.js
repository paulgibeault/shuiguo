// The farmer's rank: how the campaign says "here is how far you have come, and
// here is the next thing".
//
// Pure module, data and arithmetic only. Rank is earned by HARVESTING — every
// fruit picked is worth its face value in experience — so it measures the one
// thing the farm is about, and it climbs whether a crop is sold well or badly.
//
// Rank is a gate as well as a badge, and that is the point of it. Before it,
// the only things standing between a new farmer and a mountain of watermelons
// were one lucky market run and a single harvest's cash; the whole campaign
// could be over in a day. Now each rank opens a short, named set of things —
// a seed, a terrace, a tool — and the ladder of what comes next is always on
// show (the Almanac sheet), so the player never has to guess what they are
// working towards.
//
// What each rank unlocks is NOT written here: it is read off the tables that
// own those things (FARM[].rank, STRUCTURES[].rank, TUNING.terraceRanks…), so a
// seed can never be sold at one rank and listed at another.

import { FARM, FRUITS, STRUCTURES, TUNING, MAX_LEVEL } from './constants.js';

// Experience to REACH each rank (rank n is RANKS[n-1]). Roughly ×2.2 a step:
// each rank's crops earn about twice the last's per tile, and there is more
// ground to grow them on, so every step takes a little longer than the one
// before without any of them being a wall. Paced (by simulation of a player
// who drops in three times a day for half an hour) so the first session
// reaches Grower, the first week reaches the orchards, and the top of the
// mountain is a matter of weeks rather than the afternoon it used to be.
export const RANKS = [
  { xp: 0,      title: 'Sprout',          hanzi: '新芽' },
  { xp: 60,     title: 'Seedling',        hanzi: '幼苗' },
  { xp: 250,    title: 'Grower',          hanzi: '果农' },
  { xp: 800,    title: 'Gardener',        hanzi: '园丁' },
  { xp: 2200,   title: 'Orchardist',      hanzi: '果园主' },
  { xp: 5500,   title: 'Hill farmer',     hanzi: '山农' },
  { xp: 12000,  title: 'Terrace keeper',  hanzi: '梯田守' },
  { xp: 25000,  title: 'Harvest master',  hanzi: '丰收师' },
  { xp: 50000,  title: 'Valley elder',    hanzi: '谷长' },
  { xp: 100000, title: 'Mountain sage',   hanzi: '山贤' },
  { xp: 200000, title: 'Fruit king',      hanzi: '果王' },
];
export const MAX_RANK = RANKS.length;

// Experience for a harvest: face value, per fruit.
export function xpOfHarvest(level, count) {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return 0;
  if (!Number.isInteger(count) || count <= 0) return 0;
  return FRUITS[level - 1].score * count;
}

export function rankOf(xp) {
  const v = Number.isFinite(xp) ? xp : 0;
  let r = 1;
  for (let i = 0; i < RANKS.length; i++) if (v >= RANKS[i].xp) r = i + 1;
  return r;
}

export function rankInfo(rank) {
  const r = Math.max(1, Math.min(MAX_RANK, rank | 0));
  return { rank: r, ...RANKS[r - 1] };
}

// Where the player stands between this rank and the next: { rank, into, span,
// fraction, toNext } — `span` and `toNext` are null at the top.
export function progressOf(xp) {
  const rank = rankOf(xp);
  const here = RANKS[rank - 1].xp;
  if (rank >= MAX_RANK) return { rank, into: xp - here, span: null, fraction: 1, toNext: null };
  const next = RANKS[rank].xp;
  return {
    rank,
    into: xp - here,
    span: next - here,
    fraction: Math.max(0, Math.min(1, (xp - here) / (next - here))),
    toNext: next - xp,
  };
}

// The smallest experience that reaches `rank` — used to carry an older save
// forward without demoting anyone below what they already own.
export function xpForRank(rank) {
  return RANKS[Math.max(1, Math.min(MAX_RANK, rank | 0)) - 1].xp;
}

// Everything rank `rank` opens, as display rows: { type, key, name, hanzi }.
// `type` is 'seed' | 'terrace' | 'structure' | 'sprinkler' | 'irrigation'.
export function unlocksAt(rank) {
  const out = [];
  FARM.forEach((row, i) => {
    if (row.rank === rank) out.push({ type: 'seed', key: i + 1, name: FRUITS[i].name, hanzi: FRUITS[i].hanzi });
  });
  TUNING.terraceRanks.forEach((r, i) => {
    if (r === rank && i > 0) out.push({ type: 'terrace', key: i, name: `Terrace ${i + 1}`, hanzi: '梯田' });
  });
  for (const [kind, s] of Object.entries(STRUCTURES)) {
    if (s.rank === rank) out.push({ type: 'structure', key: kind, name: s.name, hanzi: s.hanzi });
  }
  if (TUNING.sprinklerRank === rank) out.push({ type: 'sprinkler', key: 'sprinkler', name: 'Sprinklers', hanzi: '洒水器' });
  if (TUNING.irrigationRank === rank) out.push({ type: 'irrigation', key: 'irrigation', name: 'Stream irrigation', hanzi: '灌溉' });
  return out;
}

// The rank a thing needs. One function per kind of thing, each reading the
// table that owns it.
export function rankForSeed(level) {
  const row = FARM[level - 1];
  return row ? row.rank : MAX_RANK + 1;
}
export function rankForTerrace(index) {
  const r = TUNING.terraceRanks[index];
  return Number.isInteger(r) ? r : MAX_RANK + 1;
}
export function rankForStructure(kind) {
  const s = STRUCTURES[kind];
  return s ? s.rank : MAX_RANK + 1;
}
export function rankForEquipment(what) {
  if (what === 'sprinkler') return TUNING.sprinklerRank;
  if (what === 'irrigation') return TUNING.irrigationRank;
  return 1;
}

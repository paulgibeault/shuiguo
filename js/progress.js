// What the host learns from a drained event batch, and what it remembers
// between games.
//
// Pure module — no DOM, no Arcade, no clock. js/game.js stays the simulation
// and knows nothing about collections or celebration; js/main.js owns the UI
// and the storage calls. This is the reasoning in between, extracted so it can
// be unit-tested against synthetic event batches instead of a live board.

import { MAX_LEVEL } from './constants.js';

// A discovery is a fruit level MADE BY A MERGE for the first time ever, across
// all games. Fruit that fall out of the dropper are not discoveries — levels
// 1–5 arrive for free and celebrating them would cheapen the pear. A merge
// never produces level 1, so the discoverable set is exactly levels 2–11
// (including the small ones: merging two cherries into a strawberry when your
// strawberries have only ever been spawned IS the first strawberry you made).
export function isDiscoverable(level) {
  return Number.isInteger(level) && level >= 2 && level <= MAX_LEVEL;
}

// The stored shape is `{ levels: [2, 3, …] }` under Arcade.stats. Read
// defensively: the bytes are whatever survived storage, sync and export.
export function readDiscovered(stat) {
  const set = new Set();
  const raw = stat && Array.isArray(stat.levels) ? stat.levels : [];
  for (const level of raw) if (isDiscoverable(level)) set.add(level);
  return set;
}

export function packDiscovered(set) {
  return { levels: [...set].sort((a, b) => a - b) };
}

// Which levels does this batch of events newly discover? Returns them in the
// order they happened, each at most once, and does NOT mutate `discovered` —
// the caller decides whether the cards actually got shown before committing.
export function newDiscoveries(discovered, events) {
  const found = [];
  for (const ev of events) {
    if (ev.type !== 'merge') continue;
    if (!isDiscoverable(ev.level)) continue;
    if (discovered.has(ev.level) || found.includes(ev.level)) continue;
    found.push(ev.level);
  }
  return found;
}

// A chain is a run of merges inside one wall-time window (js/game.js
// §bumpChain), and `chain` on each merge event counts up through it. The batch
// the host drains can hold more than one chain's worth of merges, so "the chain
// that just finished" is any value that is not immediately followed by a deeper
// one — a 1,2,3,1,2 batch completed a 3-chain and then a 2-chain.
//
// Since the window went to wall time, the LAST run in a batch is usually not
// finished at all: a combo alive at the end of the frame will deepen in the
// next one. It is still reported, because a 3-chain in flight is a 3-chain that
// happened — what the caller does with it is the caller's rule.
//
// Returns the chain sizes in order. `deepestChain` below is the only caller
// that ships — it takes the max — but the split is kept because the batch is
// genuinely a sequence of combos and collapsing that here would make the shape
// of one unrecoverable.
export function completedChains(events) {
  const out = [];
  let prev = 0;
  for (const ev of events) {
    if (ev.type !== 'merge') continue;
    const chain = ev.chain || 1;
    if (chain <= prev) out.push(prev);
    prev = chain;
  }
  if (prev > 0) out.push(prev);
  return out;
}

// The deepest chain the batch REACHED, or 0 — which is what the banner reads.
//
// Deliberately not "the chain that completed": a windowed combo can still be
// alive when the host drains, so the depth that just completed is unknowable at
// drain time. Firing on the deepest depth reached instead means a deepening
// combo re-shows (3-chain! → 4-chain!) as it grows, which is the behaviour the
// player is watching for anyway.
export function deepestChain(events) {
  let best = 0;
  for (const n of completedChains(events)) if (n > best) best = n;
  return best;
}

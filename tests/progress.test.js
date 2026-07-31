// The host's reasoning about a drained event batch: what counts as a
// discovery, and when a chain has finished. Both are pure, so they are tested
// against synthetic batches rather than a live board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDiscoverable, readDiscovered, packDiscovered, newDiscoveries,
  completedChains, deepestChain,
} from '../js/progress.js';
import { MAX_LEVEL } from '../js/constants.js';

const merge = (level, chain = 1) => ({ type: 'merge', level, chain });
const dropped = (level) => ({ type: 'drop', level });

// ── discovery ──────────────────────────────────────────────────────────────

test('only levels a merge can produce are discoverable', () => {
  assert.equal(isDiscoverable(1), false, 'a cherry is never merge-born');
  assert.equal(isDiscoverable(2), true);
  assert.equal(isDiscoverable(MAX_LEVEL), true);
  assert.equal(isDiscoverable(MAX_LEVEL + 1), false);
  assert.equal(isDiscoverable(2.5), false);
  assert.equal(isDiscoverable('3'), false);
});

test('a merge-born low-level fruit still counts as a discovery', () => {
  // level 2 is spawnable, but MAKING one is the thing being celebrated
  assert.deepEqual(newDiscoveries(new Set(), [merge(2)]), [2]);
});

test('a fruit out of the dropper is not a discovery', () => {
  assert.deepEqual(newDiscoveries(new Set(), [dropped(3), dropped(5)]), []);
});

test('an already-discovered fruit does not re-fire', () => {
  assert.deepEqual(newDiscoveries(new Set([8]), [merge(8)]), []);
});

test('two discoveries in one chain each fire exactly once', () => {
  const found = newDiscoveries(new Set(), [merge(6, 1), merge(7, 2), merge(7, 3), merge(6, 4)]);
  assert.deepEqual(found, [6, 7], 'in the order they happened, no repeats');
});

test('newDiscoveries does not mutate the set it is given', () => {
  const set = new Set([3]);
  newDiscoveries(set, [merge(9)]);
  assert.deepEqual([...set], [3]);
});

test('other event types are ignored', () => {
  const events = [
    { type: 'bounce', level: 9 }, { type: 'annihilate' },
    { type: 'gameover' }, { type: 'start' },
  ];
  assert.deepEqual(newDiscoveries(new Set(), events), []);
});

// ── persistence shape ──────────────────────────────────────────────────────

test('the stored set round-trips, sorted', () => {
  const packed = packDiscovered(new Set([9, 2, 11]));
  assert.deepEqual(packed, { levels: [2, 9, 11] });
  assert.deepEqual([...readDiscovered(packed)], [2, 9, 11]);
});

test('a hostile or absent stat reads as an empty set', () => {
  for (const bad of [undefined, null, {}, { levels: 'all' }, { levels: null }]) {
    assert.equal(readDiscovered(bad).size, 0);
  }
  // and junk inside a well-shaped array is dropped item by item
  assert.deepEqual([...readDiscovered({ levels: [1, 4, 99, '5', null, 4] })], [4]);
});

// ── chain completion ───────────────────────────────────────────────────────

test('a lone merge completes a 1-chain', () => {
  assert.deepEqual(completedChains([merge(3, 1)]), [1]);
  assert.equal(deepestChain([merge(3, 1)]), 1);
});

test('a cascade closes out at its deepest link', () => {
  const events = [merge(3, 1), merge(4, 2), merge(5, 3)];
  assert.deepEqual(completedChains(events), [3]);
  assert.equal(deepestChain(events), 3);
});

test('two chains in one drained batch are told apart', () => {
  // one frame can drain several ticks: a 3-chain, then a 2-chain
  const events = [merge(3, 1), merge(4, 2), merge(5, 3), merge(2, 1), merge(3, 2)];
  assert.deepEqual(completedChains(events), [3, 2]);
  assert.equal(deepestChain(events), 3);
});

test('consecutive single merges are separate 1-chains, not one long one', () => {
  assert.deepEqual(completedChains([merge(3, 1), merge(4, 1), merge(2, 1)]), [1, 1, 1]);
});

test('non-merge events between chains do not split or join them', () => {
  const events = [merge(3, 1), { type: 'bounce' }, merge(4, 2), { type: 'drop', level: 2 }];
  assert.deepEqual(completedChains(events), [2]);
});

test('a batch with no merges completes nothing', () => {
  assert.deepEqual(completedChains([dropped(2), { type: 'gameover' }]), []);
  assert.equal(deepestChain([]), 0);
});

test('a merge event missing chain is treated as a 1-chain', () => {
  assert.equal(deepestChain([{ type: 'merge', level: 4 }]), 1);
});

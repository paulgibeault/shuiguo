// What a fruit's page in the collection book SAYS.
//
// The page is the one screen in the game that is purely information, and every
// number on it is quoted from a table somewhere else — the arcade score, the
// merchant's curve, the farm's columns. So the risk here is not a crash, it is
// a page that quietly disagrees with the shop, the board or the plot sheet
// about the same fruit. Every assertion below is that agreement, asked of the
// tables rather than of a literal.
//
// DOM-free: js/collection.js keeps the page's contents as data for exactly this
// reason, and the tiles themselves are covered by tests/host-boot, which boots
// the real thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fruitStats, chainNote } from '../js/collection.js';
import {
  FRUITS, MAX_LEVEL, ANNIHILATE_SCORE, scoreOf, isPerennial, growthOf, cycleOf,
  yieldOf, seedCostOf,
} from '../js/constants.js';
import { mergeValue } from '../js/economy.js';
import { money, span } from '../js/format.js';

const valueOf = (rows, label) => (rows.find(([l]) => l.startsWith(label)) || [])[1];

test('every fruit has a page, and every page quotes the tables', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const rows = fruitStats(level);
    assert.ok(rows.length >= 6, `level ${level} has almost nothing on its page`);
    assert.equal(valueOf(rows, 'Score'), `+${money(scoreOf(level))}`);
    assert.equal(valueOf(rows, 'At market'), `${money(mergeValue(level))}元`);
    assert.equal(valueOf(rows, 'Size'), `×${FRUITS[level - 1].scale}`);
    assert.equal(valueOf(rows, 'First crop'), span(growthOf(level)));
    assert.equal(valueOf(rows, 'Harvest'), `×${yieldOf(level)}`);
    const price = isPerennial(level) ? valueOf(rows, 'Sapling') : valueOf(rows, 'Seed');
    assert.equal(price, `${money(seedCostOf(level))}元`, `level ${level} is priced wrong`);
  }
});

// A perennial's second number is the whole difference between the two kinds of
// plot: an annual is planted for one crop, a tree keeps paying.
test('only a perennial has a cycle to show', () => {
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const cycle = valueOf(fruitStats(level), 'Then every');
    if (isPerennial(level)) assert.equal(cycle, span(cycleOf(level)), `level ${level} hid its cycle`);
    else assert.equal(cycle, undefined, `level ${level} is an annual with a cycle`);
  }
});

// The drawer is the only row that is about the PLAYER, so it is the only one
// that waits for them to have a farm to have a drawer in.
test('the seed drawer shows up only once there is a farm to plant in', () => {
  assert.equal(valueOf(fruitStats(2, { seeds: 4 }), 'In the drawer'), undefined,
    'a player with no farm was told what is in their drawer');
  assert.equal(valueOf(fruitStats(2, { seeds: 4, hasFarm: true }), 'In the drawer'), '×4');
  assert.equal(valueOf(fruitStats(2, { hasFarm: true }), 'In the drawer'), '×0',
    'an empty drawer said nothing rather than nothing-in-it');
});

test('a level nobody recognises has no page at all, rather than a page of undefined', () => {
  for (const junk of [0, -1, 1.5, MAX_LEVEL + 1, NaN, null, undefined, '3']) {
    assert.deepEqual(fruitStats(junk), [], `fruitStats(${String(junk)})`);
    assert.equal(chainNote(junk), '');
  }
});

// The chain, in a sentence, and it has to be right at both ends: the cherry is
// dropped rather than made, and two watermelons annihilate rather than merging
// into a twelfth fruit that does not exist.
test('the chain note names the fruit either side, and knows where the chain stops', () => {
  const grape = chainNote(3);
  assert.ok(grape.includes('Strawberry') && grape.includes('草莓'), `the grape came from nowhere: ${grape}`);
  assert.ok(grape.includes('Dekopon') && grape.includes('橘子'), `the grape leads nowhere: ${grape}`);

  assert.ok(!chainNote(1).includes('undefined'), 'the cherry is made from something');
  assert.match(chainNote(1), /dropper/, 'the cherry does not say where it comes from');
  assert.ok(chainNote(1).includes('Strawberry'), 'the cherry leads nowhere');

  const melon = chainNote(MAX_LEVEL);
  assert.ok(melon.includes('Melon'), 'the watermelon came from nowhere');
  assert.ok(melon.includes(String(ANNIHILATE_SCORE)), `the top of the chain hides the payout: ${melon}`);
});

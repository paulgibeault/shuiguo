// The one string the farm computes. It is tiny and it is load-bearing: the
// countdown chip is the only place the game promises the player a time, and a
// promise that is off by a second the wrong way is a promise that gets caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countdown, money, multiplier } from '../js/format.js';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

test('under an hour it is a stopwatch: m:ss', () => {
  assert.equal(countdown(31 * SEC), '0:31');
  assert.equal(countdown(9 * SEC), '0:09');
  assert.equal(countdown(2 * MIN + 31 * SEC), '2:31');
  assert.equal(countdown(59 * MIN + 59 * SEC), '59:59');
});

test('an hour and over it is a clock: h:mm', () => {
  assert.equal(countdown(HOUR), '1:00');
  assert.equal(countdown(3 * HOUR + 5 * MIN), '3:05');
  assert.equal(countdown(24 * HOUR), '24:00');       // the pineapple, in full
});

// Rounding UP is the whole rule: a chip that says 0:00 over something still
// growing is a chip nobody believes the second time.
test('it never says ready before it is', () => {
  assert.equal(countdown(1), '0:01');
  assert.equal(countdown(999), '0:01');
  assert.equal(countdown(SEC), '0:01');
  assert.equal(countdown(SEC + 1), '0:02');
  assert.equal(countdown(HOUR + 1), '1:01');
});

test('ready, and nonsense, are both 0:00 rather than an error', () => {
  for (const junk of [0, -1, -HOUR, NaN, Infinity, -Infinity, null, undefined, '90', {}]) {
    assert.equal(countdown(junk), '0:00', `countdown(${String(junk)})`);
  }
});

// Within one regime the chip only ever counts down. Across the hour boundary
// the UNIT changes (59:59 of seconds becomes 1:00 of minutes), so the two are
// checked separately — a single sweep would be comparing minutes to seconds.
test('it never runs backwards as the clock runs forwards', () => {
  for (const [from, to] of [[59 * MIN, 0], [12 * HOUR, HOUR]]) {
    let previous = null;
    for (let ms = from; ms > to; ms -= 977) {
      const now = ticks(countdown(ms));
      if (previous != null) assert.ok(now <= previous, `${previous} then ${now} at ${ms}ms`);
      previous = now;
    }
  }
});

// "2:31" as a plain count of whatever unit it is in, for ordering only.
function ticks(text) {
  const [a, b] = text.split(':').map(Number);
  return a * 60 + b;
}

// ── 元 ──────────────────────────────────────────────────────────────────────

test('元 are grouped in thousands and never fractional', () => {
  assert.equal(money(0), '0');
  assert.equal(money(7), '7');
  assert.equal(money(999), '999');
  assert.equal(money(1000), '1,000');
  assert.equal(money(4320), '4,320');
  assert.equal(money(1234567), '1,234,567');
  assert.equal(money(4320.9), '4,320', 'the campaign has no half 元');
});

test('nonsense money is zero rather than NaN on the shop sheet', () => {
  for (const junk of [NaN, Infinity, -Infinity, null, undefined, '4320', {}]) {
    assert.equal(money(junk), '0', `money(${String(junk)})`);
  }
  // a negative can never happen (js/campaign.js refuses to overdraw) but if one
  // ever does it should read as a debt rather than as a mangled string
  assert.equal(money(-1200), '-1,200');
});

// The chain banner wears a multiplier and is read in half a second at the edge
// of vision, so it has to be as short as it can honestly be — and it is built
// from a float, where 1 + 0.15 × 3 is 1.4500000000000002.
test('a multiplier reads as short as it honestly can', () => {
  assert.equal(multiplier(1 + 0.15 * 3), '1.45');
  assert.equal(multiplier(1.5), '1.5', 'a trailing zero was left on');
  assert.equal(multiplier(2), '2', 'a whole multiplier came with decimals');
  assert.equal(multiplier(1), '1');
  assert.equal(multiplier(1.15), '1.15');
  assert.equal(multiplier(1.456), '1.46', 'more precision than a banner can carry');
});

test('a nonsense multiplier is a plain 1 rather than NaN across the board', () => {
  for (const junk of [NaN, Infinity, null, undefined, '1.45', {}]) {
    assert.equal(multiplier(junk), '1', `multiplier(${String(junk)})`);
  }
});

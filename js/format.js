// Numbers the player reads, as strings.
//
// Pure module — no DOM, no clock, no tables. It exists so the hosts can stay
// arithmetic-free (see the rule in js/economy.js): a host that divides a
// duration by 60000 to print it has started owning a rule, and the farm screen
// and the plot sheet would then own two copies of it that could disagree.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * A wait, as a clock face: `m:ss` under an hour, `h:mm` at an hour and over.
 *
 * Two grains, because the farm has two kinds of wait. A strawberry is watched
 * to the second; a pineapple is a thing you come back for tomorrow, and
 * counting its seconds down would be a fidget rather than information.
 *
 * Rounds UP, so the chip never says 0:00 over something still growing — zero
 * means ready, and a countdown that lies about that once is a countdown nobody
 * believes again. Anything already ripe, or not on its way anywhere, is '0:00'.
 */
export function countdown(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return '0:00';
  if (ms < HOUR) {
    const total = Math.ceil(ms / SECOND);
    return `${Math.floor(total / 60)}:${pad(total % 60)}`;
  }
  const total = Math.ceil(ms / MINUTE);
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

function pad(n) { return n < 10 ? `0${n}` : String(n); }

/**
 * 元, grouped in thousands. Whole numbers only — the campaign has no fractions
 * of a 元 and never has, so a decimal point here would be a bug's first symptom.
 *
 * Grouped by hand rather than by `toLocaleString`, because the separator the
 * player's locale would pick is not necessarily the one the rest of this game's
 * numbers use, and a stat row that reads 4.320 in one place and 4,320 in
 * another looks broken rather than localized.
 */
export function money(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '0';
  const whole = Math.abs(Math.trunc(n));
  const digits = String(whole);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return n < 0 ? `-${out}` : out;
}

/**
 * A multiplier, as short as it can honestly be: two decimals at most, and no
 * trailing zeros — 1.45, 1.5, 2, never 1.50 or 2.00.
 *
 * The chain banner wears one, and a banner is a thing read in half a second at
 * the edge of vision. `1 + 0.15 × 3` is 1.4500000000000002 in floating point,
 * so rounding here is not a nicety; it is the difference between a celebration
 * and a bug report.
 */
export function multiplier(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '1';
  return n.toFixed(2).replace(/\.?0+$/, '');
}

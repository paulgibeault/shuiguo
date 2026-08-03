// Ephemeral visual juice for shuǐ guǒ tān — merge pops, splash droplets, score
// floats, landing squash.
//
// This is NOT game state. Effects are fed from the drained `g.events` queue,
// never serialized, and never read back by the simulation; dropping the whole
// list mid-game costs nothing but a frame of sparkle. The host owns the list
// and hands it to the renderer.
//
// Everything is ANALYTIC: an effect stores its birth time and initial
// conditions, and its position at time t is a closed-form function of t - t0.
// No per-frame integration, so the renderer stays a pure reader and a dropped
// frame can't desync the visuals.
//
// Reduced motion is enforced at the door: pushEvent() simply refuses to create
// anything that moves. Score floats survive as a static fade because they're
// information, not decoration.

import { FRUITS, MAX_LEVEL, radiusOf } from './constants.js';

export const FX = {
  popMs: 180,             // merge newborn scale-in
  popFrom: 0.6,           // starting scale
  popPeak: 1.08,          // overshoot before settling to 1.0
  popPeakAt: 0.6,         // fraction of popMs where the overshoot lands

  squashMs: 150,          // landing squash-and-stretch
  squashMax: 0.12,        // ≤12% at full-speed impact
  squashFullSpeed: 900,   // impact speed that earns the full squash

  dropletMs: 400,
  dropletGravity: 900,    // "gravity-lite" — juice hangs a little
  dropletSpeed: 260,      // fast enough to clear the newborn's own radius

  floatMs: 700,
  floatRise: 40,          // world units the score text drifts up
};

// Chain escalation for score floats: warmer and bigger the deeper it goes.
const CHAIN_COLORS = ['#f0a03c', '#ef7d3a', '#e04b3a'];

export function makeEffects() {
  return { droplets: [], floats: [], pops: new Map(), squashes: new Map(), seq: 0 };
}

export function resetEffects(fx) {
  fx.droplets.length = 0;
  fx.floats.length = 0;
  fx.pops.clear();
  fx.squashes.clear();
}

// Fold one drained game event into the effects list. `t` is the host clock
// (the same one handed to the renderer as tMs).
//
// `value` is what the popup should SAY the merge was worth, supplied by the
// host. Free play passes nothing and gets the arcade score it always got; the
// campaign passes '+64元', because during a market day every reward on screen
// should be money rather than a second number system to reconcile at the till.
// It arrives as a finished string on purpose — the arithmetic behind it belongs
// to js/economy.js, and this module has never done any.
export function pushEvent(fx, ev, t, reducedMotion, value = null) {
  if (ev.type === 'merge') {
    if (!reducedMotion) {
      fx.pops.set(ev.id, t);
      // droplets take the PARENT's colour — the juice of what was crushed
      const parent = FRUITS[ev.level - 2] || FRUITS[0];
      burst(fx, ev.x, ev.y, 6 + (ev.chain > 1 ? 4 : 2), [parent.color, parent.rind], t, FX.dropletMs, FX.dropletSpeed);
    }
    const chain = ev.chain || 1;
    const head = value == null ? `+${ev.score}` : value;
    fx.floats.push({
      // clear of the newborn's face, and stacked upward per chain link so a
      // chain's worth of floats reads as a ladder instead of a smear
      x: ev.x,
      y: ev.y - radiusOf(ev.level) * 0.9 - (chain - 1) * 18,
      t0: t, life: FX.floatMs,
      text: chain > 1 ? `${head} ×${chain}` : head,
      scale: Math.min(1 + 0.18 * (chain - 1), 1.7),
      color: chain > 1 ? CHAIN_COLORS[Math.min(chain - 2, CHAIN_COLORS.length - 1)] : null,
    });
  } else if (ev.type === 'annihilate') {
    if (!reducedMotion) {
      burst(fx, ev.x, ev.y, 20, ['#4f9e56', '#2f6e3c', '#d23c50'], t, FX.dropletMs * 1.6, FX.dropletSpeed * 1.5);
    }
    fx.floats.push({
      // the biggest number the board can produce, so the most legible one
      x: ev.x, y: ev.y - radiusOf(MAX_LEVEL) * 0.6, t0: t, life: FX.floatMs * 1.4,
      text: value == null ? `+${ev.score}` : value, scale: 2.0, color: '#4f9e56', bold: true,
    });
  } else if (ev.type === 'bounce') {
    if (reducedMotion) return;
    fx.squashes.set(ev.id, { t0: t, speed: ev.speed });
  }
}

// Drop anything that has finished. Cheap enough to run every frame.
export function pruneEffects(fx, t) {
  fx.droplets = fx.droplets.filter((p) => t - p.t0 < p.life);
  fx.floats = fx.floats.filter((f) => t - f.t0 < f.life);
  for (const [id, t0] of fx.pops) if (t - t0 >= FX.popMs) fx.pops.delete(id);
  for (const [id, s] of fx.squashes) if (t - s.t0 >= FX.squashMs) fx.squashes.delete(id);
}

// Deterministic radial spray — no rng dependency, and `seq` keeps successive
// bursts at the same spot from looking stamped from the same die.
function burst(fx, x, y, n, colors, t, life, speed) {
  const seed = fx.seq++;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed * 0.7;
    const s = speed * (0.55 + 0.45 * (((i * 7 + seed * 3) % 5) / 4));
    fx.droplets.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - speed * 0.35,   // biased upward: it's a splash
      r: 1.6 + (i % 3) * 0.9,
      color: colors[i % colors.length],
      t0: t, life,
    });
  }
}

// ── closed-form readers (renderer calls these) ─────────────────────────────

export function dropletAt(p, t) {
  const dt = (t - p.t0) / 1000;
  const u = (t - p.t0) / p.life;
  return {
    x: p.x + p.vx * dt,
    y: p.y + p.vy * dt + 0.5 * FX.dropletGravity * dt * dt,
    alpha: Math.max(0, 1 - u * u),      // holds its colour, then goes fast
  };
}

export function floatAt(f, t, reducedMotion) {
  const u = Math.min(1, (t - f.t0) / f.life);
  return {
    x: f.x,
    y: reducedMotion ? f.y : f.y - FX.floatRise * (1 - (1 - u) * (1 - u)),
    alpha: Math.max(0, 1 - u * u),
  };
}

// 0.6 → overshoot → 1.0. Two eased halves rather than a back-ease constant, so
// the peak is exactly FX.popPeak instead of whatever the magic number gives.
export function popScale(t0, t) {
  const u = (t - t0) / FX.popMs;
  if (u >= 1) return 1;
  if (u <= 0) return FX.popFrom;
  if (u < FX.popPeakAt) {
    const k = u / FX.popPeakAt;
    return FX.popFrom + (FX.popPeak - FX.popFrom) * (1 - (1 - k) * (1 - k) * (1 - k));
  }
  const k = (u - FX.popPeakAt) / (1 - FX.popPeakAt);
  return FX.popPeak + (1 - FX.popPeak) * (0.5 - 0.5 * Math.cos(Math.PI * k));
}

// Vertical squash factor: +e wide / -e tall at impact, easing through a small
// stretch on the rebound. Returns 0 when there's nothing to draw.
export function squashAmount(s, t) {
  const u = (t - s.t0) / FX.squashMs;
  if (u <= 0 || u >= 1) return 0;
  const peak = FX.squashMax * Math.min(1, s.speed / FX.squashFullSpeed);
  return peak * (1 - u) * Math.cos(u * Math.PI * 1.5);
}

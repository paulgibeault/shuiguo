// shuǐguǒ sound pack — the game's own sound design.
//
// Loaded as a plain script after /arcade-audio.js. js/sfx.js registers
// everything here with Arcade.audio; the launcher's tools/soundpack renderer
// loads this same file to produce audition WAVs, so what gets approved by ear
// is what plays.
//
// The place: a wooden fruit stand under an awning at midday. Close, dry, a
// little sun-warm — fruit is at arm's length on a plank counter, and the only
// reflections come off the counter and the awning, so the room is short and
// intimate. Nothing echoes at a market stall.
//
// The material palette is exactly two things: WOOD (the counter — every drop
// lands on it) and WATER-IN-SKIN (every fruit — every merge bursts it). Merges
// are the identity sound: a wet squelch whose size and depth scale with the
// fruit being born, so the ear learns the progression the way the eye does.
//
// Every cue takes `r` (a seeded random stream) and varies pitch, timing and
// balance per play — byte-identical repetition is a chiptune tell.

(function (global) {
  'use strict';
  const S = global.ArcadeAudioElements;

  // No element library (stale cached page, or standalone without
  // /arcade-audio.js) ⇒ register nothing and the game plays silence — by
  // design; fallback spec profiles are retired fleet-wide.
  if (!S || typeof S.registerPack !== 'function') return;

  // Under an awning: first reflections are near (plank counter), the tail is
  // short and darkened by cloth. Any longer and the stall moves indoors.
  const ROOM = {
    dur: 0.9,
    decay: 0.30,
    preDelay: 0.012,
    wet: 0.5,
    shelfHz: 4200,
    shelfDb: -6,
    seed: 4791,
  };

  // Distance, per cue. Drops and merges happen in your hands; the finale
  // fills the stall; the game-over sigh comes from the whole counter.
  const SENDS = {
    'drop': 0.16,
    'merge': 0.22,
    'watermelon': 0.42,
    'annihilate': 0.48,
    'game-over': 0.34,
    'menu-click': 0.12,
  };

  // Fired on literally every turn — must register as texture, not event.
  const CONSTANT = 0.05;
  // Fired on most merges.
  const FREQUENT = 0.11;

  // Merge voicing: the fruit BORN at `level` (2..11) decides the size of the
  // burst. One octave and a half of travel across the chain, so a cherry pop
  // and a melon birth are obviously kin and obviously different.
  //   f0: squelch band centre   wf: the weight underneath   dur: burst length
  function mergeVoice(level) {
    const t = (Math.min(level, 11) - 2) / 9;            // 0..1 across the chain
    return {
      f0: 520 - 330 * t,          // 520 Hz (small, bright) → 190 Hz (big, dark)
      lp: 1500 - 700 * t,
      wf: 150 - 88 * t,           // thump fundamental: 150 → 62 Hz
      dur: 0.12 + 0.22 * t,
      gain: FREQUENT * (1 + 0.9 * t),
    };
  }

  // A soft two-partial "flesh" tone for the birth — barely pitched, more felt
  // than heard, and what makes ascending chains feel like they GO somewhere.
  function flesh(ctx, o, t, r, f0, gain, dur) {
    S.body(ctx, o, t, {
      f0: f0 * S.cents(r, 25), gain,
      partials: [
        { ratio: 1.0, gain: 1.0, decay: dur, detune: 4 },
        { ratio: 2.4, gain: 0.22, decay: dur * 0.45, detune: 6 },
      ],
    });
  }

  const CUES = {
    // A fruit landing on the plank counter, or on other fruit. Wood first
    // (contact), a hint of skin (the fruit gives a little). Quiet — this is
    // the metronome of the whole game and must never announce itself.
    'drop': function (ctx, o, t, p, r) {
      const level = p && p.level ? p.level : 3;
      const size = (Math.min(level, 11) - 1) / 10;
      S.strike(ctx, o, t, {
        dur: 0.005, hp: 1500 - 600 * size, gain: CONSTANT * 0.8,
        seed: (r() * 1e6) | 0,
      });
      S.thump(ctx, o, t + 0.004, {
        f0: 190 - 70 * size, f1: 70 - 22 * size,
        dur: 0.10 + 0.10 * size, gain: CONSTANT * (0.9 + 0.8 * size),
      });
    },

    // THE sound of the game: two fruits fusing into a bigger one. A wet
    // squelch (the skins giving way), weight underneath (the new mass), and a
    // soft flesh tone that falls as the chain climbs — the whole progression
    // is audible in this one cue's `level` param.
    'merge': function (ctx, o, t, p, r) {
      const level = p && p.level ? p.level : 3;
      const v = mergeVoice(level);
      const jitter = S.between(r, 0, 0.012);
      S.squelch(ctx, o, t + jitter, {
        sf0: v.f0 * 1.4, sf1: v.f0 * 0.5, lp: v.lp,
        dur: v.dur, gain: v.gain,
        seed: (r() * 1e6) | 0,
      });
      S.thump(ctx, o, t + jitter + v.dur * 0.3, {
        f0: v.wf * S.cents(r, 20), f1: v.wf * 0.55,
        dur: 0.14 + v.dur, gain: v.gain * 0.7,
      });
      flesh(ctx, o, t + jitter + v.dur * 0.5, r, v.f0 * 0.9, v.gain * 0.5, 0.28);
      // a couple of juice droplets off the top, brighter for small fruit
      const drops = 1 + ((r() * 2) | 0);
      for (let i = 0; i < drops; i++) {
        S.droplet(ctx, o, t + jitter + 0.03 + i * S.between(r, 0.03, 0.06), {
          f0: v.f0 * S.between(r, 0.9, 1.3), f1: v.f0 * S.between(r, 2.6, 3.6),
          dur: 0.05, gain: v.gain * 0.32,
        });
      }
    },

    // A watermelon is born — the goal of the whole game. The merge gesture at
    // full size, then a slow warm swell under it. Big, but still made of the
    // same two materials; a fanfare would belong to a different game.
    'watermelon': function (ctx, o, t, p, r) {
      const v = mergeVoice(11);
      S.squelch(ctx, o, t, {
        sf0: v.f0 * 1.5, sf1: v.f0 * 0.45, lp: v.lp, dur: v.dur * 1.3,
        gain: v.gain * 1.15, seed: (r() * 1e6) | 0,
      });
      S.thump(ctx, o, t + 0.05, { f0: 58 * S.cents(r, 12), f1: 34, dur: 0.7, gain: 0.20 });
      // a rising three-note flesh figure — the one melodic moment in the pack
      const base = 165 * S.cents(r, 10);
      [1, 1.25, 1.5].forEach((ratio, i) => {
        flesh(ctx, o, t + 0.16 + i * 0.12, r, base * ratio, 0.10, 0.6);
      });
      // juice everywhere
      for (let i = 0; i < 5; i++) {
        S.droplet(ctx, o, t + 0.1 + i * S.between(r, 0.05, 0.09), {
          f0: S.between(r, 300, 500), f1: S.between(r, 900, 1600),
          dur: 0.06, gain: 0.05,
        });
      }
    },

    // Two watermelons annihilating — the rarest event in the game. The
    // biggest wet burst the stall can hold, then the counter itself shudders.
    'annihilate': function (ctx, o, t, p, r) {
      S.squelch(ctx, o, t, {
        sf0: 300, sf1: 80, lp: 700, dur: 0.5, gain: 0.30,
        seed: (r() * 1e6) | 0,
      });
      S.thump(ctx, o, t + 0.03, { f0: 48, f1: 26, dur: 1.0, gain: 0.26 });
      S.shatter(ctx, o, t + 0.06, {
        f0: 900, ring: 0.6, dur: 0.5, gain: 0.10, seed: (r() * 1e6) | 0,
      });
      const base = 130 * S.cents(r, 8);
      [1, 1.5, 2].forEach((ratio, i) => {
        flesh(ctx, o, t + 0.2 + i * 0.1, r, base * ratio, 0.12, 0.8);
      });
      for (let i = 0; i < 8; i++) {
        S.droplet(ctx, o, t + 0.08 + i * S.between(r, 0.04, 0.08), {
          f0: S.between(r, 250, 550), f1: S.between(r, 800, 1800),
          dur: 0.07, gain: 0.05,
        });
      }
    },

    // Overfilled — the stall settles. A slow creak of the plank under too
    // much weight and two falling flesh tones: rueful, cozy, five seconds
    // from "oh no" to "again!". No trombone; the piglet lives next door.
    'game-over': function (ctx, o, t, p, r) {
      S.creak(ctx, o, t, {
        f0: 210 * S.cents(r, 15), f1: 130, Q: 6, dur: 0.8, gain: 0.14,
        seed: (r() * 1e6) | 0,
      });
      flesh(ctx, o, t + 0.5, r, 220, 0.12, 0.7);
      flesh(ctx, o, t + 0.95, r, 165, 0.12, 1.0);
      S.thump(ctx, o, t + 1.0, { f0: 70, f1: 40, dur: 0.5, gain: 0.10 });
    },

    // UI tap — dry knuckle on wood, nearly in your head.
    'menu-click': function (ctx, o, t, p, r) {
      S.strike(ctx, o, t, { dur: 0.004, hp: 2400, gain: 0.10, seed: (r() * 1e6) | 0 });
      S.thump(ctx, o, t, { f0: 240 * S.cents(r, 25), f1: 150, dur: 0.05, gain: 0.07 });
    },
  };

  // Published under the framework's well-known handle so the game's audio
  // module and the launcher's soundpack toolchain both reach it without
  // either side knowing this game's name.
  S.registerPack({ name: 'shuiguo', ROOM, SENDS, CUES, mergeVoice });
})(typeof window !== 'undefined' ? window : globalThis);

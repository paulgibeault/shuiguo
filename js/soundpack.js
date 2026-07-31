// shuǐ guǒ tān sound pack — the game's own sound design.
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
    'chain': 0.20,
    'watermelon': 0.42,
    'annihilate': 0.48,
    'warning': 0.30,
    'discover': 0.25,
    'game-over': 0.34,
    'menu-click': 0.12,
    // The farm. It is outdoors on a mountainside rather than under an awning,
    // so everything on that half of the game sits a little further back — the
    // same room, heard across a terrace instead of over a counter.
    'water': 0.34,
    'plant': 0.26,
    'harvest': 0.30,
    'ripe-chime': 0.40,
    'coin': 0.14,
    'till': 0.30,
    'buy': 0.16,
    'terrace-fanfare': 0.46,
    'pack-up': 0.30,
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

    // A cascade. Played ON TOP OF the merge cue, never instead of it: the
    // merge is still the event, this is only the shine on it. Juice thrown
    // clear of a burst that was bigger than one fruit — same water, higher up
    // and faster, more of it the deeper the chain went.
    'chain': function (ctx, o, t, p, r) {
      const chain = Math.max(2, Math.min((p && p.chain) || 2, 6));
      const depth = (chain - 2) / 4;                  // 0 at a 2-chain, 1 at a 6
      const n = 2 + Math.round(depth * 1.6);          // 2 → 3 droplets
      const base = 620 * Math.pow(1.14, chain - 2);   // and each one brighter
      for (let i = 0; i < n; i++) {
        S.droplet(ctx, o, t + 0.02 + i * S.between(r, 0.045, 0.075), {
          f0: base * S.between(r, 0.92, 1.15) * Math.pow(1.18, i),
          f1: base * S.between(r, 2.4, 3.2),
          dur: 0.045,
          gain: FREQUENT * (0.30 + 0.22 * depth),
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

    // A fruit has crossed the line. The stall takes the weight and a plank
    // complains — ONE creak, on the way in, not a siren that runs the whole
    // time you are in trouble. Short and low: the eye already has the red
    // vignette and the trembling pile, so the ear only has to say "heard that".
    // Deliberately kin to the game-over creak an octave up — the same plank,
    // earlier in the same sentence.
    'warning': function (ctx, o, t, p, r) {
      S.creak(ctx, o, t, {
        f0: 320 * S.cents(r, 20), f1: 210, Q: 7, dur: 0.34, gain: 0.085,
        seed: (r() * 1e6) | 0,
      });
      S.thump(ctx, o, t + 0.02, { f0: 96, f1: 58, dur: 0.22, gain: 0.06 });
    },

    // A fruit made for the first time ever. The watermelon cue's rising figure
    // in miniature — two flesh tones up a fifth and a droplet off the top —
    // so a discovery is heard as a small relative of the big prize rather than
    // as a UI chime from some other game.
    'discover': function (ctx, o, t, p, r) {
      const base = 300 * S.cents(r, 12);
      flesh(ctx, o, t, r, base, 0.11, 0.34);
      flesh(ctx, o, t + 0.13, r, base * 1.5, 0.11, 0.5);
      S.droplet(ctx, o, t + 0.20, {
        f0: base * 2.2, f1: base * 5.4, dur: 0.06, gain: 0.055,
      });
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

  // ── the farm ─────────────────────────────────────────────────────────────
  //
  // The second half of the game gets no new materials. Wood and water-in-skin
  // built the stall; the farm is the same two heard outdoors, plus the one
  // thing a market has that an orchard does not — coins on a plank counter,
  // which are just very small, very hard strikes.
  //
  // Nothing here is a jingle. The farm's whole promise is that it never asks
  // anything of the player, and a sound that congratulates you for showing up
  // is a retention mechanic with a melody.

  Object.assign(CUES, {
    // Water out of a can onto turned earth. A soft noise wash that opens and
    // closes (the pour) with droplets landing through it. The farm's most
    // repeated interaction, so like 'drop' it must read as texture.
    'water': function (ctx, o, t, p, r) {
      S.squelch(ctx, o, t, {
        sf0: 900, sf1: 420, lp: 2600, dur: 0.42, gain: CONSTANT * 1.5,
        seed: (r() * 1e6) | 0,
      });
      for (let i = 0; i < 4; i++) {
        S.droplet(ctx, o, t + 0.04 + i * S.between(r, 0.05, 0.11), {
          f0: S.between(r, 380, 700), f1: S.between(r, 1100, 2200),
          dur: 0.05, gain: CONSTANT * 0.7,
        });
      }
      S.thump(ctx, o, t + 0.06, { f0: 120 * S.cents(r, 30), f1: 70, dur: 0.16, gain: CONSTANT * 0.6 });
    },

    // A seed into soil: a small dry press, no ring at all. The quietest cue in
    // the pack — planting is a gesture, not an achievement.
    'plant': function (ctx, o, t, p, r) {
      S.strike(ctx, o, t, { dur: 0.006, hp: 900, gain: CONSTANT * 0.7, seed: (r() * 1e6) | 0 });
      S.thump(ctx, o, t + 0.005, { f0: 150 * S.cents(r, 25), f1: 82, dur: 0.09, gain: CONSTANT * 0.9 });
    },

    // Fruit coming off the plant and into the crate. Pitched by level exactly
    // as merges are, out of the same mergeVoice table — so the ear learns the
    // chain on the farm and in the stall as one progression, which it is.
    'harvest': function (ctx, o, t, p, r) {
      const level = p && p.level ? p.level : 3;
      const v = mergeVoice(Math.max(2, level));
      // the stem giving — a short, dry version of the merge squelch
      S.squelch(ctx, o, t, {
        sf0: v.f0 * 1.2, sf1: v.f0 * 0.7, lp: v.lp * 1.4,
        dur: v.dur * 0.5, gain: v.gain * 0.7, seed: (r() * 1e6) | 0,
      });
      // …and the fruit landing in the crate, on wood
      S.thump(ctx, o, t + 0.07, { f0: v.wf * S.cents(r, 20), f1: v.wf * 0.6, dur: 0.16, gain: v.gain * 0.8 });
      flesh(ctx, o, t + 0.09, r, v.f0 * 0.85, v.gain * 0.35, 0.24);
    },

    // Walking in on something ready to pick. The discovery figure, softer and
    // further off — a greeting across the terraces, never a summons. Played
    // once on entering the farm and only when there is genuinely something
    // ripe; there is no version of this that fires because you stayed away.
    'ripe-chime': function (ctx, o, t, p, r) {
      const base = 392 * S.cents(r, 10);
      flesh(ctx, o, t, r, base, 0.055, 0.55);
      flesh(ctx, o, t + 0.16, r, base * 1.5, 0.05, 0.8);
      S.droplet(ctx, o, t + 0.26, { f0: base * 2.4, f1: base * 5, dur: 0.07, gain: 0.03 });
    },

    // One coin onto the counter as the appraisal counts up. Fired many times a
    // second, so it is the smallest sound in the pack by a distance: a tiny
    // bright strike and a click of a ring. Anything more becomes a machine gun.
    'coin': function (ctx, o, t, p, r) {
      S.strike(ctx, o, t, { dur: 0.003, hp: 5200, gain: CONSTANT * 0.5, seed: (r() * 1e6) | 0 });
      S.body(ctx, o, t, {
        f0: 2600 * S.cents(r, 60), gain: CONSTANT * 0.35,
        partials: [{ ratio: 1.0, gain: 1.0, decay: 0.05, detune: 8 },
          { ratio: 2.76, gain: 0.4, decay: 0.03, detune: 12 }],
      });
    },

    // The total lands: the coins are swept off the counter into the till. One
    // wooden drawer closing under a handful of metal.
    'till': function (ctx, o, t, p, r) {
      for (let i = 0; i < 5; i++) {
        S.strike(ctx, o, t + i * S.between(r, 0.008, 0.022), {
          dur: 0.003, hp: 4200, gain: 0.05, seed: (r() * 1e6) | 0,
        });
      }
      S.thump(ctx, o, t + 0.10, { f0: 130 * S.cents(r, 15), f1: 62, dur: 0.30, gain: 0.16 });
      S.creak(ctx, o, t + 0.10, {
        f0: 280 * S.cents(r, 20), f1: 180, Q: 5, dur: 0.22, gain: 0.05,
        seed: (r() * 1e6) | 0,
      });
    },

    // Money leaving the till for something. The click of the drawer plus one
    // coin — deliberately the same family as 'till', a beat instead of a
    // sentence, because buying happens constantly in the shop.
    'buy': function (ctx, o, t, p, r) {
      S.strike(ctx, o, t, { dur: 0.004, hp: 3800, gain: 0.07, seed: (r() * 1e6) | 0 });
      S.thump(ctx, o, t + 0.01, { f0: 180 * S.cents(r, 20), f1: 96, dur: 0.10, gain: 0.09 });
    },

    // A whole terrace bought, or the stream turned onto the farm. The one
    // genuinely celebratory cue on this side of the game: the watermelon's
    // rising figure, lower and slower, heard across the mountainside rather
    // than in your hands. It fires a handful of times in a whole campaign.
    'terrace-fanfare': function (ctx, o, t, p, r) {
      S.thump(ctx, o, t, { f0: 64 * S.cents(r, 10), f1: 38, dur: 0.8, gain: 0.18 });
      const base = 147 * S.cents(r, 8);
      [1, 1.25, 1.5, 2].forEach((ratio, i) => {
        flesh(ctx, o, t + 0.10 + i * 0.14, r, base * ratio, 0.10, 0.7);
      });
      for (let i = 0; i < 4; i++) {
        S.droplet(ctx, o, t + 0.2 + i * S.between(r, 0.07, 0.12), {
          f0: S.between(r, 320, 560), f1: S.between(r, 1000, 1900),
          dur: 0.07, gain: 0.04,
        });
      }
    },

    // Packing up on purpose. Deliberately NOT the game-over creak: the stall
    // is being put away neatly rather than settling under too much weight, so
    // it is the same plank heard as a tidy double knock and one contented tone
    // — the sound of a good day, which it always is.
    'pack-up': function (ctx, o, t, p, r) {
      S.strike(ctx, o, t, { dur: 0.005, hp: 1800, gain: 0.09, seed: (r() * 1e6) | 0 });
      S.thump(ctx, o, t + 0.005, { f0: 170 * S.cents(r, 20), f1: 95, dur: 0.14, gain: 0.11 });
      S.strike(ctx, o, t + 0.13, { dur: 0.005, hp: 1600, gain: 0.08, seed: (r() * 1e6) | 0 });
      S.thump(ctx, o, t + 0.135, { f0: 150 * S.cents(r, 20), f1: 84, dur: 0.16, gain: 0.10 });
      flesh(ctx, o, t + 0.30, r, 196 * S.cents(r, 10), 0.09, 0.7);
    },
  });

  // Published under the framework's well-known handle so the game's audio
  // module and the launcher's soundpack toolchain both reach it without
  // either side knowing this game's name.
  S.registerPack({ name: 'shuiguo', ROOM, SENDS, CUES, mergeVoice });
})(typeof window !== 'undefined' ? window : globalThis);

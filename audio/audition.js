// shuǐguǒ — audition timeline.
//
// Test material rendered into the audition WAV; NOT part of the shipped pack.
// Reads the game's own pack, so what is auditioned is literally what plays.
//
//   node ../paulgibeault.github.io/tools/soundpack/render.mjs \
//     --config soundpack.config.json --audition full

(function (global) {
  'use strict';
  const A = global.ArcadeAudition;
  const P = A.pack();

  const SECTIONS = [
    A.section('A · Each cue — dry, then in the room',
      'The stall: short, close, cloth-dark. The dry/wet pair shows what the awning contributes.',
      A.everyCueDryWet ? A.everyCueDryWet().items : Object.keys(P.CUES).flatMap((name) => ([
        A.play(name, { label: name + ' — dry', send: 0 }),
        A.play(name, { label: name + ' — in the room' }),
      ]))),

    A.section('B · The merge ladder',
      'One cue, ten sizes. The progression must be audible: cherry-pop bright and tiny, melon birth dark and heavy. If two adjacent rungs sound identical, the param mapping is too shallow.',
      Array.from({ length: 10 }, (_, i) =>
        A.play('merge', { label: `merge → level ${i + 2} (${'●'.repeat(1)}${i + 2})`, params: { level: i + 2 }, dur: 1.4 }))),

    A.section('B2 · The chain sparkle',
      'chain is a LAYER — it is always heard on top of merge, never alone. First the depths bare so the density and pitch ramp is audible, then the way it is actually played. If the sparkle ever reads as the event instead of the merge under it, it is too loud.',
      [
        ...[2, 3, 4, 5, 6].map((chain) =>
          A.play('chain', { label: `chain ×${chain} — bare`, params: { chain }, dur: 0.9 })),
        ...[2, 4, 6].map((chain) => A.scene(`merge + chain ×${chain} — as played`, 1.6, [
          { cue: 'merge', at: 0, params: { level: 4 + chain } },
          { cue: 'chain', at: 0, params: { chain } },
        ])),
      ]),

    A.section('B3 · Discovery and the line',
      'discover is the watermelon figure in miniature — kin to it, a fifth of the size. warning is one creak on the way into danger, and must sit under the merge it follows without turning into an alarm.',
      [
        A.play('discover', { label: 'discover — a fruit made for the first time', dur: 1.6 }),
        A.scene('the peach is discovered mid-play', 3.2, [
          { cue: 'merge', at: 0, params: { level: 8 } },
          { cue: 'discover', at: 0.45 },
        ]),
        A.play('warning', { label: 'warning — the plank takes the weight', dur: 1.4 }),
        A.scene('a drop pushes the pile over the line', 3, [
          { cue: 'drop', at: 0, params: { level: 4 } },
          { cue: 'warning', at: 0.55 },
        ]),
      ]),

    A.section('C · Repetition — the fatigue test',
      'drop fires on every turn: at this rate it must read as texture, not event. merge at play pace next; charming-once is not enough.',
      [
        A.repeat('drop', { n: 10, spacing: 0.5, params: { level: 3 } }),
        A.repeat('merge', { n: 8, spacing: 0.7, params: { level: 3 } }),
        A.repeat('menu-click', { n: 4, spacing: 0.4 }),
      ]),

    A.section('D · Scenes — how a real game sounds',
      'Drops with merges landing between them, a cascade chain, then the two finales and the sigh at the end.',
      [
        A.scene('a quiet stretch of play', 7, [
          { cue: 'drop', at: 0.0, params: { level: 2 } },
          { cue: 'drop', at: 1.1, params: { level: 4 } },
          { cue: 'merge', at: 1.35, params: { level: 3 } },
          { cue: 'drop', at: 2.6, params: { level: 1 } },
          { cue: 'drop', at: 3.8, params: { level: 3 } },
          { cue: 'merge', at: 4.05, params: { level: 4 } },
          { cue: 'drop', at: 5.2, params: { level: 5 } },
        ]),
        A.scene('a four-deep cascade', 4, [
          { cue: 'drop', at: 0.0, params: { level: 3 } },
          { cue: 'merge', at: 0.25, params: { level: 4 } },
          { cue: 'merge', at: 0.55, params: { level: 5 } },
          { cue: 'chain', at: 0.55, params: { chain: 2 } },
          { cue: 'merge', at: 0.9, params: { level: 6 } },
          { cue: 'chain', at: 0.9, params: { chain: 3 } },
          { cue: 'merge', at: 1.3, params: { level: 7 } },
          { cue: 'chain', at: 1.3, params: { chain: 4 } },
        ]),
        A.scene('the watermelon is born', 5, [
          { cue: 'merge', at: 0.0, params: { level: 10 } },
          { cue: 'watermelon', at: 0.9 },
        ]),
        A.play('annihilate', { label: 'two watermelons annihilate', dur: 4 }),
        A.play('game-over', { label: 'the stall is full', dur: 4 }),
      ]),
  ];

  A.publish({ gap: 0.55, tail: 1.2, sections: SECTIONS });
})(typeof window !== 'undefined' ? window : globalThis);

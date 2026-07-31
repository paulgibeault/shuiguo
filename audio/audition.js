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
          { cue: 'merge', at: 0.9, params: { level: 6 } },
          { cue: 'merge', at: 1.3, params: { level: 7 } },
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

// Audio for shuǐguǒ, via the launcher SDK's managed `Arcade.audio`.
//
// The pack IS the sound (js/soundpack.js). Every cue is a node graph built
// from the shared element library's physical gestures, all feeding one room —
// the fruit stand. No synthesis lives in this game; what belongs to shuǐguǒ
// is the design (which gestures, how loud, how far away).
//
// There is NO fallback profile. When the graph path is unavailable (stale
// cached SDK/companion, or standalone without /arcade-audio.js) this module
// registers nothing and the game plays silent — deliberately (fleet decision
// 2026-07-28: chiptune is an identity, not a degraded mode). Expected state,
// not an error, so no console noise.
//
// Fleet Arcade.audio conventions (GAME_INTEGRATION.md §5):
//   A1 — cues register ONCE at module load; audio is purely local, no
//        `await Arcade.ready` needed.
//   A2 — every play-site goes through the sfx() wrapper (pure feature detect).
//   A3 — the launcher owns volume and mute; no in-game audio settings.
//   A4 — cue names are lowercase-kebab and event-shaped.

const audio = () =>
  (typeof window !== 'undefined' && window.Arcade && window.Arcade.audio)
    ? window.Arcade.audio
    : null;

const pack = () =>
  (typeof window !== 'undefined' && window.ArcadeSoundPack) ? window.ArcadeSoundPack : null;

// A2 — the single play-site wrapper. Silent no-op when audio is absent,
// nothing registered, or the launcher has muted.
export function sfx(name, opts) {
  const a = audio();
  if (a) a.play(name, opts);
}

// The gestures the pack is built out of, checked as actual functions — a
// cached older element library would throw inside a cue at play time, and a
// half-played cue is worse than silence.
const NEEDED_ELEMENTS = [
  'strike', 'thump', 'squelch', 'droplet', 'body', 'creak', 'shatter',
  'between', 'cents', 'teardown',
];

(function registerCues() {
  const a = audio();
  if (!a) return;
  const p = pack();
  const el = typeof a.el === 'function' ? a.el() : null;
  const graphable =
    !!p && p.name === 'shuiguo' &&
    typeof a.graph === 'function' &&
    typeof a.room === 'function' &&
    el !== null &&
    NEEDED_ELEMENTS.every((n) => typeof el[n] === 'function');
  if (!graphable) return;   // silence by design — see header

  a.room(p.ROOM);
  Object.keys(p.CUES).forEach((name) => {
    a.graph(name, p.CUES[name], { send: p.SENDS[name] });
  });
})();

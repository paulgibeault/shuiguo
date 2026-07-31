# shuǐguǒ 水果

A cozy fruit-merge physics puzzle for [Paul's Arcade](https://paulgibeault.github.io/).
Drop fruit into the stall; two of a kind fuse into the next fruit up the
chain — 樱桃 cherry all the way to 西瓜 watermelon. Don't let the pile cross
the line.

**Name note:** the *display* name is `shuǐguǒ` (pinyin for 水果, "fruit");
the gameId / repo slug / URL is the ASCII `shuiguo`, per the fleet's
kebab-case identity rule. Diacritics and hanzi live only in UI strings.

## Rules (the GRD, condensed)

- 11 fruit levels; radii scale 1.0×→6.0×, creation scores double 1→1024.
- Only levels 1–5 spawn in the dropper; 6–11 exist only via merges.
- Merges happen on contact of equals, at the contact midpoint; newborns
  chain-merge in the same tick.
- Two watermelons annihilate: both vanish, +2048.
- A fruit whose top sits above the dotted line for a **continuous 3 s** ends
  the game. A just-dropped fruit can't trip it until its first contact.
- Input locks while the board is live and unlocks on settle (with a 1.5 s cap
  so a micro-jittering pile can never soft-lock the dropper).

## Integration

Standard fleet game: evergreen `/arcade-sdk.js`, `Arcade.loop` render loop,
state under `arcade.v1.shuiguo.*` (mid-game save auto-resumes; flushed
synchronously in `onSuspend`), `Arcade.records` high score,
`Arcade.scores` leaderboard, `Arcade.stats` counters. Theme, font scale and
reduced motion honored in both the DOM chrome and the canvas.

Audio is a graph-cue sound pack (`js/soundpack.js`, registered via
`ArcadeAudioElements.registerPack`) — a wooden fruit stand at midday; the
merge cue's voice deepens as the chain climbs. No spec-cue fallback: without
the element library the game is silent by design. Audition it offline:

```sh
node ../paulgibeault.github.io/tools/soundpack/render.mjs --config soundpack.config.json
```

## Dev

```sh
# from the launcher repo — stages launcher + game on 127.0.0.1:4791
./dev.sh ../shuiguo

npm test            # verify-artifact + node --test tests/
```

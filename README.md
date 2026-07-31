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
- Every fruit has its own `bounce` (restitution): a cherry pings, a watermelon
  thuds. Walls and floor use the fruit's own value, fruit-to-fruit uses the
  pair average.

## Feel

- Dropping locks input for a flat **450 ms** (`RULES.dropCooldownMs`), not
  until the pile settles — you can play at roughly 2 drops/second regardless
  of how busy the board is. Aiming is never locked; the held fruit dims for
  the cooldown and eases back in.
- Release drops at the **last aimed x**, so lift-off finger wobble can't
  shift the shot. Drag ≥80 px down into the bottom quarter (or release off
  the canvas) to cancel and keep your aim.
- Merges pop and spray juice, scores float and escalate with the chain, hard
  landings squash, and the board reddens and trembles as the line closes in —
  all of it gated off by the launcher's reduced-motion setting.

## Look

Every fruit is a character: its own silhouette (conical strawberry, egg-shaped
pear, squat persimmon), its own texture (seeds, netting, pebbling, crosshatch)
and its own accessory (stems, calyxes, a pineapple crown, a grape tendril).
Faces are per-fruit too — a sleepy grape, a stoic watermelon — and they stay
**upright while the bodies roll**, so a churning pile still reads. A fruit
blinks every few seconds, grins for half a second after a merge, and looks
worried while it is over the line.

The board is a wooden stall under a scalloped awning, whose fringe hangs just
above the deadline: "the pile reached the line" and "the stall is full to the
canopy" are the same picture. Dark theme is the same stall in the evening,
lit by two paper lanterns. A leaf drifts through every half minute or so.

It is all procedural canvas drawing — no sprites, no image files — from one
painter (`js/fruit-art.js`) shared by the board, the NEXT preview and the menu
chart, over one scene (`js/scene.js`). Both are pure modules that touch nothing
but the 2D context they are handed, so they test under `node --test` against a
stub. Fruit colours and face parameters live in the `FRUITS` / `FACES` tables
in `js/constants.js`; the painters hold no palette of their own.

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

# shuǐ guǒ tān 水果摊

A cozy fruit-stand physics puzzle for [Paul's Arcade](https://paulgibeault.github.io/).
Drop fruit into the stall; two of a kind fuse into the next fruit up the
chain — 樱桃 cherry all the way to 西瓜 watermelon. Don't let the pile cross
the line.

**Name note:** the *display* name is `shuǐ guǒ tān` (pinyin for 水果摊,
"fruit stall"); the gameId / repo slug / URL is the ASCII `shuiguo`, per the
fleet's kebab-case identity rule. Diacritics and hanzi live only in UI
strings. The slug still says `shuiguo` because it is load-bearing — it is
the `Arcade.init` gameId, the service-worker and manifest scope, the
catalog URL, and the prefix on every saved game (`arcade.v1.shuiguo.*`) —
so it changes only when the repo itself is renamed, and players' saved
state has to be migrated across that rename rather than silently orphaned.

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
- The preview is seven deep (`QUEUE_DEPTH`), biggest at the head and fading into
  the future. One fruit of warning was fine for an endless sky; a crate is
  something you plan against. It runs along the **rail** — the strip under the
  score, which is its alone, and which is what sets that seven: the ceiling is
  how many icons a phone's width holds without shrinking them to confetti.
- What is *left* in the crate is not up there. It stands on the **counter**, the
  bar across the foot of the board, with Pack up at the right-hand end and the
  friend on their stool at the left. The two fruit strips used to be unlabelled
  rows of identical small icons stacked one above the other; they are different
  kinds of fact, read at different moments (every drop / between drops), so they
  are now at opposite ends of the stall under their own names.

## Whose fruit you are selling

Every board is somebody's stall, and what stocks it is the only mechanical
difference between them.

- A **friend** hands you a **morning's produce** — a finite crate, packed from
  their own weighting of the sky, so 葡萄's cozy crate of small fruit is a long
  patient day and 苹果's is a short loud one. You see what is in it before you
  commit: knocking on a stall opens a launch window showing today's crate, and
  it is picked fresh every time you knock. Their stall opens when you merge
  their fruit at the market, and nowhere else.
- A friend has **one farm**, so selling everything on it costs them the time it
  takes to pick another: their stall shows **Back in 6:42** on the map and opens
  again when it is up (`restockMs`, per friend — 草莓's bed comes back inside a
  session, 苹果's trees take their time). Nothing expires while you are away and
  nothing is lost by not coming back; a restocked friend simply waits.
- The **wholesaler** 批发商 sells by the lorry-load: an **endless crate**, evenly
  stocked, open from the first launch, and **never** restocking — nobody's field
  is behind it. That is what keeps the friends' clocks a limit rather than a
  wait: there is always a board to play. This is free play, exactly as it always
  was, behind a door of its own.
- Either way you can **pack up 收摊** whenever you like, and selling a crate to
  the last cherry closes the day by itself. Both endings earn the Tidy Stall
  bonus on the split — the campaign's own rule, and packing up should feel like
  the smart play rather than the cowardly one.
- Everyone takes the same share of the till (`TUNING.friendCut`), paid into the
  campaign as cash and nothing else. An endless crate is stock somebody fronted
  you, not a gift.

The **leaderboard** asks two things of a run: an evenly stocked sky, and no cap
on it. Only the wholesaler's board answers both — a capped run and an uncapped
one are not the same game — so that is the one that posts a high score, a best
chain and a fastest watermelon. Both gates are derived (from the weights, and
from the crate size) rather than set by a flag, so a stall added to the table
later cannot be let onto the board by a field nobody remembered to set. The
collection book is not gated: a first pear is a first pear wherever you made it.

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

A portrait viewport is taller than the 360×560 world, and the slack that leaves
is stall rather than sky: the canopy runs up to the top edge of the canvas, and
the boarded apron under the counter — where a friend minding the stall sits —
takes the rest (`js/render.js` §`TOP_SHARE`). The column itself widens with the
viewport's height between a phone's width and 34rem, because the fit is always
width-bound in portrait: a tall window used to spend its height on letterbox and
leave the game a ribbon down the middle of a big screen.

It is all procedural canvas drawing — no sprites, no image files — from one
painter (`js/fruit-art.js`) shared by the board, the rail's chips and
the collection book, over one scene (`js/scene.js`). Both are pure modules that touch nothing
but the 2D context they are handed, so they test under `node --test` against a
stub. Fruit colours and face parameters live in the `FRUITS` / `FACES` tables
in `js/constants.js`; the painters hold no palette of their own.

## Reward

The first time you ever **make** a fruit — merge-born, not dropped — a card
pops: 桃 · táo · Peach · +128, big hanzi over readable pinyin. That is the
bilingual-learning moment, so the tone marks get real type size. The card does
**not** pause anything: the pile keeps falling behind it, aiming keeps working,
and it leaves after 2.5 s or on a tap. Several discoveries in one cascade queue
up rather than stacking. Discovery is persisted the instant it happens, and it
fills in the **collection book** 图鉴 — a scrolling shelf of tiles, one per
fruit, where everything you have never made is a dimmed silhouette under a `?`.
That is the reason to go and get the pear, and a tile you *have* earned opens: a
page with the fruit at portrait size, where it sits in the chain, and every
number the tables know about it — what it scores, what a merchant pays for it,
how it is grown, how long it takes, what it yields and what a seed costs. A
silhouette does not open; the mystery is the point.

A chain of three or more flashes a banner (`3-chain! 三连!`) under the header,
and game over opens the run: the biggest fruit you grew, drawn by the real
painter, next to merges / best chain / watermelons / annihilations — rows that
stayed at zero are left out. Best chain and fastest watermelon go to
`Arcade.records`; a *resumed* game doesn't compete for the time, because its
clock started in a session this one never saw.

What counts as a discovery, and when a chain has finished, are pure functions
over one drained event batch (`js/progress.js`) — `js/game.js` still knows
nothing about collections or celebration.

## Integration

Standard fleet game: evergreen `/arcade-sdk.js`, `Arcade.loop` render loop,
state under `arcade.v1.shuiguo.*` (mid-game save auto-resumes; flushed
synchronously in `onSuspend`), `Arcade.records` high score, best chain and
fastest watermelon, `Arcade.scores` leaderboard, `Arcade.stats` counters and
the discovery set. Theme, font scale and reduced motion honored in both the DOM
chrome and the canvas.

Audio is a graph-cue sound pack (`js/soundpack.js`, registered via
`ArcadeAudioElements.registerPack`) — a wooden fruit stand at midday; the
merge cue's voice deepens as the chain climbs, a sparkle of juice rides on top
of it through a cascade, the plank creaks once as the pile crosses the line,
and a discovery gets the watermelon's rising figure in miniature. No spec-cue
fallback: without the element library the game is silent by design. Audition it
offline:

```sh
node ../paulgibeault.github.io/tools/soundpack/render.mjs --config soundpack.config.json
```

## Dev

```sh
# from the launcher repo — stages launcher + game on 127.0.0.1:4791
./dev.sh ../shuiguo

npm test            # verify-artifact + node --test tests/
```

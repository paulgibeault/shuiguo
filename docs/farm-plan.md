# The Farm — campaign design & implementation plan

The second half of shuǐ guǒ tān: a terraced hillside farm in central Taiwan
that grows the fruit the stand drops. Fruit flows farm → stand; cash flows
stand → farm; seeds flow from merges. This document is the contract for
implementation: design decisions are **locked** unless marked as a knob, and
the work is cut into packages (WP0–WP11) with an explicit dependency graph so
independent packages can be built concurrently.

## 0. Locked design decisions

These came out of the design conversation and are settled:

1. **Finite crates.** The harvest you carry to market IS the drop supply.
   A market run ends when the crate empties, the pile tops out, or the player
   packs up voluntarily. (Alternate structures — e.g. "crate as spawn
   distribution" — are post-MVP options, §9.)
2. **Every ending is a sale.** Topping out is never punished beyond ending
   the run: the stall is appraised either way. Packing up voluntarily earns a
   **Tidy Stall** bonus so stopping on purpose feels smart, not cowardly.
3. **Very light narrative.** Design and images over dialog. Signs, glints,
   coin flights, and single hanzi/pinyin words (the discovery-card idiom) —
   no dialog boxes, no named characters, no cutscene text.
4. **Seed drip is on, tunable to 0.** First merge-creation of a level in a
   campaign run unlocks that seed permanently; later merges of an unlocked
   level have a small chance to grant a bonus seed. One `TUNING` knob, and
   `0` cleanly disables the drip.
5. **Free play is untouched.** The current game becomes "Free Play" on the
   menu, keeps its save key, score lane, and records exactly as today.
   Campaign lives in new state keys alongside it.

And the design pillars the decisions rest on:

- **Entertainment, not engagement.** No retention mechanics. Nothing rots,
  nothing dies, no daily anything. Timers exist to hand the player something
  pleasant when they open the app, never to scold them for staying away.
- **Generosity-first economy.** One currency (元). The player can never go
  broke-stuck: the first appraisal is floored above the starter-farm price,
  runs always pay, seeds always profit over their cost.
- **Score is score, cash is cash.** Score stays the arcade-pride number
  (free-play leaderboard untouched; campaign runs get their own lane). Cash
  is campaign-only. The two never convert.
- **Merging earns, growing arms.** Creation score comes only from merges
  (already true in `js/game.js`). A farm-grown watermelon dropped into the
  stall earns nothing by existing — it is board presence and sale value.
  Merged fruit is score; grown fruit is capital.
- **The campaign slowly breaks the 1–5 rule.** In campaign, what you can
  drop is what you can grow. Free play keeps `MAX_SPAWN_LEVEL = 5` forever.

## 1. The loop

```
        harvest (crate)                    appraisal (元)
  FARM ────────────────────▶ MARKET RUN ────────────────────▶ FARM
   ▲                          (the drop)                        │
   │                              │                             │
   │        seeds (first-merge unlock + tunable drip)           │
   └──────────────────────────────┴─────────────────────────────┘
                     spend: terraces, saplings, seeds, tools
```

Campaign opening (design-over-dialog, ~90 seconds to first ownership):

1. **Gift run.** First campaign boot lands directly at the stand with a
   generous gift crate (§5, `TUNING.giftCrate`) pulsing beside the dropper.
   No farm exists yet. Player plays a normal market run.
2. **First appraisal** — floored at `TUNING.firstRunFloor` so the farm is
   always affordable — then the view pans up the mountainside to a weedy
   terrace with a 出售 (for sale) sign and a price tag. Tap to buy.
3. **Starter farm** comes with a young cherry tree and a few strawberry
   seeds. Plant, water, wait a few minutes (the shortest timers in the game —
   first crops ripen while the player putters), harvest, and the crate glows:
   take it to market. The loop is now closed and never narrated.

Session shape thereafter: open app → harvest whatever ripened offline →
water/plant (~1 min) → market run (5–10 min) → appraisal → spend → plant
something slow → natural stopping point.

## 2. Architecture

The repo's discipline — pure modules with injected `now()`/rng, one host that
owns DOM and Arcade — extends unchanged. New pure modules test under
`node --test` with zero DOM.

```
js/constants.js      +FARM per-fruit data (kind/growth/yield/costs), +TUNING   (WP0)
js/economy.js        NEW  pure: appraisal, prices, tidy bonus, first-run floor (WP1)
js/farm.js           NEW  pure: plots, terraces, growth lazy-eval, water,
                          plant/harvest, serialize/restore                     (WP2)
js/campaign.js       NEW  pure: cash, seed inventory, unlocks, drip, crate,
                          phase machine, serialize/restore                     (WP3)
js/game.js           MOD  injectable spawn source (crate-fed or classic rng),
                          finish(reason), sold-out detection                   (WP4)
js/plant-art.js      NEW  pure painter: growth stages, trees, vines, beds      (WP5)
js/farm-scene.js     NEW  pure painter: terraced mountainside, fog, stream,
                          light/dark themes (sibling of js/scene.js)           (WP5)
js/chips.js          NEW  paintChip() extracted from main.js (shared by stand
                          HUD, menu chart, farm shop, appraisal sheet)         (WP8a)
js/mode.js           NEW  screen router: menu / free-play / campaign-farm /
                          campaign-market / appraisal                          (WP8a)
js/main.js           MOD  becomes boot + free-play host wiring                 (WP8a)
js/farm-host.js      NEW  host: farm screen DOM/canvas/input/HUD/shop          (WP6)
js/market-host.js    NEW  host: campaign market runs + appraisal sheet         (WP7)
index.html, style.css    new sheets: mode menu, farm, shop, appraisal          (WP6–8)
audio/, soundpack.config.json   new events (§WP9)                              (WP9)
tests/economy.test.js, tests/farm.test.js, tests/campaign.test.js  NEW
tests/game.test.js   MOD  spawn-source regression + crate/finish coverage
```

**Data flow rule:** `farm.js` and `campaign.js` never import `game.js` or any
painter; hosts are the only place the halves meet. `economy.js` imports only
`constants.js`.

**Clocks.** The board sim keeps `performance.now()`. The farm needs wall time
that elapses out-of-game: hosts inject `wallNow = () => Date.now()` and farm
state stores absolute ms epochs. Pure modules never call `Date.now()`
directly (testability, and the repo already forbids ambient clocks).
Clock-skew defensiveness: negative elapsed clamps to 0; forward jumps are
simply free growth — single-player and generosity-first, we don't fight it.

**Persistence (all under the existing `arcade.v1.shuiguo.*` scope):**

| Key | Owner | Contents |
|---|---|---|
| `save` | free play | unchanged — today's mid-run board save |
| `campaign` | campaign | cash, farm, seeds, unlocks, flags, crate (Arcade.state) |
| `market-save` | campaign | mid-run campaign board + remaining crate + run seeds |
| `discovered` | shared | unchanged — the global collection book |
| scores `classic` | free play | unchanged |
| scores `campaign` | campaign | market-run scores, separate lane |

**Seed unlocks are campaign-scoped.** The menu chart / `discovered` stays the
global collection book (either mode fills it in), but planting rights come
only from merges made *in campaign runs* — otherwise one lucky free-play run
would skip the whole progression. `campaign.js` keeps its own
`unlockedSeeds` set; `progress.js`'s `newDiscoveries()` machinery is reused
against campaign-run event batches to detect first-makes.

## 3. Mechanics specification

### 3.1 Crate & spawn source (WP4)

The crate is a multiset: `counts[level] → n`, levels 1–11. During a market
run the dropper draws uniformly at random *weighted by remaining counts*
(same feel as today's rng dropper, but from finite stock), decrementing at
draw time — `current` and `next` each hold a drawn, reserved fruit.

`makeGame({ rng, now, drawFruit })` — `drawFruit` optional; default is the
existing `rollSpawn` (classic mode byte-identical, regression-pinned by
test). Campaign passes a crate-backed draw that returns `null` when empty.
`null` propagates: `next` empties first, then `current`; the dropper hides.

Run endings, all producing `{ type: 'gameover', reason }`:

- `'toppled'` — existing deadline rule, unchanged.
- `'packed'` — new exported `finish(g, 'packed')`; host wires a Pack Up
  button, always visible during campaign runs. Earns Tidy Stall.
- `'sold-out'` — crate and hands empty; host auto-finishes once the pile
  settles (`PHYS.settleSpeed` already defines settled) or after 4 s,
  whichever first. Counts as packed (tidy bonus applies — selling every last
  fruit is maximally tidy).

**Big-fruit dropping.** Campaign crates may contain levels 6–11; `aim`/
`clampDropX` already scale by `radiusOf(current)`. Two required checks: the
held-fruit visual at `WORLD.dropperY = 52` overlaps the deadline for r ≥ 52
(pear and up) — render the held fruit scaled-to-fit in the dropper zone
(a "crated" look, e.g. 0.6× visual with true-size shadow ring) while physics
spawns true size; and `spawnGraceContact` already protects the deadline
during the fall. A watermelon is half the board wide — dropping one is
inherently risky, which is the intended self-balancing.

### 3.2 Appraisal (WP1)

```
appraise({ score, boardLevels, reason, isFirstRun }) → {
  runScore,                       // score earned by merging during the run
  boardValue,                     // Σ scoreOf(level) over fruit left on board
  tidyBonus,                      // reason packed/sold-out: round(subtotal × TUNING.tidyBonus)
  floorTopUp,                     // isFirstRun: max(0, TUNING.firstRunFloor − total)
  total                           // cash granted, 1 score-point = 1 元
}
```

Deep merging is intrinsically the high-paying play (a from-scratch watermelon
banked 1+2+…+1024 on the way up), while an unmerged board still sells at face
value — no fruit is ever wasted, including annihilations (they paid 2048 as
score). The appraisal sheet itemizes these lines visually (coins flying from
each board fruit, then the bonus stamp) — that UI is WP7; WP1 is just the
math.

### 3.3 Farm simulation (WP2)

Lazy timestamp evaluation — no timers run anywhere; state is evaluated
against `wallNow` whenever the host looks at it, which makes offline growth
free and the module trivially testable.

```
plot = {
  kind: 'bed' | 'tree' | 'vine' | null,   // null = empty, plantable
  level,                                   // fruit level growing here
  progressMs,                              // accrued watered growth
  lastEvalMs,                              // last evaluation epoch
  wateredUntilMs,                          // watering coverage window end
  mature: bool,                            // trees/vines: one-time maturation done
}
evaluate(plot, wallNowMs):
  gain = clamp(min(wallNowMs, wateredUntilMs) − lastEvalMs, 0, ∞)   // sprinkler ⇒ wateredUntil = ∞
  progressMs += gain; lastEvalMs = wallNowMs
```

- **Beds** (annuals): plant seed → grow `growthMs` → ripe (waits forever) →
  harvest `yield` fruit → plot empties.
- **Trees/vines** (perennials): plant sapling → mature over `matureMs`
  (one-time) → then repeating cycles of `cycleMs` → ripe → harvest `yield` →
  cycle restarts. The tree persists forever. Vines additionally require a
  trellis built on the plot.
- **Water** is a growth *gate*, never a health stat: `water(plot)` sets
  `wateredUntilMs = wallNow + TUNING.waterMs`. Dry soil pauses growth.
  Nothing wilts, dies, or rots — ripe fruit waits indefinitely. A terrace
  with a sprinkler, or the farm with stream irrigation, is permanently
  watered.
- **Fertilizer** (consumable): halves *remaining* time of the current
  stage. Stackable.
- **Terraces**: the farm is `terraces[]`, each with `plots[]` (see layout,
  §WP5/§WP6) and a `sprinkler` flag. Buying terrace N reveals it on the
  mountainside; prices in `TUNING`.

`serialize`/`restore` follow the `game.js` v1 pattern: version field,
defensive field-by-field validation, hostile-save discipline (out-of-range
values discarded, not clamped).

Harvested fruit goes to the **crate** (campaign state). MVP: the crate is
simply "everything harvested and not yet dropped"; one Take-to-Market button.
Crate packing/selection is post-MVP (§9).

### 3.4 Seeds & unlocks (WP3)

- Level 1 (cherry) is unlocked from the start; the starter farm includes a
  young cherry tree — the guaranteed fat-crate generosity mechanic once
  mature.
- First campaign merge-creation of level L: permanent seed unlock + a free
  `TUNING.firstUnlockSeeds` packet (celebrated with the existing
  discovery-card idiom, reworded kicker: 新种子! new seed!). Detection reuses
  `progress.js` (`isDiscoverable`, `newDiscoveries`) against the campaign
  run's event batch, tracked in `campaign.js`'s own `unlockedSeeds`.
- **Drip:** each campaign merge of an already-unlocked level grants +1 seed
  of that level with probability `TUNING.seedDripChance` (default 0.15;
  **0 disables** — the code must treat 0 as exactly never, no epsilon).
  Uses the game rng stream? No — drip rolls use a separate rng seeded from
  the run so replay/restore of a board save can't be scummed for seeds;
  simplest: roll at appraisal time over the run's merge tally per level,
  which also batches the reward into one satisfying "seeds found in the
  till" line on the appraisal sheet. (Decision: roll at appraisal. It's
  fewer moving parts and reads better.)
- The **shop** sells seeds/saplings for unlocked levels only (prices §4).

### 3.5 Campaign phase machine (WP3)

`phase: 'gift-run' → 'buy-farm' → 'open'`. In `'open'`, the player moves
freely between farm and market (market needs a non-empty crate). The phase
machine exists so the two onboarding beats can gate UI affordances (no farm
button during gift run; the for-sale pan after the first appraisal) without
any dialog. All flags persist in the `campaign` state key.

## 4. Data & tuning (WP0)

Everything below lives in `constants.js`: per-fruit farm columns appended to
a parallel `FARM` table (keeping `FRUITS` rows untouched for free-play
purity), plus one flat exported `TUNING` object so every balance knob has
exactly one home. **All numbers are starting points** — WP11 is the balance
pass; structure is what's locked.

Per-fruit (`FARM[level-1]`), sale value = existing `score` (face value):

| Lv | Fruit | Kind | Grow / mature→cycle | Yield | Seed/sapling 元 |
|---|---|---|---|---|---|
| 1 | Cherry | tree | 4 min → 4 min | 12 | 60 (sapling) |
| 2 | Strawberry | bed | 3 min | 6 | 6 |
| 3 | Grape | vine | 6 min → 5 min | 8 | 25 (+trellis) |
| 4 | Dekopon | tree | 12 min → 8 min | 6 | 90 |
| 5 | Persimmon | tree | 20 min → 12 min | 5 | 150 |
| 6 | Apple | tree | 40 min → 25 min | 4 | 300 |
| 7 | Pear | tree | 90 min → 45 min | 4 | 550 |
| 8 | Peach | tree | 3 h → 90 min | 3 | 1000 |
| 9 | Pineapple | bed | **24 h** | 2 | 400 |
| 10 | Melon | bed | 5 h | 2 | 800 |
| 11 | Watermelon | bed | 8 h | 1 | 1600 |

Pineapple is the deliberate outlier and the game's one running joke (real
ones take two years): the patient farmer's flex crop. To keep it from being
strictly-worse economics, harvesting a pineapple also grants one bonus seed
of a random unlocked level and gets a golden-hour celebration — an event, not
an investment.

```
TUNING = {
  giftCrate: { 1: 30, 2: 18, 3: 12, 4: 8, 5: 5 },  // ~apple-reach on an average first run
  firstRunFloor: 700,          // > starterFarmCost + a seed budget, always
  starterFarmCost: 500,        // terrace 1: 3 bed plots + 1 tree plot + young cherry tree + 4 strawberry seeds
  terraceCosts: [–, 500, 1200, 3000, 7500, 18000],  // terrace 1 is the starter farm
  plotsPerTerrace: 4,
  tidyBonus: 0.10,
  seedDripChance: 0.15,        // 0 disables
  firstUnlockSeeds: 2,
  waterMs: 6 h,                // one watering covers a session and then some
  sprinklerCost: 800,          // per terrace
  irrigationCost: 8000,        // whole farm, forever — the "made it" purchase
  trellisCost: 300,            // per plot, enables vines
  fertilizerCost: 50,          // consumable, halves remaining time
}
```

Sanity anchors: a decent gift run appraises ≈ 600–1000 (floor guarantees
≥ 700 = farm + seeds). Terrace costs roughly double while fruit face value
doubles per level, so income growth tracks cost growth — steady, not grindy.
Bed profit is always positive (strawberry: 6×2 − 6 = +6 minimum). Trees are
capital: expensive once, free forever.

## 5. Work packages

Each package lists deliverables, files, notes, and tests. Verification for
every package: `npm test` green (which includes the repo gates and artifact
verifier — new files are auto-precached at deploy by `tools/inject-precache.mjs`,
nothing to hand-maintain).

---

### WP0 — Data & tuning foundation  *(everything else keys off this; do first, alone)*

- `constants.js`: add `FARM` table (§4), `TUNING`, helper accessors
  (`farmOf(level)`, kind predicates). Touch nothing existing.
- `tests/fruits.test.js`: extend pins — `FARM.length === FRUITS.length`;
  growth times monotone-nonincreasing in profitability sense is NOT pinned
  (balance is WP11's), but structural invariants are: every level has a kind,
  positive yield, positive costs; pineapple is the only allowed
  time-ordering outlier (document the exception in the test).
- Small, ~half day. **Merge before anything else starts** — it is the one
  file every track imports.

### WP1 — Economy module *(pure; parallel track A)*

- `js/economy.js`: `appraise()` (§3.2), `priceOf` helpers reading TUNING,
  affordability predicates (`canBuy(cash, price)` trivial but keeps hosts
  arithmetic-free).
- `tests/economy.test.js`: appraisal itemization sums; tidy bonus only on
  packed/sold-out; floor top-up only on first run and only upward; empty
  board; annihilation-heavy board (score high, boardValue low).
- ~half day.

### WP2 — Farm simulation *(pure; parallel track A)*

- `js/farm.js`: plot/terrace model, `evaluate`, `water`, `plant`, `harvest`,
  `buildTrellis`, `fertilize`, `buyTerrace`, `serialize`/`restore` (§3.3).
- `tests/farm.test.js`: growth accrues only inside watered windows; offline
  elapse (evaluate after a simulated week: ripe, not rotten); dry pause;
  sprinkler/irrigation ⇒ infinite window; tree mature-then-cycle; harvest
  resets cycle, bed empties; fertilizer halves remaining; negative clock
  skew clamps; hostile-save fuzz in the `restore` style of `game.js`.
- ~1–1.5 days. The most test-heavy package; it is the half of the game that
  runs while nobody is looking.

### WP3 — Campaign state *(pure; parallel track A)*

- `js/campaign.js`: cash ledger, seed inventory, `unlockedSeeds`, phase
  machine, gift-crate constructor, crate mutations (harvest-in, draw-out),
  appraisal-time seed-drip roll (§3.4 — injected rng), serialize/restore.
- `tests/campaign.test.js`: unlock on first campaign make only; drip
  statistics over injected rng (and **exactly zero when chance = 0**);
  phase transitions; crate accounting round-trips; cash never negative.
- ~1 day.

### WP4 — game.js spawn source & endings *(parallel track B)*

- `js/game.js`: `drawFruit` injection defaulting to classic `rollSpawn`;
  null-propagation through `next`/`current`; `finish(g, reason)`;
  `gameover` event gains `reason` (default `'toppled'` — free-play code
  reads it never, so no host change needed there); serialize v-bump only
  for campaign saves (crate rides in `market-save`, not in `game.js`'s
  payload — the host owns it).
- `tests/game.test.js`: **regression pin** — default-mode spawn sequence
  byte-identical for a fixed rng seed before/after refactor; crate draw
  exhausts exactly; sold-out detection; finish() mid-fall; big-level drops
  clamp correctly at the walls.
- ~1 day. Do not touch rendering here (held-fruit scaling for big levels is
  WP7's, in the market host's render config).

### WP5 — Farm art & scene *(parallel track C; art-heavy, independent)*

- `js/farm-scene.js`: the mountainside. Terraces as stacked stone-walled
  bands up the slope (6 × ~90 world-units fits the 360×560 world — no
  scrolling in MVP), morning fog band, a stream down one side (the future
  irrigation fantasy made visible), light theme = clear morning, dark =
  evening with the same two paper lanterns idiom as the stall. Same
  contract as `js/scene.js`: pure painter, statics precomputed at module
  load, ≤ a couple of gentle animated elements (fog drift, stream shimmer),
  all off under reduced motion. Unbought terraces render as overgrown
  silhouettes with a 出售 sign.
- `js/plant-art.js`: growth-stage painters — bed mound → sprout → bush →
  fruited; sapling → young tree → mature tree with fruit hanging; trellis +
  vine. Fruit on plants is `paintFruit` at small scale (the one-painter rule:
  a strawberry on the bush is recognisably the strawberry that will bounce
  in the stall). Ripe = subtle glint, the universal "tap me".
- `tests/scene.test.js`-style stub-context smoke tests (paint every stage ×
  every fruit × both themes without throwing; no hex literals outside the
  FRUITS palette + a small named FARM_PALETTE).
- ~2 days. Zero logic dependencies — only WP0's table (which levels are
  beds/trees/vines).

### WP6 — Farm host & UI *(integration; after WP2+WP3+WP5, and WP8a)*

- `js/farm-host.js` + `index.html` farm sheet + `style.css`: canvas wired to
  `farm-scene`/`plant-art`; tap plot → contextual action (water / harvest /
  plant-picker / buy), long actions none — every farm interaction is one
  tap; farm HUD (cash, crate summary chip, Take-to-Market button that glows
  when the crate is non-trivial); the shop as a bottom sheet (seeds and
  saplings as chip cards via `js/chips.js`, equipment rows with prices —
  affordances grey when unaffordable, never hidden).
- Watering is the ritual: pour arc + droplet particles + soil darkening
  (reuse `effects.js` patterns), rate-limited, reduced-motion-gated.
- Persistence: evaluate-on-look everywhere; `Arcade.onSuspend` flushes
  `campaign` synchronously (same discipline as the board save).
- ~2–2.5 days. The biggest UI package.

### WP7 — Market host & appraisal *(integration; after WP1+WP3+WP4, and WP8a; parallel with WP6 — different sheets, coordinate on style.css)*

- `js/market-host.js`: campaign market runs on the existing board/renderer —
  crate-backed `drawFruit`, crate-remaining HUD strip (tiny chips × counts),
  Pack Up button, sold-out auto-finish, held-fruit scaled-to-fit rendering
  for levels ≥ 7 (§3.1), mid-run `market-save` (board + crate + run-seed
  tally) with the same debounce/suspend discipline as free play.
- Appraisal sheet: itemized lines landing one by one (runScore, board coins
  flying off each fruit into the till, tidy stamp, seed-drip "found in the
  till" packets, first-run floor as a quiet top-up line), total counts up
  with the coin sfx. Then: cash committed to campaign state, scores lane
  `campaign`, stats fold.
- ~2 days.

### WP8a — Router & host split *(refactor; start in wave 2, parallel with tracks A–C)*

- Extract `paintChip` → `js/chips.js`; extract screen routing from
  `main.js` → `js/mode.js`; add mode menu (Campaign / Free Play buttons —
  Campaign shows a 🌱 new-shoot badge until first farm purchase). `main.js`
  becomes boot + free-play wiring, behavior-identical (this package ships
  **zero** visible change except the menu buttons).
- This early refactor exists to de-conflict: `main.js`/`index.html` are the
  merge hotspot, so restructure them *before* WP6/WP7 build against the new
  seams.
- `tests`: existing suite green is the acceptance; add a smoke test that
  free-play boot path still writes the same keys.
- ~1 day.

### WP8b — Save wiring & mode isolation *(after WP8a, WP3; small)*

- `campaign`/`market-save` key plumbing, resume rules per mode (mid-market
  save resumes into market; otherwise campaign boots to farm in phase
  `open`), `Arcade.onStateReplaced` recompute, free-play keys untouched
  (pin with a test).
- ~half day.

### WP9 — Audio *(parallel track D; anytime; non-blocking by fleet rule)*

- New soundpack events: `water`, `plant`, `harvest` (pitch by level, like
  merges), `coin` (appraisal tick), `till` (total lands), `buy`,
  `terrace-fanfare`, `ripe-chime` (soft, once, on entering a farm with
  something ripe), `pack-up`. `soundpack.config.json` + `js/soundpack.js`
  registration + audio assets. Missing sounds play silence by design, so
  every other package ships without this one.
- ~1 day (asset production dominates).

### WP10 — Onboarding beats *(after WP6+WP7)*

- The three-beat opening (§1) as pure staging: gift-crate pulse, the
  post-appraisal pan up the mountain (a camera move over `farm-scene`, the
  one scripted moment in the game), 出售 sign tap-to-buy, glints guiding
  plant → water → harvest → market. One reused card idiom for "你的农场!
  your farm!". **No text beyond single bilingual words.** Skippable by
  simply doing the thing the glint points at.
- ~1 day.

### WP11 — Balance & polish pass *(last; whole-game)*

- Play the tuning table (§4) against reality: first-session arc must reach
  "planted my farm" inside ~10 minutes; a returning session must always
  open to ≥ 1 ripe thing (check timer spread); verify the doubling curves
  (terrace cost vs. income per tier); pineapple joke lands as event-not-trap.
  Adjust only `TUNING`/`FARM` numbers — no mechanics changes in this WP.
- Full QA sweep: suspend/resume mid-everything, hostile saves, reduced
  motion, font scale, dark theme on both scenes, offline (precache) boot.
- ~1–2 days.

## 6. Dependency graph & concurrency plan

```
WP0 ──┬── WP1 (economy) ──────┐
      ├── WP2 (farm sim) ─────┼──▶ WP6 (farm host) ──┐
      ├── WP3 (campaign) ─────┤                      ├──▶ WP10 ──▶ WP11
      ├── WP4 (game.js) ──────┼──▶ WP7 (market host)─┘
      ├── WP5 (art) ──────────┘         ▲
      ├── WP8a (router split) ──▶ WP8b ─┘
      └── WP9 (audio) ─────────────────────────────── joins whenever ready
```

**Waves** (maximum useful parallelism):

| Wave | Packages | Parallelism |
|---|---|---|
| 1 | WP0 | solo — merge first, it's the shared import |
| 2 | WP1, WP2, WP3, WP4, WP5, WP8a, WP9 | up to 7 concurrent; zero file overlap by design |
| 3 | WP6, WP7, WP8b | WP6 ∥ WP7 (different sheets/hosts); both touch `index.html`/`style.css` — either serialize those two files' edits or partition style.css with clearly-owned sections |
| 4 | WP10, then WP11 | serial; whole-game scope |

**Conflict hotspots & rules:** `constants.js` is WP0-only (frozen after
wave 1 except WP11's number tuning). `main.js`/`index.html` are WP8a's to
restructure — tracks A–D must not touch them in wave 2 (they don't need to).
If implementing with parallel agents, run wave-2 packages in isolated
worktrees and merge in dependency order (WP0 → track PRs → integration);
each package's own test file is its merge gate.

**Estimated critical path:** WP0 → WP2/WP3 → WP6 → WP10 → WP11 ≈ 6–7
working days serial; with wave-2 parallelism the wall-clock is dominated by
the integration wave, roughly 4–5 days end to end.

## 7. Definition of done (MVP campaign)

- Fresh player: gift run → buy farm → plant/water → harvest → market → spend,
  with zero dialog and no dead ends; first session reaches farm ownership.
- Free play byte-identical in behavior, saves, scores, records.
- Closing the app anywhere loses nothing (board saves, farm is lazy-eval).
- A week away: everything ripe, nothing rotten, no scolding.
- `seedDripChance: 0` produces exactly zero dripped seeds.
- `npm test` green; offline boot works with the new assets precached.

## 8. Explicit non-goals (MVP)

Soil quality, weather, pests, crop failure, decorations, NPCs, quests,
notifications, daily rewards. The farm is the calm inhale before the drop's
exhale — one delightful interaction per element. Everything else is
Stardew's job.

## 9. Later options (designed-for, not built)

- **Crate packing:** choose what goes to market (strategy layer over the
  MVP's take-everything crate). The crate model already supports it.
- **Distribution mode:** the "crate as spawn-weights" alternate structure,
  as a post-campaign unlockable stall variant.
- **Decorations shop:** cash sink for stall/farm cosmetics that carry into
  free play's stall.
- **Golden fruit:** rare harvest variant worth 2× — a farm-side jackpot that
  mirrors the drop-side annihilation thrill.
- **Records:** `richest-market-day`, `first-harvest` style records once the
  campaign lanes prove out.

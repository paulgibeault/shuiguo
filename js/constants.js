// shuǐ guǒ tān (水果摊) — fruit table and world constants.
//
// Pure data, shared by game logic, renderer, and tests. The fruit chain is the
// GRD's 11-level progression: relative radii scale from the cherry, score is
// awarded on CREATION of that level via a merge, and only levels 1–5 ever
// spawn in the dropper.

// World units. The renderer scales this to the canvas; physics runs in these.
export const WORLD = {
  width: 360,          // inner container width (wall to wall)
  height: 560,         // total world height
  floorY: 545,         // container floor
  deadlineY: 96,       // the dotted line of death (fruit top above ⇒ danger)
  dropperY: 52,        // held fruit hangs here
};

// Radius of a cherry in world units; every other level scales from it.
const BASE_R = 15;

// `bounce` is the fruit's coefficient of restitution — its personality in one
// number. Little fruit are pips that ping around; big fruit land like sacks of
// water. Monotonically non-increasing with level (pinned by tests/fruits).
//
// The colour quartet is the whole palette a fruit gets: `color` body, `rind`
// outline and shadow, `face` features, `accent` for its own texture (seeds,
// netting, stripes, pebbling), `leaf` for the green of stems and crowns.
// js/fruit-art.js draws exclusively from these — no hex literals in the
// painter, so a fruit can be recoloured here and stay coherent everywhere.
export const FRUITS = [
  // level is index+1. hanzi/pinyin drive the cute bilingual UI.
  { name: 'Cherry',     hanzi: '樱桃', pinyin: 'yīngtáo',  scale: 1.0, score: 1,    bounce: 0.50, color: '#d23c50', rind: '#a12439', face: '#5a1420', accent: '#ff8a9c', leaf: '#5f8f3e' },
  { name: 'Strawberry', hanzi: '草莓', pinyin: 'cǎoméi',   scale: 1.4, score: 2,    bounce: 0.42, color: '#e85d75', rind: '#c04058', face: '#63182a', accent: '#ffe2a6', leaf: '#5f9440' },
  { name: 'Grape',      hanzi: '葡萄', pinyin: 'pútáo',    scale: 1.8, score: 4,    bounce: 0.38, color: '#9b6dc8', rind: '#7a4fa5', face: '#3c2159', accent: '#c3a3e4', leaf: '#6f9450' },
  { name: 'Dekopon',    hanzi: '橘子', pinyin: 'júzi',     scale: 2.2, score: 8,    bounce: 0.34, color: '#f0a03c', rind: '#cd7f22', face: '#6b4310', accent: '#d98c1e', leaf: '#5f8f3e' },
  { name: 'Persimmon',  hanzi: '柿子', pinyin: 'shìzi',    scale: 2.6, score: 16,   bounce: 0.30, color: '#ef7d3a', rind: '#c95e20', face: '#66300f', accent: '#ffb37a', leaf: '#6b8f45' },
  { name: 'Apple',      hanzi: '苹果', pinyin: 'píngguǒ',  scale: 3.0, score: 32,   bounce: 0.28, color: '#e04b3a', rind: '#b53125', face: '#5c1710', accent: '#7a4a24', leaf: '#5f9440' },
  { name: 'Pear',       hanzi: '梨',   pinyin: 'lí',       scale: 3.5, score: 64,   bounce: 0.24, color: '#c8d465', rind: '#a4b046', face: '#4d541b', accent: '#8d9440', leaf: '#5f8f3e' },
  { name: 'Peach',      hanzi: '桃',   pinyin: 'táo',      scale: 4.0, score: 128,  bounce: 0.22, color: '#f6b8c1', rind: '#e08a9a', face: '#7a3a46', accent: '#fde7cd', leaf: '#5f9440' },
  { name: 'Pineapple',  hanzi: '菠萝', pinyin: 'bōluó',    scale: 4.6, score: 256,  bounce: 0.18, color: '#e8c84a', rind: '#c2a02c', face: '#5f4d11', accent: '#a8871f', leaf: '#6d9a3c' },
  { name: 'Melon',      hanzi: '甜瓜', pinyin: 'tiánguā',  scale: 5.2, score: 512,  bounce: 0.14, color: '#b5d98a', rind: '#8fb968', face: '#42592b', accent: '#eef5da', leaf: '#6f9450' },
  { name: 'Watermelon', hanzi: '西瓜', pinyin: 'xīguā',    scale: 6.0, score: 1024, bounce: 0.10, color: '#4f9e56', rind: '#2f6e3c', face: '#1c3f22', accent: '#1f4f2a', leaf: '#6f9450' },
];

// Face personality, one row per level, consumed by js/fruit-art.js. Every
// fruit wears the same face *machinery* — two eyes, a mouth, blush — and
// differs only in these numbers, so "sleepy grape" and "stoic watermelon" are
// data the table can retune rather than branches in the painter.
//
// All values are fractions of the face radius (r/2):
//   eye    eye radius            gap  eye spacing from centre
//   eyeY   eye height (−up)      lid  0 = wide open, 1 = fully shut
//   mouth  mouth arc radius      mouthY  mouth height
//   blush  cheek radius (0 = no blush)
export const FACES = [
  { eye: 0.17, gap: 0.50, eyeY: -0.14, lid: 0.00, mouth: 0.32, mouthY: 0.14, blush: 0.18 }, // cherry — bright and up for it
  { eye: 0.18, gap: 0.55, eyeY: -0.12, lid: 0.00, mouth: 0.36, mouthY: 0.12, blush: 0.22 }, // strawberry — cheerful, wide-eyed
  { eye: 0.17, gap: 0.48, eyeY: -0.14, lid: 0.38, mouth: 0.22, mouthY: 0.18, blush: 0.14 }, // grape — half-lidded, sleepy
  { eye: 0.15, gap: 0.52, eyeY: -0.15, lid: 0.00, mouth: 0.30, mouthY: 0.15, blush: 0.16 }, // dekopon — lively
  { eye: 0.14, gap: 0.46, eyeY: -0.16, lid: 0.06, mouth: 0.26, mouthY: 0.16, blush: 0.24 }, // persimmon — round and gentle
  { eye: 0.14, gap: 0.50, eyeY: -0.15, lid: 0.00, mouth: 0.30, mouthY: 0.14, blush: 0.15 }, // apple — crisp, alert
  { eye: 0.12, gap: 0.44, eyeY: -0.16, lid: 0.05, mouth: 0.24, mouthY: 0.16, blush: 0.12 }, // pear — small features, polite
  { eye: 0.15, gap: 0.48, eyeY: -0.14, lid: 0.18, mouth: 0.26, mouthY: 0.16, blush: 0.28 }, // peach — soft and dreamy
  { eye: 0.13, gap: 0.54, eyeY: -0.15, lid: 0.24, mouth: 0.30, mouthY: 0.15, blush: 0.10 }, // pineapple — narrow-eyed, proud
  { eye: 0.12, gap: 0.46, eyeY: -0.16, lid: 0.30, mouth: 0.22, mouthY: 0.16, blush: 0.12 }, // melon — heavy-lidded, calm
  { eye: 0.11, gap: 0.44, eyeY: -0.15, lid: 0.12, mouth: 0.20, mouthY: 0.16, blush: 0.10 }, // watermelon — stoic
];

// The friends whose stalls you can mind when you are not running your own.
//
// The campaign pillar — no named characters, no dialog — stands, because a
// friend IS a fruit: name, face, portrait and colour all come out of the tables
// above, so the whole cast costs no new art and no new words. Each of them
// stocks their stall differently, which is the entire mechanical difference
// between them.
//
// A friend's stall opens when their seed is unlocked, and seeds are unlocked
// only by merging that fruit in a CAMPAIGN run — so the cast is met through the
// campaign and pays back into it. That is the loop closing in both directions,
// and it needs no persistence of its own: `c.unlocked` already knows.
//
// The table is the invitation to grow this later. The proud 菠萝 running a
// pineapple-only gag stall is sitting right there.
// `restockMs` is how long that friend's farm needs to pick the NEXT morning,
// counted from the moment their last one was sold — the limit of one grower's
// land, said in the only unit the game has for it. Its shape is the farm table
// below, one tier up: a strawberry bed comes back inside a session, an apple
// tree takes its time. It can never leave a player with nothing to do, because
// the wholesaler has no such clock and is always open (see WHOLESALER).
export const FRIENDS = [
  // level: the friend IS this fruit. weights: how their crate is stocked, over
  // spawn levels 1..5. crate: how much of it there is — a friend's crate is a
  // MORNING'S PRODUCE, so it is finite, and running it out is one of the two
  // ways to close their stall neatly. flavor: one word, both languages.
  //
  // Crate size is the other half of each stall's character, and it is tuned
  // against the flavour rather than levelled: 葡萄 rains small fruit that merges
  // away, so their morning is long; 苹果 sends down big ones that fill the board,
  // so theirs is short and fierce.
  { level: 2, weights: [1, 1, 1, 1, 1], crate: 60, restockMs:  8 * 60 * 1000, flavor: 'Balanced 平衡' },   // 草莓 — the first friend, and always open
  { level: 3, weights: [3, 3, 2, 1, 0], crate: 80, restockMs: 15 * 60 * 1000, flavor: 'Cozy 悠闲' },       // 葡萄 — small fruit, long runs, chain paradise
  { level: 6, weights: [0, 1, 1, 2, 3], crate: 45, restockMs: 25 * 60 * 1000, flavor: 'Risky 冒险' },      // 苹果 — big stock, the board fills fast and pays fast
];

export const MAX_LEVEL = FRUITS.length;               // 11

// The wholesaler, and the reason the friends' crates are allowed to be finite.
//
// Somebody in this valley sells fruit by the lorry-load, and what they will sell
// you is a crate that never empties — which is the endless board this game
// shipped with, kept intact and given a door of its own. `crate: 0` IS the
// endlessness (js/friends.js §isEndless): a stall with no morning's produce
// behind it draws from the sky forever.
//
// They are the watermelon because a friend IS a fruit and the top of the chain
// is the one nobody grows in their back garden. They take the same share of the
// till as any friend — an endless crate is stock somebody fronted you, not a
// gift — and being evenly stocked AND endless, theirs is the one board whose
// scores are comparable with everybody else's (js/friends.js §isRanked).
//
// No `restockMs`, and there could not be one: nobody's field is behind that
// crate, so there is nothing to wait for it to grow. That is what makes the
// friends' clocks safe to have at all — however many stalls are picking again,
// this door is open (js/friends.js §restockMsOf).
export const WHOLESALER = {
  level: MAX_LEVEL,
  weights: [1, 1, 1, 1, 1],
  crate: 0,
  title: 'Wholesaler',
  alt: '批发商 pīfāshāng',
  flavor: 'Endless 无限',
};
export const MAX_SPAWN_LEVEL = 5;                     // only 1..5 drop randomly
// Two watermelons annihilate — the ultimate merge. Continue the doubling.
export const ANNIHILATE_SCORE = 2048;

export function radiusOf(level) { return BASE_R * FRUITS[level - 1].scale; }
export function scoreOf(level) { return FRUITS[level - 1].score; }
export function bounceOf(level) { return FRUITS[level - 1].bounce; }

// Physics tuning. Mass ∝ r² so big fruit feels heavy.
//
// Restitution is NOT global — it lives per fruit in FRUITS[].bounce (walls and
// floor use the body's own value; fruit-fruit contacts use the pair average).
export const PHYS = {
  gravity: 1500,        // u/s²
  friction: 0.08,       // tangential damping per contact resolution
  airDrag: 0.0006,      // per-step velocity bleed
  substeps: 4,          // physics substeps per 60 Hz frame
  solverIters: 6,       // collision resolution passes per substep
  settleSpeed: 10,      // |v| below this on every body ⇒ scene settled
  maxDt: 1 / 30,        // clamp long frames (tab jank) so tunneling stays rare
  inelasticSpeed: 40,   // approach slower than this resolves dead — the standard
                        // restitution cutoff, without it bouncy fruit micro-hops forever
  impactSpeed: 120,     // approach above this is a "landing" worth a bounce event
};

// ── the farm half ──────────────────────────────────────────────────────────
//
// Campaign only. `FRUITS` above stays exactly the free-play table — a parallel
// row per level keeps the farm's columns out of the arcade game's data, so
// free play cannot drift by accident.
//
// A fruit's SALE value is its existing `score` (face value). What the farm adds
// is how it is grown:
//
//   kind      'bed'  annual — plant a seed, grow once, harvest, plot empties
//             'tree' perennial — matures once, then fruits on a cycle forever
//             'vine' perennial that additionally needs a trellis on the plot
//   growthMs  time from planting to the FIRST ripe crop
//   cycleMs   perennials: time from harvest to ripe again. null for annuals.
//             Faster than growthMs for every tree the player PLANTS — raising
//             one is the investment, and the crops after it are the return.
//             The cherry is the exception, and it is the only tree nobody
//             plants: it comes with the farm, already grown by somebody else,
//             so its first crop lands sooner than its steady cycle.
//   yield     fruit per harvest, dropped into the crate
//   cost      元 for one seed (bed) or sapling (tree/vine)
//
// Deliberate shape: small fruit are cheap, fast and generous; big fruit are
// capital. Pineapple is the outlier and the game's one running joke — real
// ones take two years, so this one takes a day.
//
// The generosity floor (pinned by tests/fruits): an ANNUAL always clears its
// seed in the single harvest it lives for, and a PERENNIAL clears its sapling
// within a handful of cycles and is free forever after. The big beds run at a
// steady 1.28× return per planting (pineapple 512/400, melon 1024/800,
// watermelon 2048/1600) — which is why the watermelon plant bears two.
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// The first ten minutes are their own design problem. A player who has just
// bought a farm, planted it and watered it has nothing left to do, and the two
// starter crops are the whole of what they are waiting on — so those two are
// paced to the first session and everything from the grape up is left alone,
// because the long waits ARE the come-back-later texture.
//
// For a perennial `growthMs` is already the one-time planting-to-first-crop
// wait and `cycleMs` the steady state, so the cherry can pay off fast the first
// time without touching how the orchard runs afterwards. No new column needed.
export const FARM = [
  // level is index+1, matching FRUITS.
  { kind: 'tree', growthMs:  2 * MIN,  cycleMs:  4 * MIN,  yield: 12, cost:   60 }, // cherry
  { kind: 'bed',  growthMs: 90 * 1000, cycleMs: null,      yield:  6, cost:    6 }, // strawberry
  { kind: 'vine', growthMs:  6 * MIN,  cycleMs:  5 * MIN,  yield:  8, cost:   25 }, // grape
  { kind: 'tree', growthMs: 12 * MIN,  cycleMs:  8 * MIN,  yield:  6, cost:   90 }, // dekopon
  { kind: 'tree', growthMs: 20 * MIN,  cycleMs: 12 * MIN,  yield:  5, cost:  150 }, // persimmon
  { kind: 'tree', growthMs: 40 * MIN,  cycleMs: 25 * MIN,  yield:  4, cost:  300 }, // apple
  { kind: 'tree', growthMs: 90 * MIN,  cycleMs: 45 * MIN,  yield:  4, cost:  550 }, // pear
  { kind: 'tree', growthMs:  3 * HOUR, cycleMs: 90 * MIN,  yield:  3, cost: 1000 }, // peach
  { kind: 'bed',  growthMs: 24 * HOUR, cycleMs: null,      yield:  2, cost:  400 }, // pineapple
  { kind: 'bed',  growthMs:  5 * HOUR, cycleMs: null,      yield:  2, cost:  800 }, // melon
  { kind: 'bed',  growthMs:  8 * HOUR, cycleMs: null,      yield:  2, cost: 1600 }, // watermelon
];

// The pineapple takes longer than fruit worth four times as much, and that is
// on purpose: it is the patient farmer's flex, an event rather than an
// investment. To keep it from being strictly-worse economics, harvesting one
// also grants a bonus seed of a random unlocked level (js/campaign.js).
export const PINEAPPLE_LEVEL = 9;

export function farmOf(level) { return FARM[level - 1]; }
export function isPerennial(level) { return FARM[level - 1].kind !== 'bed'; }
export function needsTrellis(level) { return FARM[level - 1].kind === 'vine'; }
export function growthOf(level) { return FARM[level - 1].growthMs; }
export function cycleOf(level) { return FARM[level - 1].cycleMs; }
export function yieldOf(level) { return FARM[level - 1].yield; }
export function seedCostOf(level) { return FARM[level - 1].cost; }

// Every balance knob in the campaign, in one place. WP11 tunes these numbers;
// nothing else in the campaign carries a magic constant of its own.
//
// Generosity-first: `firstRunFloor` exceeds `starterFarmCost` by a seed budget,
// so the first appraisal always buys the farm AND something to plant in it —
// the player can never end the opening broke.
export const TUNING = {
  giftCrate: { 1: 30, 2: 18, 3: 12, 4: 8, 5: 5 },  // ~apple-reach on an average first run
  firstRunFloor: 700,          // floor on the FIRST appraisal only
  starterFarmCost: 500,        // terrace 1 + a young cherry tree + 4 strawberry seeds
  starterSeeds: { 2: 4 },      // what the starter farm comes planted-ready with
  starterTree: 1,              // …and the sapling already in its tree plot
  // …and one bed that comes with the farm already half grown and watered. The
  // tree teaches the ritual (it arrives thirsty, so the first tap is a
  // watering); this one keeps its promise while that lesson is still warm,
  // instead of leaving the new farm three minutes of nothing.
  starterCrop: 2,
  starterCropProgress: 0.5,
  terraceCosts: [0, 500, 1200, 3000, 7500, 18000],  // index 0 is the starter terrace
  plotsPerTerrace: 4,
  treePlotsPerTerrace: 1,      // one of the four takes a tree/vine; the rest are beds
  // ── the merchant's curve ────────────────────────────────────────────────
  // What a MERGE fetches at market, as a multiple of the fruit's face value.
  // Campaign only: FRUITS[].score is the arcade table and stays arcade pride.
  //
  // The problem it fixes: a pear built from scratch banked ~126元 of cumulative
  // merge score against 64元 of face value, so merging roughly doubled a fruit's
  // worth while the effort curve to reach it was far steeper. Small fruit
  // therefore pay face — merging two cherries is not a feat — and the premium
  // opens up from the dekopon so that deep merging is what a market day is FOR.
  //
  // One entry per level, monotonically non-decreasing (pinned by
  // tests/economy). Fruit left unmerged on the counter never sees any of this:
  // it sells at face, which is the whole point of the premium.
  tierPremium: [1, 1, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5],
  // …and what a combo adds on top, per link past the first. A 4-chain pays
  // ×1.45. Deliberately a bonus rather than the main course: chains are luck
  // steered by skill, and the tier table is the part the player chooses.
  chainBonus: 0.15,
  // How soon a crop has to be ripening for the farm to count as having
  // something to do. Past it, with an empty crate, the farm's menu button
  // wears a quiet badge — a friend could use a hand. Not a summons: it retires
  // the moment there is anything in the crate.
  friendNudgeMs: 2 * MIN,
  // The friend's cut of a stall you minded for them (js/economy.js §friendCut).
  // Deliberately well below a real market day's takings: minding a stall is the
  // fallback activity for when the crate is empty and nothing is ripe, not the
  // optimum. It is paid on arcade SCORE at 1:1 — the friend's stall is an
  // arcade board and the merchant's curve is not theirs to charge.
  friendCut: 0.2,
  tidyBonus: 0.10,             // packed / sold-out: fraction of the subtotal
  seedDripChance: 0.15,        // 0 disables the drip exactly — no epsilon
  firstUnlockSeeds: 2,         // free packet when a level is first merged in campaign
  waterMs: 6 * HOUR,           // FLOOR on one watering — see js/farm.js §water:
                               // a watering always covers at least the rest of
                               // the current stage, so no crop is ever a
                               // come-back-and-top-it-up treadmill
  sprinklerCost: 800,          // per terrace: that terrace is watered forever
  irrigationCost: 8000,        // whole farm, forever — the "made it" purchase
  trellisCost: 300,            // per plot, enables vines
  fertilizerCost: 50,          // consumable: halves the remaining stage time
};

export const MAX_TERRACES = TUNING.terraceCosts.length;

// Game feel / rules.
export const RULES = {
  overLineMs: 3000,     // continuous time above deadline ⇒ game over (GRD §5)
  dropCooldownMs: 450,  // fixed input lock after a drop — roughly the fall time
                        // to a mid-height pile. Deliberately NOT settle-based:
                        // waiting on a bouncy pile made the game feel sluggish.
  impactEventMs: 150,   // per-body rate limit on bounce events (settling pile
                        // must not spam the juice layer)
  spawnGraceContact: true, // a fruit can't trip the deadline until first contact
  // A combo is measured in WALL TIME, not in physics ticks. A tick is ~4ms of
  // sim, so a tick-scoped chain only ever counted merges that were born already
  // touching — the gravity-fed cascade the player actually watches happen spans
  // hundreds of ticks and used to be credited as a row of 1-chains. This is the
  // window between one merge and the next for them to count as the same combo,
  // and it is generous on purpose: a pile settling into its second merge is the
  // thing being credited.
  chainWindowMs: 1800,
};

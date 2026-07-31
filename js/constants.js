// shuǐguǒ (水果) — fruit table and world constants.
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

export const MAX_LEVEL = FRUITS.length;               // 11
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

// Game feel / rules.
export const RULES = {
  overLineMs: 3000,     // continuous time above deadline ⇒ game over (GRD §5)
  dropCooldownMs: 450,  // fixed input lock after a drop — roughly the fall time
                        // to a mid-height pile. Deliberately NOT settle-based:
                        // waiting on a bouncy pile made the game feel sluggish.
  impactEventMs: 150,   // per-body rate limit on bounce events (settling pile
                        // must not spam the juice layer)
  spawnGraceContact: true, // a fruit can't trip the deadline until first contact
};

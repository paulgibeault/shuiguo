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

export const FRUITS = [
  // level is index+1. hanzi/pinyin drive the cute bilingual UI.
  { name: 'Cherry',     hanzi: '樱桃', pinyin: 'yīngtáo',  scale: 1.0, score: 1,    color: '#d23c50', rind: '#a12439', face: '#5a1420' },
  { name: 'Strawberry', hanzi: '草莓', pinyin: 'cǎoméi',   scale: 1.4, score: 2,    color: '#e85d75', rind: '#c04058', face: '#63182a' },
  { name: 'Grape',      hanzi: '葡萄', pinyin: 'pútáo',    scale: 1.8, score: 4,    color: '#9b6dc8', rind: '#7a4fa5', face: '#3c2159' },
  { name: 'Dekopon',    hanzi: '橘子', pinyin: 'júzi',     scale: 2.2, score: 8,    color: '#f0a03c', rind: '#cd7f22', face: '#6b4310' },
  { name: 'Persimmon',  hanzi: '柿子', pinyin: 'shìzi',    scale: 2.6, score: 16,   color: '#ef7d3a', rind: '#c95e20', face: '#66300f' },
  { name: 'Apple',      hanzi: '苹果', pinyin: 'píngguǒ',  scale: 3.0, score: 32,   color: '#e04b3a', rind: '#b53125', face: '#5c1710' },
  { name: 'Pear',       hanzi: '梨',   pinyin: 'lí',       scale: 3.5, score: 64,   color: '#c8d465', rind: '#a4b046', face: '#4d541b' },
  { name: 'Peach',      hanzi: '桃',   pinyin: 'táo',      scale: 4.0, score: 128,  color: '#f6b8c1', rind: '#e08a9a', face: '#7a3a46' },
  { name: 'Pineapple',  hanzi: '菠萝', pinyin: 'bōluó',    scale: 4.6, score: 256,  color: '#e8c84a', rind: '#c2a02c', face: '#5f4d11' },
  { name: 'Melon',      hanzi: '甜瓜', pinyin: 'tiánguā',  scale: 5.2, score: 512,  color: '#b5d98a', rind: '#8fb968', face: '#42592b' },
  { name: 'Watermelon', hanzi: '西瓜', pinyin: 'xīguā',    scale: 6.0, score: 1024, color: '#4f9e56', rind: '#2f6e3c', face: '#1c3f22' },
];

export const MAX_LEVEL = FRUITS.length;               // 11
export const MAX_SPAWN_LEVEL = 5;                     // only 1..5 drop randomly
// Two watermelons annihilate — the ultimate merge. Continue the doubling.
export const ANNIHILATE_SCORE = 2048;

export function radiusOf(level) { return BASE_R * FRUITS[level - 1].scale; }
export function scoreOf(level) { return FRUITS[level - 1].score; }

// Physics tuning. Mass ∝ r² so big fruit feels heavy.
export const PHYS = {
  gravity: 1500,        // u/s²
  restitution: 0.18,    // bounciness of fruit-fruit and fruit-wall contact
  friction: 0.08,       // tangential damping per contact resolution
  airDrag: 0.0006,      // per-step velocity bleed
  substeps: 4,          // physics substeps per 60 Hz frame
  solverIters: 6,       // collision resolution passes per substep
  settleSpeed: 10,      // |v| below this on every body ⇒ scene settled
  maxDt: 1 / 30,        // clamp long frames (tab jank) so tunneling stays rare
};

// Game feel / rules.
export const RULES = {
  overLineMs: 3000,     // continuous time above deadline ⇒ game over (GRD §5)
  dropLockMaxMs: 1500,  // settle normally re-enables input; this caps a
                        // never-quite-still pile so the game can't soft-lock
  spawnGraceContact: true, // a fruit can't trip the deadline until first contact
};

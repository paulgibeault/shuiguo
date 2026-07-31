// Fruit characters for shuǐ guǒ tān: every fruit's silhouette, texture, accessory
// and face, drawn procedurally. No sprites, no image files — the art is
// resolution-independent and weighs nothing.
//
// THE ONE PAINTER. The board renderer, the NEXT preview and the menu chart all
// call paintFruit() so a cherry is the same cherry everywhere. Before this
// module there were two divergent painters (render.js and main.js); there is
// now one, and adding a third is the bug.
//
// Pure module: it touches no globals, only the 2D context it is handed, so it
// runs under node --test against a stub context. Everything it draws comes out
// of the FRUITS / FACES tables in js/constants.js — no colour literals here
// beyond neutral white/black washes for gloss and shadow.
//
// Layering, and why: the BODY and its ACCESSORIES rotate with `angle` (a
// rolling apple's stem swings around, which is the only roll cue left), but
// the FACE stays upright. Upright faces are the cuter read — a fruit tumbling
// face-down looks distressed rather than charming — and they keep expressions
// legible in a churning pile.
//
// Costs: this runs per body per frame. Silhouette paths are traced from
// constants, texture fields are module-level constant arrays (no per-frame
// randomness — that shimmers), and the two gradients per fruit are cached per
// (context, level, radius). Nothing here allocates in the steady state.

import { FRUITS, FACES } from './constants.js';

export const EXPRESSIONS = ['neutral', 'blink', 'happy', 'worried'];

export const ART = {
  happyMs: 500,        // squint-smile after being born from a merge
  blinkMs: 120,        // how long an idle blink lasts
  blinkMinMs: 3000,    // blink period floor …
  blinkVarMs: 3000,    // … and its spread, so a pile doesn't blink in unison

  // How far past the physics radius anything may be drawn, as a multiple of r.
  // The filled BODY silhouettes all stay inside 1.06 — a pear that overhung its
  // own collision circle would make contacts look faked. Thin accessories
  // (stems, crowns, the tendril) are allowed out to this larger cap: at cherry
  // size r is 15 world units, so a 1.1 ceiling buys 1.5 units of stem, which is
  // nothing, and silhouette-legibility is the whole point of the package. They
  // are strokes and slivers, never mass, so the fruit still *reads* as radius r.
  // tests/fruit-art.test.js measures every path coordinate against this.
  maxExtent: 1.3,
};

// ── deterministic texture fields ───────────────────────────────────────────
// Built once at module load in unit-circle coordinates. Per-frame randomness
// would make speckles crawl across the fruit; a fixed field is a texture.

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Poisson-ish scatter inside a disc of the given radius, biased away from the
// face box in the middle so speckles never read as extra eyes.
function scatter(n, seed, rMax, clearFace) {
  const rnd = lcg(seed);
  const out = [];
  for (let guard = 0; out.length < n && guard < n * 40; guard++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * rMax;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    if (clearFace && Math.abs(x) < 0.42 && y > -0.42 && y < 0.5) continue;
    out.push({ x, y, s: 0.6 + rnd() * 0.7 });
  }
  return out;
}

const SEEDS = scatter(16, 7, 0.78, true);      // strawberry
const FRECKLES = scatter(11, 21, 0.74, true);  // pear
const PEBBLES = scatter(22, 33, 0.82, true);   // dekopon
const NET = (() => {                            // melon netting: static polylines
  const rnd = lcg(51);
  const lines = [];
  for (let i = 0; i < 7; i++) {
    const y = -0.72 + (i / 6) * 1.44;
    const pts = [];
    for (let k = 0; k <= 5; k++) {
      const x = -0.92 + (k / 5) * 1.84;
      pts.push({ x, y: y + (rnd() - 0.5) * 0.16 });
    }
    lines.push(pts);
  }
  return lines;
})();

// ── gradient cache ─────────────────────────────────────────────────────────
// Keyed by context, then by level+radius. The painter always works at the
// origin with a known radius, so a cached gradient stays valid across frames
// no matter how the caller has translated, scaled or squashed the context.

const gradients = new WeakMap();

function cached(ctx, key, make) {
  let byKey = gradients.get(ctx);
  if (!byKey) { byKey = new Map(); gradients.set(ctx, byKey); }
  let grad = byKey.get(key);
  if (grad === undefined) { grad = make(); byKey.set(key, grad); }
  return grad;
}

function bodyFill(ctx, level, r) {
  const f = FRUITS[level - 1];
  return cached(ctx, `b${level}:${r}`, () => {
    // light from the upper left, rind darkening at the far edge — one gradient
    // does the work of a highlight, a shadow and a rim in a single fill
    const g = ctx.createRadialGradient(-r * 0.34, -r * 0.38, r * 0.06, 0, 0, r * 1.06);
    g.addColorStop(0, mix(f.color, '#ffffff', level === 3 ? 0.14 : 0.3));
    g.addColorStop(0.55, f.color);
    g.addColorStop(1, f.rind);
    return g;
  });
}

// Peach only: the two-tone blush, pink shoulder into cream belly.
function peachFill(ctx, r) {
  const f = FRUITS[7];
  return cached(ctx, `peach:${r}`, () => {
    const g = ctx.createLinearGradient(-r * 0.4, -r, r * 0.3, r);
    g.addColorStop(0, f.rind);
    g.addColorStop(0.45, f.color);
    g.addColorStop(1, f.accent);
    return g;
  });
}

/** #rrggbb toward #rrggbb by t. Cheap, and only ever called on cache misses. */
function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh) => {
    const v = Math.round((((pa >> sh) & 255) * (1 - t)) + (((pb >> sh) & 255) * t));
    return v.toString(16).padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

// ── silhouettes ────────────────────────────────────────────────────────────
// Physics bodies are always circles; these are drawing only, and every one
// stays inside 1.1× r so a contact never looks like it happened in mid-air.

function bodyPath(ctx, level, r) {
  ctx.beginPath();
  if (level === 2) {
    // strawberry: broad shoulders tapering to a rounded point, ~5% tall
    ctx.moveTo(0, r * 1.05);
    ctx.bezierCurveTo(-r * 0.78, r * 0.74, -r * 1.00, r * 0.04, -r * 0.72, -r * 0.55);
    ctx.bezierCurveTo(-r * 0.45, -r * 1.00, r * 0.45, -r * 1.00, r * 0.72, -r * 0.55);
    ctx.bezierCurveTo(r * 1.00, r * 0.04, r * 0.78, r * 0.74, 0, r * 1.05);
  } else if (level === 5) {
    // persimmon: squat, ~8% wider than tall
    ctx.ellipse(0, 0, r * 1.06, r * 0.94, 0, 0, Math.PI * 2);
  } else if (level === 7) {
    // pear: egg — the top narrowed ~15%, weight carried low
    ctx.moveTo(0, r * 1.00);
    ctx.bezierCurveTo(-r * 1.00, r * 1.00, -r * 1.05, r * 0.10, -r * 0.62, -r * 0.62);
    ctx.bezierCurveTo(-r * 0.42, -r * 1.02, r * 0.42, -r * 1.02, r * 0.62, -r * 0.62);
    ctx.bezierCurveTo(r * 1.05, r * 0.10, r * 1.00, r * 1.00, 0, r * 1.00);
  } else {
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
  ctx.closePath();
}

// ── textures (drawn clipped to the silhouette) ─────────────────────────────

function texture(ctx, level, r) {
  const f = FRUITS[level - 1];
  if (level === 2) {                                  // strawberry seeds
    ctx.fillStyle = f.accent;
    for (const p of SEEDS) {
      ctx.beginPath();
      ctx.ellipse(p.x * r, p.y * r, r * 0.045 * p.s, r * 0.07 * p.s, p.x * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (level === 4) {                           // dekopon pebbling
    ctx.fillStyle = f.accent;
    ctx.globalAlpha = 0.5;
    for (const p of PEBBLES) {
      ctx.beginPath();
      ctx.arc(p.x * r, p.y * r, r * 0.035 * p.s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (level === 7) {                           // pear freckles
    ctx.fillStyle = f.accent;
    ctx.globalAlpha = 0.55;
    for (const p of FRECKLES) {
      ctx.beginPath();
      ctx.arc(p.x * r, p.y * r, r * 0.028 * p.s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (level === 8) {                           // peach cleft
    ctx.strokeStyle = f.rind;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.beginPath();
    ctx.moveTo(-r * 0.06, -r * 0.98);
    ctx.quadraticCurveTo(r * 0.16, 0, -r * 0.04, r * 0.98);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (level === 9) {                           // pineapple diamonds
    ctx.strokeStyle = f.accent;
    ctx.lineWidth = Math.max(1, r * 0.035);
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath(); ctx.moveTo(-r, i * r * 0.36 - r * 0.28); ctx.lineTo(r, i * r * 0.36 + r * 0.28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r, i * r * 0.36 + r * 0.28); ctx.lineTo(r, i * r * 0.36 - r * 0.28); ctx.stroke();
    }
    ctx.fillStyle = f.accent;                          // node dots at the crossings
    for (let i = -2; i <= 2; i++) {
      for (let k = -2; k <= 2; k++) {
        const x = k * r * 0.39, y = i * r * 0.36;
        if (x * x + y * y > r * r * 0.72) continue;
        ctx.beginPath(); ctx.arc(x, y, r * 0.035, 0, Math.PI * 2); ctx.fill();
      }
    }
  } else if (level === 10) {                          // melon netting
    ctx.strokeStyle = f.accent;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(1, r * 0.03);
    for (const line of NET) {
      ctx.beginPath();
      ctx.moveTo(line[0].x * r, line[0].y * r);
      for (let k = 1; k < line.length; k++) ctx.lineTo(line[k].x * r, line[k].y * r);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (level === 11) {                          // watermelon stripes
    ctx.strokeStyle = f.accent;
    for (let i = -2; i <= 2; i++) {
      ctx.lineWidth = r * (i === 0 ? 0.15 : Math.abs(i) === 1 ? 0.12 : 0.08);
      ctx.beginPath();
      ctx.moveTo(i * r * 0.38, -r * 0.95);
      ctx.quadraticCurveTo(i * r * 0.58, 0, i * r * 0.38, r * 0.95);
      ctx.stroke();
    }
  }
}

// ── accessories (outside the silhouette, rotate with the body) ─────────────

function stem(ctx, r, color, len, lean, thick) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, r * thick);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.9);
  ctx.quadraticCurveTo(lean * r * 0.5, -r * (0.9 + len * 0.5), lean * r, -r * (0.9 + len));
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function leaf(ctx, r, color, x, y, w, h, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(w * 0.5, -h * 0.6, w, 0);
  ctx.quadraticCurveTo(w * 0.5, h * 0.6, 0, 0);
  ctx.fill();
  ctx.restore();
}

// Accessories that emerge from BEHIND the body — stems, crowns, cluster bumps.
// Drawn first, so the silhouette clips their roots and only the part that
// should stick out does.
function accessoryBehind(ctx, level, r) {
  const f = FRUITS[level - 1];
  switch (level) {
    case 1:                                            // cherry: stem + tiny leaf
      stem(ctx, r, f.leaf, 0.32, 0.2, 0.1);
      leaf(ctx, r, f.leaf, r * 0.14, -r * 1.05, r * 0.3, r * 0.22, -0.6);
      break;
    case 3:                                            // grape: cluster bumps + tendril
      ctx.fillStyle = f.rind;
      for (const [ax, ay, ar] of [[-0.62, -0.62, 0.3], [-0.02, -0.86, 0.26], [-0.92, -0.16, 0.24]]) {
        ctx.beginPath(); ctx.arc(ax * r, ay * r, ar * r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = f.leaf;
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.beginPath();
      ctx.moveTo(-r * 0.02, -r * 1.02);
      ctx.bezierCurveTo(r * 0.24, -r * 1.16, -r * 0.2, -r * 1.2, r * 0.04, -r * 1.26);
      ctx.stroke();
      break;
    case 4:                                            // dekopon: the signature knob
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(-r * 0.1, -r * 0.92, r * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = f.rind;
      ctx.lineWidth = Math.max(1, r * 0.05);
      ctx.stroke();
      leaf(ctx, r, f.leaf, r * 0.1, -r * 1.0, r * 0.42, r * 0.26, -0.35);
      break;
    case 6:                                            // apple: stem + leaf
      stem(ctx, r, f.accent, 0.35, 0.1, 0.09);
      leaf(ctx, r, f.leaf, r * 0.08, -r * 1.04, r * 0.38, r * 0.28, -0.42);
      break;
    case 7:                                            // pear: short stem
      stem(ctx, r, f.accent, 0.28, 0.12, 0.08);
      break;
    case 8:                                            // peach: leaf pair at the divot
      leaf(ctx, r, f.leaf, -r * 0.06, -r * 0.94, r * 0.42, r * 0.26, -0.75);
      leaf(ctx, r, f.leaf, r * 0.02, -r * 0.94, r * 0.4, r * 0.24, -2.5);
      break;
    case 9: {                                          // pineapple: spiky crown
      ctx.fillStyle = f.leaf;
      const spikes = 7;
      for (let i = 0; i < spikes; i++) {
        const t = (i / (spikes - 1)) - 0.5;             // −0.5 … 0.5
        const bx = t * r * 0.7;
        const h = r * (0.4 - Math.abs(t) * 0.3);
        ctx.beginPath();
        ctx.moveTo(bx - r * 0.09, -r * 0.86);
        ctx.lineTo(bx + t * r * 0.55, -r * 0.86 - h);
        ctx.lineTo(bx + r * 0.09, -r * 0.86);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 10:                                           // melon: short T-stem
      stem(ctx, r, f.rind, 0.22, 0, 0.09);
      ctx.strokeStyle = f.rind;
      ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.beginPath();
      ctx.moveTo(-r * 0.18, -r * 1.12);
      ctx.lineTo(r * 0.18, -r * 1.12);
      ctx.stroke();
      break;
    case 11:                                           // watermelon: curly stem
      ctx.strokeStyle = f.leaf;
      ctx.lineWidth = Math.max(1.2, r * 0.075);
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.96);
      ctx.bezierCurveTo(r * 0.22, -r * 1.08, -r * 0.16, -r * 1.16, r * 0.1, -r * 1.24);
      ctx.stroke();
      break;
  }
}

// Accessories that sit ON the body: the two calyxes, which in life are papery
// caps lying over the fruit's shoulders rather than things poking out of it.
function accessoryFront(ctx, level, r) {
  const f = FRUITS[level - 1];
  if (level === 2) {                                   // strawberry crown
    for (let i = -2; i <= 2; i++) {
      leaf(ctx, r, f.leaf, 0, -r * 0.82, r * 0.6, r * 0.3, Math.PI / 2 + i * 0.62);
    }
    stem(ctx, r, f.leaf, 0.22, 0, 0.09);
  } else if (level === 5) {                            // persimmon four-lobed calyx
    for (let i = 0; i < 4; i++) {
      leaf(ctx, r, f.leaf, 0, -r * 0.76, r * 0.58, r * 0.3, Math.PI / 2 + (i - 1.5) * 0.85);
    }
    stem(ctx, r, mix(f.leaf, '#000000', 0.35), 0.2, 0, 0.11);
  }
}

// ── face ───────────────────────────────────────────────────────────────────

// A lidded eye is the disc below its lid line: for lid ∈ [0,1] that line sits
// at y = −e(1−2·lid), and the disc below it is exactly the arc sweep [φ, π−φ]
// with sin φ = −(1−2·lid). lid = 0 gives the whole circle back, so open and
// sleepy eyes share one code path.
//
// The lid is a downward BOW, not a straight chord. A chord was tried first: at
// gameplay eye sizes the flat top fuses into a hard dark bar and every sleepy
// fruit looked like it was scowling. A drooping curve reads as heavy-lidded.
function lidEye(ctx, cx, cy, e, lid) {
  const phi = Math.asin(Math.max(-1, Math.min(1, 2 * lid - 1)));
  ctx.beginPath();
  ctx.arc(cx, cy, e, phi, Math.PI - phi);
  if (lid > 0) {
    const y = cy + e * Math.sin(phi), x = e * Math.cos(phi);
    ctx.quadraticCurveTo(cx, y + e * lid * 0.9, cx + x, y);
  } else {
    ctx.closePath();
  }
  ctx.fill();
}

function paintFace(ctx, level, r, expression) {
  const f = FRUITS[level - 1];
  const p = FACES[level - 1];
  const fr = r * 0.5;
  const e = Math.max(1.1, fr * p.eye);
  const ex = fr * p.gap;
  const ey = fr * p.eyeY;
  const line = Math.max(1, fr * 0.09);

  // blush first — it sits under the features
  if (p.blush > 0) {
    ctx.fillStyle = 'rgba(255,120,120,0.32)';
    ctx.beginPath(); ctx.ellipse(-ex - e * 1.5, ey + fr * 0.42, fr * p.blush, fr * p.blush * 0.72, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(ex + e * 1.5, ey + fr * 0.42, fr * p.blush, fr * p.blush * 0.72, 0, 0, Math.PI * 2); ctx.fill();
  }

  ctx.fillStyle = f.face;
  ctx.strokeStyle = f.face;
  ctx.lineWidth = line;
  ctx.lineCap = 'round';

  if (expression === 'blink') {
    // two short downward curves — a shut eye, not a dash
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * ex - e, ey);
      ctx.quadraticCurveTo(s * ex, ey + e * 0.9, s * ex + e, ey);
      ctx.stroke();
    }
  } else if (expression === 'happy') {
    // >◡< — squint arcs bowing upward
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * ex - e, ey + e * 0.45);
      ctx.quadraticCurveTo(s * ex, ey - e * 1.05, s * ex + e, ey + e * 0.45);
      ctx.stroke();
    }
  } else if (expression === 'worried') {
    // wide open, and raised inner brows
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * ex, ey, e * 1.35, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * (ex + e * 1.3), ey - e * 1.9);
      ctx.lineTo(s * (ex - e * 0.5), ey - e * 2.7);
      ctx.stroke();
    }
  } else {
    // The chord alone carries the lid. An added lash stroke was tried and
    // dropped: at eye sizes this small it fuses with the chord into one solid
    // bar, and a flat dark bar reads as scowling, not sleepy.
    lidEye(ctx, -ex, ey, e, p.lid);
    lidEye(ctx, ex, ey, e, p.lid);
  }

  // mouth
  ctx.beginPath();
  if (expression === 'worried') {
    ctx.arc(0, fr * (p.mouthY + 0.4), fr * p.mouth * 0.85, 1.15 * Math.PI, 1.85 * Math.PI);
  } else if (expression === 'happy') {
    ctx.arc(0, fr * p.mouthY, fr * p.mouth * 1.2, 0.06 * Math.PI, 0.94 * Math.PI);
  } else {
    ctx.arc(0, fr * p.mouthY, fr * p.mouth, 0.15 * Math.PI, 0.85 * Math.PI);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
}

// ── the painter ────────────────────────────────────────────────────────────

/**
 * Paint one fruit centred on the context's current origin.
 *
 * The caller owns position and any pop/squash transform; this draws in local
 * space so the same code serves the board, the 48px preview and the menu chips.
 *
 * opts: { angle = 0, expression = 'neutral' }
 */
export function paintFruit(ctx, level, r, opts) {
  const f = FRUITS[level - 1];
  const angle = (opts && opts.angle) || 0;
  const expression = (opts && opts.expression) || 'neutral';

  // body + texture + accessories: ride the roll
  ctx.save();
  ctx.rotate(angle);

  accessoryBehind(ctx, level, r);            // roots hidden by the silhouette

  bodyPath(ctx, level, r);
  ctx.fillStyle = level === 8 ? peachFill(ctx, r) : bodyFill(ctx, level, r);
  ctx.fill();

  ctx.save();                                 // texture never spills past the rind
  ctx.clip();
  texture(ctx, level, r);
  ctx.restore();

  bodyPath(ctx, level, r);
  ctx.strokeStyle = f.rind;
  ctx.lineWidth = Math.max(1.2, r * 0.055);
  ctx.stroke();

  // gloss: a soft primary and, on the cherry, the second dot that hints at a twin
  ctx.fillStyle = level === 3 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.36, -r * 0.42, r * 0.24, r * 0.15, -0.6, 0, Math.PI * 2);
  ctx.fill();
  if (level === 1) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.12, -r * 0.6, r * 0.09, r * 0.06, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  accessoryFront(ctx, level, r);
  ctx.restore();

  // face: upright, whatever the body is doing
  ctx.save();
  paintFace(ctx, level, r, expression);
  ctx.restore();
}

/**
 * Which face a body wears this frame. worried > happy > blink > neutral.
 *
 * Blinking is derived from the body id and the clock rather than stored, so it
 * costs no state, survives a reload, and no two fruit blink in lockstep.
 */
export function expressionFor(body, tMs, reducedMotion) {
  if (body.overSince != null) return 'worried';
  if (body.bornAt != null && tMs - body.bornAt < ART.happyMs) return 'happy';
  if (reducedMotion) return 'neutral';
  return isBlinking(body.id, tMs) ? 'blink' : 'neutral';
}

function isBlinking(id, tMs) {
  const h = hash32(id);
  const period = ART.blinkMinMs + (h % ART.blinkVarMs);
  return (tMs + (h % period)) % period < ART.blinkMs;
}

// 32-bit integer mix (Wang hash). Small ids must scatter, or low-numbered
// fruit would share a blink phase.
function hash32(n) {
  let x = (n | 0) >>> 0;
  x = (x ^ 61) ^ (x >>> 16);
  x = (x + (x << 3)) >>> 0;
  x = x ^ (x >>> 4);
  x = Math.imul(x, 0x27d4eb2d) >>> 0;
  return (x ^ (x >>> 15)) >>> 0;
}

export { hash32 };

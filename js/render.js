// Canvas renderer for shuǐguǒ — cute fruits with kawaii faces in an open box.
// Pure drawing; reads game state, never mutates it. Honors the launcher
// settings snapshot it is handed ({ theme, fontScale, reducedMotion }).
//
// Ephemeral juice (merge pops, droplets, score floats, landing squash) lives
// in the host-owned effects list from js/effects.js and is read here through
// closed-form helpers — nothing in this file mutates it either.

import { WORLD, FRUITS, RULES, radiusOf } from './constants.js';
import { inDanger } from './game.js';
import { dropletAt, floatAt, popScale, squashAmount } from './effects.js';

const THEMES = {
  light: {
    bg: '#f7f1e3', wall: '#c9a97a', wallEdge: '#a9835a', floor: '#c9a97a',
    deadline: '#d23c50', text: '#5a4632', guide: 'rgba(90,70,50,0.25)',
    ghost: 'rgba(90,70,50,0.35)',
  },
  dark: {
    bg: '#221d16', wall: '#6b543a', wallEdge: '#8a7050', floor: '#6b543a',
    deadline: '#ef6478', text: '#e8dcc8', guide: 'rgba(232,220,200,0.25)',
    ghost: 'rgba(232,220,200,0.35)',
  },
};

const EMPTY_FX = { droplets: [], floats: [], pops: new Map(), squashes: new Map() };

// The pile shivers over the last second before the line claims it.
const TREMBLE_MS = 1000;
const TREMBLE_MAX = 1;          // world units — deliberately barely-there

export function makeRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let scale = 1, offX = 0, offY = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const sx = canvas.width / WORLD.width;
    const sy = canvas.height / WORLD.height;
    scale = Math.min(sx, sy);
    offX = (canvas.width - WORLD.width * scale) / 2;
    offY = (canvas.height - WORLD.height * scale) / 2;
  }

  // canvas-space x for a world x (used by input to invert)
  function toWorldX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    return ((clientX - rect.left) * dpr - offX) / scale;
  }

  function draw(g, settings, tMs, fx = EMPTY_FX) {
    const th = THEMES[settings.theme === 'dark' ? 'dark' : 'light'];
    const motion = settings.reducedMotion ? 0 : 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offX, offY);

    drawBox(th);
    drawDeadline(g, th, tMs, motion);
    if (g.state === 'playing') drawGhost(g, th);

    // the pile — trembles as a whole once the line is about to claim it
    const overMs = worstOverMs(g, tMs);
    const shake = motion ? TREMBLE_MAX * clamp01((overMs - (RULES.overLineMs - TREMBLE_MS)) / TREMBLE_MS) : 0;
    ctx.save();
    if (shake > 0) ctx.translate(Math.sin(tMs / 37) * shake, Math.cos(tMs / 29) * shake);
    for (const b of g.bodies) {
      const born = fx.pops.get(b.id);
      const sq = fx.squashes.get(b.id);
      drawFruit(b.level, b.x, b.y, b.r, b.angle, motion, {
        scale: born != null ? popScale(born, tMs) : 1,
        squash: sq ? squashAmount(sq, tMs) : 0,
        worried: b.overSince != null,
      });
    }
    ctx.restore();

    drawDroplets(fx, tMs);
    drawFloats(fx, tMs, th, settings);

    // dropper: held fruit + aim guide
    if (g.state === 'playing') {
      const r = radiusOf(g.current);
      ctx.strokeStyle = th.guide;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(g.dropX, WORLD.dropperY + r);
      ctx.lineTo(g.dropX, WORLD.floorY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = heldAlpha(g, tMs);
      drawFruit(g.current, g.dropX, WORLD.dropperY, r, 0, motion);
      ctx.globalAlpha = 1;
    }

    drawVignette(overMs);
  }

  // The held fruit dims while input is locked and eases back in over the last
  // stretch of the cooldown — the cooldown's only UI, and it wants to read as
  // "almost ready" rather than a hard on/off blink.
  function heldAlpha(g, tMs) {
    if (g.canDrop || g.lockedAt == null) return 1;
    const left = RULES.dropCooldownMs - (tMs - g.lockedAt);
    if (left > 100) return 0.45;
    return 0.45 + 0.55 * clamp01((100 - left) / 100);
  }

  function drawBox(th) {
    const w = 10;
    ctx.fillStyle = th.wall;
    ctx.fillRect(-w, WORLD.deadlineY - 20, w, WORLD.floorY - WORLD.deadlineY + 20 + w);
    ctx.fillRect(WORLD.width, WORLD.deadlineY - 20, w, WORLD.floorY - WORLD.deadlineY + 20 + w);
    ctx.fillStyle = th.floor;
    ctx.fillRect(-w, WORLD.floorY, WORLD.width + 2 * w, w);
    ctx.strokeStyle = th.wallEdge;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-w, WORLD.deadlineY - 20, WORLD.width + 2 * w, WORLD.floorY - WORLD.deadlineY + 20 + w);
  }

  function drawDeadline(g, th, tMs, motion) {
    const danger = g.state === 'playing' && inDanger(g);
    // pulses when a fruit is over the line; steady strong when reduced motion
    const pulse = danger ? (motion ? 0.55 + 0.45 * Math.sin(tMs / 120) : 1) : 0.5;
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = th.deadline;
    ctx.lineWidth = danger ? 3 : 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(0, WORLD.deadlineY);
    ctx.lineTo(WORLD.width, WORLD.deadlineY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Where the held fruit would first touch down. Honest but simple: it finds
  // the highest contact in the drop column, not where the fruit finally rolls
  // to rest. Pure geometry against the current board — no simulation.
  function drawGhost(g, th) {
    const r = radiusOf(g.current);
    let restY = WORLD.floorY - r;
    for (const b of g.bodies) {
      const dx = Math.abs(b.x - g.dropX);
      const rs = r + b.r;
      if (dx >= rs) continue;
      restY = Math.min(restY, b.y - Math.sqrt(rs * rs - dx * dx));
    }
    if (restY < WORLD.dropperY + r) return;   // column already full to the top
    ctx.strokeStyle = th.ghost;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(g.dropX, restY, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawDroplets(fx, tMs) {
    for (const p of fx.droplets) {
      const s = dropletAt(p, tMs);
      if (s.alpha <= 0) continue;
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFloats(fx, tMs, th, settings) {
    if (!fx.floats.length) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of fx.floats) {
      const s = floatAt(f, tMs, !!settings.reducedMotion);
      if (s.alpha <= 0) continue;
      const size = 15 * f.scale * (settings.fontScale || 1);
      ctx.font = `${f.bold ? '800' : '700'} ${size}px system-ui, sans-serif`;
      ctx.globalAlpha = s.alpha;
      ctx.lineWidth = Math.max(2, size * 0.16);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.strokeText(f.text, s.x, s.y);
      ctx.fillStyle = f.color || th.text;
      ctx.fillText(f.text, s.x, s.y);
    }
    ctx.globalAlpha = 1;
  }

  // Red creeps in from the edges as the deadline clock runs down. A fade, not
  // a motion effect, so it stays on under reduced motion.
  function drawVignette(overMs) {
    if (overMs <= 0) return;
    const a = 0.42 * clamp01(overMs / RULES.overLineMs);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const outer = Math.hypot(cx, cy);
    const grad = ctx.createRadialGradient(cx, cy, outer * 0.45, cx, cy, outer);
    grad.addColorStop(0, 'rgba(210,60,80,0)');
    grad.addColorStop(1, `rgba(210,60,80,${a})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawFruit(level, x, y, r, angle, motion, opts) {
    const f = FRUITS[level - 1];
    const pop = opts && opts.scale ? opts.scale : 1;
    const e = opts ? (opts.squash || 0) : 0;
    ctx.save();
    ctx.translate(x, y);
    // Squash is applied in world-vertical, before the roll, so a landing
    // flattens against the floor rather than against the fruit's own spin.
    // The pre-translate anchors it to the fruit's BOTTOM edge — scaling about
    // the centre would lift a squashed fruit off the very floor it just hit.
    if (e !== 0) {
      ctx.translate(0, r * e);
      ctx.scale(1 + e * 0.8, 1 - e);
    }
    if (pop !== 1) ctx.scale(pop, pop);
    ctx.rotate(motion ? angle : 0);

    // body
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = f.rind;
    ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.stroke();

    // watermelon stripes / pineapple crosshatch — tiny identity touches
    if (level === 11) {
      ctx.strokeStyle = f.rind;
      ctx.lineWidth = r * 0.12;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.38, -r * 0.9);
        ctx.quadraticCurveTo(i * r * 0.55, 0, i * r * 0.38, r * 0.9);
        ctx.stroke();
      }
    } else if (level === 9) {
      ctx.strokeStyle = f.rind;
      ctx.lineWidth = r * 0.04;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(-r, i * r * 0.4 - r * 0.2); ctx.lineTo(r, i * r * 0.4 + r * 0.2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-r, i * r * 0.4 + r * 0.2); ctx.lineTo(r, i * r * 0.4 - r * 0.2); ctx.stroke();
      }
    }

    // highlight
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, -r * 0.4, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2);
    ctx.fill();

    // kawaii face — scales with the fruit. Over the line, the eyes go wide and
    // the smile flips: a placeholder for WP2's real expression system.
    const worried = !!(opts && opts.worried);
    const fr = r * 0.5;
    const eye = Math.max(1.2, fr * (worried ? 0.2 : 0.13));
    ctx.fillStyle = f.face;
    ctx.beginPath(); ctx.arc(-fr * 0.5, -fr * 0.15, eye, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(fr * 0.5, -fr * 0.15, eye, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = f.face;
    ctx.lineWidth = Math.max(1, fr * 0.09);
    ctx.beginPath();
    if (worried) ctx.arc(0, fr * 0.55, fr * 0.3, 1.15 * Math.PI, 1.85 * Math.PI);
    else ctx.arc(0, fr * 0.15, fr * 0.3, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    // blush
    ctx.fillStyle = 'rgba(255,120,120,0.35)';
    ctx.beginPath(); ctx.arc(-fr * 0.85, fr * 0.15, fr * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(fr * 0.85, fr * 0.15, fr * 0.18, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  return { resize, draw, toWorldX, drawFruit };
}

// Longest continuous time any fruit has spent over the line, in ms.
function worstOverMs(g, tMs) {
  let worst = 0;
  for (const b of g.bodies) {
    if (b.overSince == null) continue;
    worst = Math.max(worst, tMs - b.overSince);
  }
  return worst;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

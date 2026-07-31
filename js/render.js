// Canvas renderer for shuǐ guǒ tān — the fruit stall and everything in it.
// Pure drawing; reads game state, never mutates it. Honors the launcher
// settings snapshot it is handed ({ theme, fontScale, reducedMotion }).
//
// This file is now composition, not artwork. The fruit come from
// js/fruit-art.js (the single painter shared with the NEXT preview and the
// menu chart) and the stall from js/scene.js; what lives here is the draw
// ORDER, the world↔canvas transform, and the game-state readings that pick a
// fruit's expression and the danger feedback.
//
// Ephemeral juice (merge pops, droplets, score floats, landing squash) lives
// in the host-owned effects list from js/effects.js and is read here through
// closed-form helpers — nothing in this file mutates it either.

import { WORLD, RULES, radiusOf } from './constants.js';
import { inDanger } from './game.js';
import { dropletAt, floatAt, popScale, squashAmount } from './effects.js';
import { paintFruit, expressionFor } from './fruit-art.js';
import {
  SCENE, themeOf, paintSky, paintSkyline, paintStall, paintAwning, paintLanterns, paintLeaf,
} from './scene.js';

const EMPTY_FX = { droplets: [], floats: [], pops: new Map(), squashes: new Map() };

// A held fruit whose radius reaches the dropper's own height would be drawn
// crossing the deadline before it was dropped. See drawHeld().
const CRATED_R = WORLD.dropperY;

// The pile shivers over the last second before the line claims it.
const TREMBLE_MS = 1000;
const TREMBLE_MAX = 1;          // world units — deliberately barely-there

export function makeRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let scale = 1, offX = 0, offY = 0;

  // The view is fitted to the world PLUS the stall's side planks, which live
  // just outside it (x < 0 and x > WORLD.width). Fitting the bare world hid
  // them on any viewport where width is the binding dimension — which is every
  // phone in portrait, i.e. the way the game is actually played.
  const VIEW_W = WORLD.width + 2 * SCENE.wall;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    scale = Math.min(canvas.width / VIEW_W, canvas.height / WORLD.height);
    offX = (canvas.width - VIEW_W * scale) / 2 + SCENE.wall * scale;
    offY = (canvas.height - WORLD.height * scale) / 2;
  }

  // canvas-space x for a world x (used by input to invert)
  function toWorldX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    return ((clientX - rect.left) * dpr - offX) / scale;
  }

  function draw(g, settings, tMs, fx = EMPTY_FX) {
    const th = themeOf(settings);
    const motion = settings.reducedMotion ? 0 : 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    paintSky(ctx, th, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offX, offY);

    // the world, back to front: far rooftops, the stall itself, the canopy and
    // its lanterns, then one drifting leaf — all of it behind every fruit.
    paintSkyline(ctx, th);
    paintStall(ctx, th);
    paintAwning(ctx, th);
    paintLanterns(ctx, th, tMs, motion);
    paintLeaf(ctx, th, tMs, motion);

    drawDeadline(g, th, tMs, motion);
    if (g.state === 'playing' && g.current != null) drawGhost(g, th);

    // the pile — trembles as a whole once the line is about to claim it
    const overMs = worstOverMs(g, tMs);
    const shake = motion ? TREMBLE_MAX * clamp01((overMs - (RULES.overLineMs - TREMBLE_MS)) / TREMBLE_MS) : 0;
    ctx.save();
    if (shake > 0) ctx.translate(Math.sin(tMs / 37) * shake, Math.cos(tMs / 29) * shake);
    for (const b of g.bodies) {
      const born = fx.pops.get(b.id);
      const sq = fx.squashes.get(b.id);
      drawBody(b, tMs, motion, settings.reducedMotion, {
        scale: born != null ? popScale(born, tMs) : 1,
        squash: sq ? squashAmount(sq, tMs) : 0,
      });
    }
    ctx.restore();

    drawDroplets(fx, tMs);
    drawFloats(fx, tMs, th, settings);

    // dropper: held fruit + aim guide. `current` is null in a campaign run
    // whose crate has run out — the dropper simply isn't there any more.
    if (g.state === 'playing' && g.current != null) {
      const r = radiusOf(g.current);
      ctx.strokeStyle = th.guide;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(g.dropX, WORLD.dropperY + Math.min(r, CRATED_R));
      ctx.lineTo(g.dropX, WORLD.floorY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = heldAlpha(g, tMs);
      drawHeld(th, g.current, r, g.dropX);
      ctx.globalAlpha = 1;
    }

    drawVignette(overMs);
  }

  // One body: the caller's pop/squash transform, then the shared painter.
  // Squash is applied in world-vertical, BEFORE the roll, so a landing
  // flattens against the floor rather than against the fruit's own spin. The
  // pre-translate anchors it to the fruit's bottom edge — scaling about the
  // centre would lift a squashed fruit off the very floor it just hit.
  function drawBody(b, tMs, motion, reducedMotion, t) {
    ctx.save();
    ctx.translate(b.x, b.y);
    const e = t.squash || 0;
    if (e !== 0) {
      ctx.translate(0, b.r * e);
      ctx.scale(1 + e * 0.8, 1 - e);
    }
    if (t.scale !== 1) ctx.scale(t.scale, t.scale);
    paintFruit(ctx, b.level, b.r, {
      angle: motion ? b.angle : 0,
      expression: expressionFor(b, tMs, !motion),
    });
    ctx.restore();
  }

  // The held fruit, at the size the dropper zone can actually hold it.
  //
  // A watermelon is 90 world units across and the dropper hangs 52 above the
  // floor of the danger zone, so anything from a pear up would be drawn ACROSS
  // the deadline while merely being held — the board would look lost before the
  // player had done anything. Big fruit are therefore drawn CRATED: scaled to
  // fit, over a true-size dashed ring so the player can still read how much
  // board the thing is about to take. Physics spawns it at its real size.
  //
  // Free play can never reach this: MAX_SPAWN_LEVEL is 5, whose radius is 39.
  // Only a campaign crate carries fruit this big to a stall.
  function drawHeld(th, level, r, x) {
    const crated = r >= CRATED_R;
    if (crated) {
      ctx.save();
      ctx.strokeStyle = th.ghost;
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, WORLD.dropperY, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(x, WORLD.dropperY);
    if (crated) ctx.scale(CRATED_R / r, CRATED_R / r);
    paintFruit(ctx, level, r);
    ctx.restore();
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

  return { resize, draw, toWorldX };
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

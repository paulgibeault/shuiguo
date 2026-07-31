// Canvas renderer for shuǐguǒ — cute fruits with kawaii faces in an open box.
// Pure drawing; reads game state, never mutates it. Honors the launcher
// settings snapshot it is handed ({ theme, fontScale, reducedMotion }).

import { WORLD, FRUITS, radiusOf } from './constants.js';
import { inDanger } from './game.js';

const THEMES = {
  light: {
    bg: '#f7f1e3', wall: '#c9a97a', wallEdge: '#a9835a', floor: '#c9a97a',
    deadline: '#d23c50', text: '#5a4632', guide: 'rgba(90,70,50,0.25)',
  },
  dark: {
    bg: '#221d16', wall: '#6b543a', wallEdge: '#8a7050', floor: '#6b543a',
    deadline: '#ef6478', text: '#e8dcc8', guide: 'rgba(232,220,200,0.25)',
  },
};

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

  function draw(g, settings, tMs) {
    const th = THEMES[settings.theme === 'dark' ? 'dark' : 'light'];
    const motion = settings.reducedMotion ? 0 : 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offX, offY);

    drawBox(th);
    drawDeadline(g, th, tMs, motion);

    for (const b of g.bodies) drawFruit(b.level, b.x, b.y, b.r, b.angle, motion);

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
      ctx.globalAlpha = g.canDrop ? 1 : 0.45;
      drawFruit(g.current, g.dropX, WORLD.dropperY, r, 0, motion);
      ctx.globalAlpha = 1;
    }
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

  function drawFruit(level, x, y, r, angle, motion) {
    const f = FRUITS[level - 1];
    ctx.save();
    ctx.translate(x, y);
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

    // kawaii face — scales with the fruit
    const fr = r * 0.5;
    ctx.fillStyle = f.face;
    ctx.beginPath(); ctx.arc(-fr * 0.5, -fr * 0.15, Math.max(1.2, fr * 0.13), 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(fr * 0.5, -fr * 0.15, Math.max(1.2, fr * 0.13), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = f.face;
    ctx.lineWidth = Math.max(1, fr * 0.09);
    ctx.beginPath(); ctx.arc(0, fr * 0.15, fr * 0.3, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    // blush
    ctx.fillStyle = 'rgba(255,120,120,0.35)';
    ctx.beginPath(); ctx.arc(-fr * 0.85, fr * 0.15, fr * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(fr * 0.85, fr * 0.15, fr * 0.18, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  return { resize, draw, toWorldX, drawFruit };
}

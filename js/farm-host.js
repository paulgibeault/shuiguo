// The farm screen: the mountainside on the canvas, the drawers over it, and the
// one tap that does whatever a tile needs doing.
//
// Host, not logic. Every rule it enforces is asked of js/farm.js, js/terrain.js,
// js/campaign.js, js/rank.js or js/economy.js — this file owns DOM, canvas,
// input and the Arcade calls, and nothing here decides what anything costs,
// how fast anything grows, or where anything may stand.
//
// THE ONE-TAP RULE. Tapping a tile does the obvious thing outright: a ripe crop
// is harvested, a thirsty one is watered. Only a tile with a CHOICE to make
// (bare earth, or a plant you might move, dig up or feed) opens a drawer.
//
// THE MOUNTAIN SCROLLS. Ten shelves do not fit a phone, so the canvas is a
// window onto a tall world: drag (or wheel) to move it, and a press that does
// not travel is a tap. The camera is session state — it is not saved, and a
// fresh visit frames the highest shelf you own with the next one above it.
//
// MOVING THINGS. Any plant or structure can be picked up and set down anywhere
// it fits, keeping everything it had grown. While something is being moved the
// farm shows, on every tile, how well it would do there (js/terrain.js) — the
// stars ARE the explanation of why the mountain is not six identical shelves.
//
// EVALUATE ON LOOK. There are no timers. Every read of the farm brings it up to
// date against wall time first, which is what makes closing the app for a week
// cost nothing and why this file never schedules anything but its own repaint.

import { WORLD, TUNING, FRUITS, MAX_LEVEL, STRUCTURES, STRUCTURE_KINDS, isStructure, spanOf } from './constants.js';
import {
  evaluateFarm, eachPlot, plotAt, isRipe, isPlant, progressOf, needsWater,
  msUntilNextRipe, msUntilRipeAt, soonestRipening, anchorFor,
  plant, placeStructure, water, harvest, fertilize, dig, move,
  addTerrace, nextTerraceIndex, installSprinkler, installIrrigation,
} from './farm.js';
import {
  fitOf, gradeInfo, likesOf, moistureAt, moistureFor, altitudeOf,
  ALTITUDE_NAMES, MOISTURE_NAMES,
} from './terrain.js';
import {
  spend, seedCount, takeSeed, addSeeds, harvestInto, crateSize,
  buyFarm, canBuyFarm, canGoToMarket, couldUseAHand,
  rankOfCampaign, seedLock, terraceLock, structureLock, equipmentLock,
  kitCount, addKit, takeKit, returnDug,
} from './campaign.js';
import { RANKS, MAX_RANK, rankInfo, progressOf as rankProgress, unlocksAt, rankForSeed, rankForTerrace, rankForStructure, rankForEquipment } from './rank.js';
import {
  canBuy, priceOfSeed, priceOfTerrace, priceOfEquipment, priceOfStructure, priceOfFertilizer,
} from './economy.js';
import {
  LAYOUT, groundYOf, groundYAt, tileGeom, plotGeom, tileAtPoint, forSaleBox,
  maxScroll, scrollToTerrace,
} from './farm-layout.js';
import {
  farmThemeOf, paintFarmSky, paintSky, paintRidges, paintHillside, paintStream, paintTerrace,
  paintFoot, paintForSale, paintTerracePrice, paintAltitudeMarkers, paintFog, paintLanterns,
  paintFireflies,
} from './farm-scene.js';
import {
  paintPlant, paintSoil, paintStructure, paintGlint, paintFitBadge,
  paintProgressRing, paintCountdown, paintPlantHint,
} from './plant-art.js';
import { countdown, money } from './format.js';
import { makeEffects, pruneEffects, resetEffects, dropletAt, floatAt, FX } from './effects.js';
import { fruitCard, lockedCard, paintCardsIn } from './cards.js';
import { sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);
const COLS = TUNING.tilesPerTerrace;

// The watering can: a short arc of droplets over the plot, in the stream's own
// colour. Rate-limited to one pour per plot per second so a player tapping fast
// gets water, not a firehose.
const POUR_MS = 520;
const POUR_COOLDOWN_MS = 900;

// The one scripted camera move in the game: after the first appraisal the view
// starts at the top of the mountain — every shelf and its price in one sweep,
// the whole campaign at a glance — and comes down to the terrace that is for
// sale. Interruptible: a touch lands it at once.
const PAN_MS = 2600;

// A press that travels further than this (CSS px) is a drag, not a tap.
const DRAG_SLOP = 8;
// The flick: how fast a released drag keeps coasting, and how quickly it stops.
const COAST_DECAY = 0.0045;      // per ms
const COAST_MIN = 0.02;          // world units per ms below which it is still

// How far up the chain the shop lets you peer at seeds you have not met.
const LOCKED_PEEK = 3;

// Bulk verbs appear once there is more than one of the thing to do: one ripe
// plot is a tap, five are a chore.
const BULK_MIN = 2;

const STARS = (n) => '★'.repeat(n) + '☆'.repeat(4 - n);

export function makeFarmHost({ canvas, save, getSettings, wallNow, loop, rng, onFarmBought }) {
  const fx = makeEffects();
  const pouring = new Map();          // plot key → t0, for the pour arc
  let open = null;                    // { ti, col } while the plot sheet is up
  let moving = null;                  // { ti, col } of the thing being moved
  let scale = 1, offX = 0;
  let viewH = WORLD.height;           // world units the canvas shows top to bottom
  let scrollY = null;                 // world y at the top of the view (null: not framed yet)
  let coast = 0;                      // world units per ms, after a flick
  let lastFrame = null;
  let pan = null;                     // { t0, from, to } while the opening pan runs
  let live = false;

  const ctx = canvas.getContext('2d');

  // ── the camera ─────────────────────────────────────────────────────────
  // Fit the world's WIDTH to the canvas — the shelves are the thing, and they
  // should fill the phone — but on a wide screen stop zooming once the view is
  // less than a few shelves tall.
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    scale = Math.min(canvas.width / LAYOUT.width, canvas.height / 520) || 1;
    offX = (canvas.width - LAYOUT.width * scale) / 2;
    viewH = canvas.height / scale;
    if (scrollY != null) scrollY = clampScroll(scrollY);
  }

  function clampScroll(y) { return Math.max(0, Math.min(maxScroll(viewH), y)); }

  function frameHome(c) {
    const owned = c.farm ? c.farm.terraces.length : 1;
    return scrollToTerrace(Math.max(0, owned - 1), viewH);
  }

  function cameraY(tMs) {
    if (pan) {
      const u = (tMs - pan.t0) / PAN_MS;
      if (u >= 1) { scrollY = pan.to; pan = null; }
      else if (u > 0) {
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;   // ease in-out
        return pan.from + (pan.to - pan.from) * e;
      } else return pan.from;
    }
    return scrollY;
  }

  function landCamera() {
    if (pan) { scrollY = pan.to; pan = null; }
    coast = 0;
  }

  // Screen → world, at the camera's current resting place (taps land the
  // camera first, so a tap during a move hits what the player sees when it
  // stops).
  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / (rect.width || 1);
    return {
      x: ((clientX - rect.left) * dpr - offX) / scale,
      y: ((clientY - rect.top) * dpr) / scale + scrollY,
    };
  }

  function cssToWorld(px) {
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / (rect.width || 1);
    return (px * dpr) / scale;
  }

  // ── drawing ────────────────────────────────────────────────────────────

  function draw(tMs) {
    const c = save.get();
    const settings = getSettings();
    const th = farmThemeOf(settings);
    // Reduced motion stops everything on the mountain; the launcher's power
    // saver stops the same half of it. What carries information holds still at
    // full strength — the glint over a ripe crop, the 种 over ground you can
    // plant — and what is pure decoration is simply gone.
    const motion = settings.reducedMotion || settings.powerSaver ? 0 : 1;
    const owned = c.farm ? c.farm.terraces.length : 0;

    if (scrollY == null) scrollY = frameHome(c);
    // the flick coasts to a stop, closed-form per frame off the host clock
    if (coast && lastFrame != null) {
      const dt = Math.min(64, tMs - lastFrame);
      scrollY = clampScroll(scrollY + coast * dt);
      coast *= Math.exp(-COAST_DECAY * dt);
      if (Math.abs(coast) < COAST_MIN) coast = 0;
    }
    lastFrame = tMs;
    const camY = cameraY(tMs);
    const view = { top: camY - 40, bottom: camY + viewH + 40 };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    paintFarmSky(ctx, th, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offX, -camY * scale);

    paintSky(ctx, th, tMs, motion, view);
    paintRidges(ctx, th, view);
    paintHillside(ctx, th, view);
    paintStream(ctx, th, tMs, motion, view);

    const now = wallNow();
    const plots = c.farm ? eachPlot(c.farm) : [];
    const anyRipe = plots.some(({ plot }) => isRipe(plot));
    const canSowAny = c.farm ? holdsAnythingToPlace(c) : false;

    // Far shelves first: a tall tree on a lower shelf leans over the wall of
    // the one above it, and has to be drawn on top of it.
    for (let i = TUNING.terraceCosts.length - 1; i >= 0; i--) {
      const gy = groundYOf(i);
      if (gy - LAYOUT.treeH - 20 > view.bottom || gy + LAYOUT.wallH < view.top) continue;
      const terrace = c.farm && c.farm.terraces[i];
      paintTerrace(ctx, th, i, i < owned, {
        sprinkler: !!(terrace && terrace.sprinkler),
        irrigated: !!(c.farm && c.farm.irrigation),
      });
      if (terrace) drawShelf(c, i, terrace, plots, tMs, motion, anyRipe, canSowAny, now);
    }
    paintFoot(ctx, th, tMs, motion, view);
    paintAltitudeMarkers(ctx, th, view);

    if (c.farm && !moving) {
      const next = soonestRipening(c.farm, now);
      if (next) drawCountdown(c, next);
    }

    // Every shelf ABOVE the one for sale wears its price, small and unlit.
    const forSale = forSaleIndex(c);
    for (let i = (forSale ?? owned) + 1; i < TUNING.terraceCosts.length; i++) {
      paintTerracePrice(ctx, th, i, priceOfTerrace(i));
    }

    // One thing for sale at a time — the next shelf up the mountain, or, before
    // there is a farm at all, the bottom one with the whole farm attached.
    if (forSale != null && !moving) {
      const price = c.farm ? priceOfTerrace(forSale) : priceOfEquipment('farm');
      const lock = c.farm ? terraceLock(c, forSale) : null;
      const note = lock ? `Rank ${rankForTerrace(forSale)}` : null;
      paintForSale(ctx, th, forSale, price, tMs, motion, note);
      if (!lock && canBuy(c.cash, price)) {
        const box = forSaleBox(forSale);
        ctx.save();
        ctx.translate(box.x + box.w * 0.5, box.y + box.h);
        paintGlint(ctx, box.h, tMs, motion);
        ctx.restore();
      }
    }

    pruneEffects(fx, tMs);
    drawPour(tMs);
    paintFog(ctx, th, tMs, motion, view);
    paintFireflies(ctx, th, tMs, motion, view);
    paintLanterns(ctx, th, tMs, motion, view);
    drawFloats(tMs, settings);
  }

  // One shelf's ground and everything standing on it.
  function drawShelf(c, ti, terrace, plots, tMs, motion, anyRipe, canSowAny, now) {
    const watered = !!(c.farm.irrigation || terrace.sprinkler);
    // the ground first, tile by tile — bare tiles get the lit rim that says
    // "plant here", and every tile shows how wet its soil is
    for (let col = 0; col < COLS; col++) {
      const t = tileGeom(ti, col);
      const p = plotAt(c.farm, ti, col);
      if (p && p.span > 1 && col !== p.col) continue;      // drawn with its first tile
      const w = p ? plotGeom(ti, p.col, p.span).w : t.w;
      const cx = p ? plotGeom(ti, p.col, p.span).cx : t.cx;
      const wet = watered || (p && isPlant(p) && p.wateredUntilMs > now);
      ctx.save();
      ctx.translate(cx, groundYAt(ti, cx));
      // the soil lies along the hill; the plants on it stand upright
      ctx.save();
      ctx.rotate(Math.atan2(groundYAt(ti, cx + w / 2) - groundYAt(ti, cx - w / 2), w));
      paintSoil(ctx, w, LAYOUT.soilH + 2, {
        wet, bare: !p, moisture: p ? moistureFor(terrace, p.col, p.span) : moistureAt(terrace, col),
      });
      ctx.restore();
      if (!p && canSowAny && !moving) paintPlantHint(ctx, LAYOUT.plantH, tMs, motion);
      ctx.restore();
    }
    for (const plot of terrace.plots) drawPlot(c, ti, plot, watered, tMs, motion, anyRipe, now);
    if (moving) drawMoveOverlay(c, ti);
  }

  // A plot's identity, as one integer: phases the sway and the blinks so a
  // shelf does not lean or wink in unison. Derived from the address, so it is
  // the same every frame.
  function seedOf(ti, col) { return ti * 31 + col * 7; }

  function drawPlot(c, ti, plot, watered, tMs, motion, anyRipe, now) {
    const g = plotGeom(ti, plot.col, plot.span);
    const isMoving = moving && moving.ti === ti && moving.col === plot.col;
    ctx.save();
    ctx.translate(g.cx, g.groundY);
    if (isMoving) ctx.globalAlpha = 0.45 + 0.25 * Math.sin(tMs / 180);
    if (isStructure(plot.kind)) {
      paintStructure(ctx, plot.kind, g.w, g.h, { tMs, motion, seed: seedOf(ti, plot.col) });
    } else {
      const ripe = isRipe(plot);
      // the ring is a glance-at gauge: one size for every plot, however tall
      // the plant over it is allowed to grow
      if (!ripe) paintProgressRing(ctx, LAYOUT.plantH * 0.8, progressOf(plot));
      paintPlant(ctx, {
        kind: plot.kind, level: plot.level, progress: progressOf(plot),
        mature: plot.mature, ripe, span: plot.span, w: g.w,
      }, g.h, { tMs, motion, seed: seedOf(ti, plot.col) });
      // Thirst glints only when nothing anywhere is ripe — the same "one tap,
      // here" as a ripe glint, kept from twinkling at a farm in full production.
      const wet = watered || plot.wateredUntilMs > now;
      if (!moving && !anyRipe && !wet && !ripe) paintGlint(ctx, g.h * 0.7, tMs, motion);
    }
    ctx.restore();
  }

  // While something is being moved, every tile on every shelf you own says how
  // it would do there — or nothing, if it would not fit.
  function drawMoveOverlay(c, ti) {
    const from = plotAt(c.farm, moving.ti, moving.col);
    if (!from) return;
    const what = isStructure(from.kind) ? from.kind : from.level;
    // Badges sit on the face of the shelf's wall, under the tile they are
    // about, so they never hide the plants the player is arranging around.
    for (let col = 0; col < COLS; col++) {
      const anchor = anchorFor(c.farm, ti, col, what, ti === moving.ti ? from : null);
      if (anchor == null) continue;                       // would not fit: say nothing
      const t = tileGeom(ti, col);
      ctx.save();
      ctx.translate(t.cx, t.groundY + LAYOUT.wallH * 0.5);
      if (isStructure(what)) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#fff3c4';
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        paintFitBadge(ctx, fitOf(c.farm, ti, anchor, what, from).grade, 15);
      }
      ctx.restore();
    }
  }

  function drawCountdown(c, { ti, col, ms }) {
    const p = plotAt(c.farm, ti, col);
    const g = plotGeom(ti, col, p ? p.span : 1);
    ctx.save();
    ctx.translate(g.cx, g.groundY);
    paintCountdown(ctx, countdown(ms), g.h);
    ctx.restore();
  }

  function holdsAnythingToPlace(c) {
    for (let level = 1; level <= MAX_LEVEL; level++) if (seedCount(c, level) > 0) return true;
    return STRUCTURE_KINDS.some((k) => kitCount(c, k) > 0);
  }

  // Droplets and the pour arc, closed-form readers over the shared effects
  // machinery — no per-frame integration, so a dropped frame cannot desync.
  function drawPour(tMs) {
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

  function drawFloats(tMs, settings) {
    if (!fx.floats.length) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const th = farmThemeOf(settings);
    for (const f of fx.floats) {
      const s = floatAt(f, tMs, !!settings.reducedMotion);
      if (s.alpha <= 0) continue;
      const size = 14 * f.scale * (settings.fontScale || 1);
      ctx.font = `800 ${size}px system-ui, sans-serif`;
      ctx.globalAlpha = s.alpha;
      ctx.lineWidth = Math.max(2, size * 0.16);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.strokeText(f.text, s.x, s.y);
      ctx.fillStyle = f.color || th.text;
      ctx.fillText(f.text, s.x, s.y);
    }
    ctx.globalAlpha = 1;
  }

  // ── the pour ───────────────────────────────────────────────────────────
  // Reduced motion gets the soil darkening and nothing that flies.
  function pour(ti, col, span) {
    if (getSettings().reducedMotion) return;
    const g = plotGeom(ti, col, span);
    const th = farmThemeOf(getSettings());
    const t = performance.now();
    for (let i = 0; i < 10; i++) {
      const u = i / 10;
      fx.droplets.push({
        x: g.cx - g.w * 0.34, y: g.groundY - LAYOUT.plantH * 0.95,
        vx: 40 + u * 26, vy: -30 + u * 20,
        r: 1.1 + (i % 3) * 0.5,
        color: i % 3 === 0 ? th.shimmer : th.stream,
        t0: t + u * POUR_MS * 0.5, life: POUR_MS,
      });
    }
  }

  function float(ti, col, span, text, color, dy = 0) {
    const g = plotGeom(ti, col, span);
    fx.floats.push({
      x: g.cx, y: g.groundY - g.h * 0.8 - dy, t0: performance.now(), life: FX.floatMs * 1.3,
      text, scale: 1.05, color: color || null,
    });
  }

  // ── the one tap ────────────────────────────────────────────────────────

  // Which terrace wears the 出售 sign. Before the first appraisal there is no
  // farm and nothing is for sale; after it, the starter terrace is — and that
  // one sign IS the "buy the farm" beat.
  function forSaleIndex(c) {
    if (!c.farm) return c.phase === 'buy-farm' ? 0 : null;
    return nextTerraceIndex(c.farm);
  }

  function onTap(clientX, clientY) {
    if (!live) return;
    landCamera();
    const c = save.get();
    if (scrollY == null) scrollY = frameHome(c);
    if (c.farm) evaluateFarm(c.farm, wallNow());
    const { x, y } = toWorld(clientX, clientY);

    if (moving) { tapWhileMoving(c, x, y); return; }

    // the 出售 sign first: it hangs over the shelf it sells
    const forSale = forSaleIndex(c);
    if (forSale != null && inBox(forSaleBox(forSale), x, y)) { showTerrace(forSale); return; }

    if (!c.farm) return;
    const hit = tileAtPoint(x, y, c.farm.terraces.length);
    if (!hit) return;
    tapTile(hit.ti, hit.col);
  }

  function tapTile(ti, col) {
    const c = save.get();
    const plot = plotAt(c.farm, ti, col);
    if (plot && isRipe(plot)) { doHarvest(ti, plot.col); return; }
    if (plot && needsWater(c.farm, ti, plot.col, wallNow())) { doWater(ti, plot.col); return; }
    showPlot(ti, col);
  }

  function doHarvest(ti, col, quiet = false) {
    const c = save.get();
    const plot = plotAt(c.farm, ti, col);
    const span = plot ? plot.span : 1;
    const picked = harvest(c.farm, ti, col, wallNow());
    if (!picked) return null;
    const got = harvestInto(c, picked, rng);
    if (!quiet) sfx('harvest', { level: picked.level });
    float(ti, col, span, `+${picked.count} ${FRUITS[picked.level - 1].name}`);
    if (got && got.xp) float(ti, col, span, `+${got.xp} XP`, '#9fd36a', 16);
    if (got && got.bonusSeed != null) {
      // the pineapple's golden hour: a seed falls out of the crown
      sfx('discover');
      float(ti, col, span, `+1 ${FRUITS[got.bonusSeed - 1].name} seed`, '#f0a03c', 32);
    }
    if (got && got.rankUp) celebrateRank(got.rankUp);
    save.touch();
    if (!quiet) refresh();
    return got;
  }

  function doWater(ti, col, quiet = false) {
    const c = save.get();
    const key = `${ti}:${col}`;
    const t = performance.now();
    if (pouring.has(key) && t - pouring.get(key) < POUR_COOLDOWN_MS) return false;
    if (!water(c.farm, ti, col, wallNow())) return false;
    const plot = plotAt(c.farm, ti, col);
    pouring.set(key, t);
    pour(ti, col, plot ? plot.span : 1);
    if (!quiet) sfx('water');
    save.touch();
    if (!quiet) refresh();
    return true;
  }

  // The bulk verbs: everything ripe, picked; everything thirsty, watered. One
  // sound for the lot — ten harvest chimes on top of each other is noise.
  function harvestAll() {
    const c = save.get();
    evaluateFarm(c.farm, wallNow());
    let top = 0;
    for (const { ti, col, plot } of eachPlot(c.farm)) {
      if (!isRipe(plot)) continue;
      const got = doHarvest(ti, col, true);
      if (got) top = Math.max(top, got.level);
    }
    if (top) sfx('harvest', { level: top });
    refresh();
  }

  function waterAll() {
    const c = save.get();
    const now = wallNow();
    evaluateFarm(c.farm, now);
    let any = false;
    for (const { ti, col } of eachPlot(c.farm)) {
      if (needsWater(c.farm, ti, col, now)) any = doWater(ti, col, true) || any;
    }
    if (any) sfx('water');
    refresh();
  }

  function celebrateRank(rank) {
    const info = rankInfo(rank);
    sfx('terrace-fanfare');
    fx.floats.push({
      x: LAYOUT.width / 2, y: (scrollY ?? 0) + viewH * 0.35, t0: performance.now(), life: FX.floatMs * 2.6,
      text: `Rank ${rank}! ${info.title} ${info.hanzi}`, scale: 1.6, color: '#ffd97a',
    });
    const el = $('farm-rank');
    if (el) {
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
  }

  // ── moving ─────────────────────────────────────────────────────────────

  function startMove(ti, col) {
    const c = save.get();
    const plot = plotAt(c.farm, ti, col);
    if (!plot) return;
    moving = { ti, col: plot.col };
    closeSheets();
    const name = isStructure(plot.kind) ? STRUCTURES[plot.kind].name : `${FRUITS[plot.level - 1].name}`;
    $('move-text').textContent = isStructure(plot.kind)
      ? `Moving the ${name.toLowerCase()} — tap where it should go`
      : `Moving the ${name.toLowerCase()} — tap a spot. More stars, better growing.`;
    refresh();
  }

  function endMove() {
    moving = null;
    refresh();
  }

  function tapWhileMoving(c, x, y) {
    const hit = tileAtPoint(x, y, c.farm.terraces.length);
    if (!hit) return;
    if (hit.ti === moving.ti) {
      const here = plotAt(c.farm, hit.ti, hit.col);
      const from = plotAt(c.farm, moving.ti, moving.col);
      if (here && here === from) { endMove(); return; }   // set it back down
    }
    const landed = move(c.farm, moving.ti, moving.col, hit.ti, hit.col, wallNow());
    if (landed == null) { sfx('menu-click'); return; }  // doesn't fit there: keep holding it
    const plot = plotAt(c.farm, hit.ti, landed);
    sfx('plant', { level: plot && plot.level ? plot.level : 1 });
    save.touch();
    moving = null;
    refresh();
  }

  // ── the drawers ────────────────────────────────────────────────────────

  function closeSheets() {
    open = null;
    for (const id of ['shop', 'plot', 'almanac']) if ($(id)) $(id).hidden = true;
  }

  function anySheetUp() {
    return ['shop', 'plot', 'almanac'].some((id) => $(id) && !$(id).hidden);
  }

  function showSheet(id) {
    for (const other of ['shop', 'plot', 'almanac']) if ($(other)) $(other).hidden = other !== id;
  }

  function showPlot(ti, col) {
    const c = save.get();
    open = { ti, col };
    showSheet('plot');
    buildPlotSheet(c, ti, col);
    paintCards();       // the sheet is up NOW, so its chips finally have a size
  }

  function spotLine(terrace, ti, col, span) {
    const alt = ALTITUDE_NAMES[altitudeOf(ti)];
    const wet = MOISTURE_NAMES[moistureFor(terrace, col, span)];
    return `${alt} · ${wet} soil`;
  }

  // The 出售 sheet: the whole starter farm, or one more shelf up the mountain.
  function showTerrace(i) {
    const c = save.get();
    const first = !c.farm;
    const price = first ? priceOfEquipment('farm') : priceOfTerrace(i);
    const lock = first ? null : terraceLock(c, i);
    open = null;
    showSheet('plot');
    $('plot-title').textContent = first ? 'The farm 农场' : `Terrace ${i + 1} 梯田`;
    const alt = ALTITUDE_NAMES[altitudeOf(i)];
    $('plot-note').textContent = first
      ? 'A weedy terrace with a young cherry tree, a strawberry bed halfway up, and a packet of seeds thrown in.'
      : lock
        ? `A shelf of ${alt.split(' ')[0].toLowerCase()} ground. Reach rank ${rankForTerrace(i)} (${rankInfo(rankForTerrace(i)).title}) to farm this high.`
        : `Six more tiles of ${alt.split(' ')[0].toLowerCase()} ground, going cheap.`;
    $('plot-seeds').textContent = '';
    rows($('plot-rows'), [{
      label: first ? 'Buy the farm' : 'Buy this terrace', hanzi: '出售', price,
      can: first ? canBuyFarm(c) : (!lock && canBuy(c.cash, price)),
      note: lock ? `Needs rank ${rankForTerrace(i)}` : '',
      go: () => {
        if (first) {
          if (!buyFarm(c, wallNow())) return;
        } else {
          if (terraceLock(c, i) || !spend(c, price)) return;
          addTerrace(c.farm, wallNow());
        }
        sfx('terrace-fanfare');
        save.touch();
        save.flush();
        closeSheets();
        refresh();
        if (first && onFarmBought) onFarmBought();
      },
    }]);
  }

  // What one tile can have done to it right now.
  function buildPlotSheet(c, ti, col) {
    const terrace = c.farm.terraces[ti];
    const plot = plotAt(c.farm, ti, col);
    const seeds = $('plot-seeds');
    seeds.textContent = '';
    const options = [];

    if (!plot) {
      $('plot-title').textContent = 'Bare ground 空地';
      $('plot-note').textContent = `${spotLine(terrace, ti, col, 1)}. Plant something — the stars say how well it would grow here.`;
      // Best spot first: the drawer is sorted by how well each seed would do
      // HERE, so the answer to "what should go on this tile" is the first card.
      const offers = [];
      for (let level = 1; level <= MAX_LEVEL; level++) {
        const held = seedCount(c, level);
        if (held <= 0) continue;
        const anchor = anchorFor(c.farm, ti, col, level);
        offers.push({ level, held, anchor, grade: anchor == null ? -9 : fitOf(c.farm, ti, anchor, level).grade });
      }
      offers.sort((a, b) => b.grade - a.grade || a.level - b.level);
      for (const { level, held, anchor } of offers) {
        if (anchor == null) {
          seeds.appendChild(fruitCard({ level, meta: 'No room', enabled: false, note: `Needs ${spanOf(level)} tiles · ×${held}` }));
          continue;
        }
        const fit = fitOf(c.farm, ti, anchor, level);
        const info = gradeInfo(fit.grade);
        seeds.appendChild(fruitCard({
          level, meta: STARS(info.stars), enabled: true,
          note: `${info.name} · ×${held}`,
          onPick: () => {
            if (!takeSeed(c, level)) return;
            plant(c.farm, ti, anchor, level, wallNow());
            sfx('plant', { level });
            save.touch();
            closeSheets();
            refresh();
          },
        }));
      }
      for (const kind of STRUCTURE_KINDS) {
        const held = kitCount(c, kind);
        if (held <= 0) continue;
        const s = STRUCTURES[kind];
        options.push({
          label: `Place the ${s.name.toLowerCase()}`, hanzi: s.hanzi, price: null, meta: `×${held}`,
          can: true, note: s.note,
          go: () => {
            if (!takeKit(c, kind)) return;
            if (!placeStructure(c.farm, ti, col, kind, wallNow())) { addKit(c, kind, 1); return; }
            sfx('buy');
            save.touch();
            closeSheets();
            refresh();
          },
        });
      }
      if (!seeds.children.length && !options.length) {
        $('plot-note').textContent = `${spotLine(terrace, ti, col, 1)}. Nothing in the drawer — the shop has seeds.`;
        options.push({ label: 'Open the shop', hanzi: '商店', price: null, can: true, go: () => showShop() });
      }
    } else if (isStructure(plot.kind)) {
      const s = STRUCTURES[plot.kind];
      $('plot-title').textContent = `${s.name} ${s.hanzi}`;
      $('plot-note').textContent = `${s.note}, on this shelf.`;
      options.push(moveRow(ti, plot.col));
      options.push({
        label: 'Take it up', hanzi: '收起', price: null, can: true, note: 'Back in the drawer',
        go: () => { digUp(ti, plot.col); },
      });
    } else {
      const fruit = FRUITS[plot.level - 1];
      const fit = fitOf(c.farm, ti, plot.col, plot.level, plot);
      const info = gradeInfo(fit.grade);
      $('plot-title').textContent = `${fruit.name} ${fruit.hanzi}`;
      const left = msUntilRipeAt(c.farm, ti, plot.col, wallNow());
      const dry = needsWater(c.farm, ti, plot.col, wallNow());
      const status = isRipe(plot) ? 'Ripe — tap to pick.'
        : dry || left == null ? 'Thirsty — tap it to water.'
          : `Ready in ${countdown(left)}.`;
      const extras = [];
      if (fit.bees) extras.push('bees +fruit');
      if (fit.compost) extras.push('compost +speed');
      if (fit.variety) extras.push(`variety +${fit.variety * Math.round(TUNING.varietySpeed * 100)}%`);
      $('plot-note').textContent =
        `${status} ${STARS(info.stars)} ${info.name} spot: ${spotLine(terrace, ti, plot.col, plot.span)}. ` +
        `${likesOf(plot.level)}.` +
        ` Bears ${fit.yield}, grows ×${fit.speed.toFixed(2)}${extras.length ? ` (${extras.join(', ')})` : ''}.`;
      if (!isRipe(plot)) {
        const price = priceOfFertilizer(plot.level);
        options.push({
          label: 'Fertilize', hanzi: '肥料', price, can: canBuy(c.cash, price),
          note: 'Halves the time left', go: () => {
            if (!spend(c, price)) return;
            fertilize(c.farm, ti, plot.col, wallNow());
            sfx('buy');
            save.touch();
            showPlot(ti, plot.col);
            refresh();
          },
        });
      }
      options.push(moveRow(ti, plot.col));
      options.push({
        label: 'Dig it up', hanzi: '挖起', price: null, can: true,
        note: plot.kind === 'bed' ? 'Seed back in the drawer' : 'Back to a sapling, in the drawer',
        go: () => { digUp(ti, plot.col); },
      });
    }
    if (terrace.plots.length > 1 || (terrace.plots.length === 1 && !plot)) {
      options.push({
        label: `Clear terrace ${ti + 1}`, hanzi: '清空', price: null, can: true,
        note: 'Everything back in the drawer — start the shelf over',
        go: () => clearTerrace(ti),
      });
    }
    rows($('plot-rows'), options);
  }

  function moveRow(ti, col) {
    return {
      label: 'Move it', hanzi: '移栽', price: null, can: true, note: 'Keeps everything it has grown',
      go: () => startMove(ti, col),
    };
  }

  function digUp(ti, col) {
    const c = save.get();
    const dug = dig(c.farm, ti, col, wallNow());
    if (!dug) return;
    if (dug.harvested) {
      const got = harvestInto(c, dug.harvested, rng);
      if (got && got.rankUp) celebrateRank(got.rankUp);
    }
    returnDug(c, dug);
    sfx('plant', { level: dug.level || 1 });
    save.touch();
    closeSheets();
    refresh();
  }

  function clearTerrace(ti) {
    const c = save.get();
    const terrace = c.farm.terraces[ti];
    const now = wallNow();
    while (terrace.plots.length) {
      const p = terrace.plots[0];
      const dug = dig(c.farm, ti, p.col, now);
      if (!dug) break;
      if (dug.harvested) {
        const got = harvestInto(c, dug.harvested, rng);
        if (got && got.rankUp) celebrateRank(got.rankUp);
      }
      returnDug(c, dug);
    }
    sfx('plant', { level: 1 });
    save.touch();
    closeSheets();
    refresh();
  }

  // ── the shop ───────────────────────────────────────────────────────────

  function showShop() {
    const c = save.get();
    open = null;
    showSheet('shop');
    buildShop(c);
    paintCards();
  }

  function buildShop(c) {
    $('shop-cash').textContent = String(c.cash);
    if (!c.farm) {
      $('shop-seeds').textContent = '';
      rows($('shop-kit'), [], 'Nothing to sell you yet — buy the farm first.');
      $('shop-locked-hint').hidden = true;
      return;
    }
    const rank = rankOfCampaign(c);

    const grid = $('shop-seeds');
    grid.textContent = '';
    let peeked = 0;
    let anyRankLocked = false;
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const lock = seedLock(c, level);
      const held = seedCount(c, level);
      if (lock === 'merge') {
        if (peeked < LOCKED_PEEK) { grid.appendChild(lockedCard(level, 'Locked seed — merge one at market to meet it')); peeked++; }
        continue;
      }
      if (lock === 'rank') {
        anyRankLocked = true;
        grid.appendChild(fruitCard({
          level, meta: `Rank ${rankForSeed(level)}`, enabled: false,
          note: held > 0 ? `×${held} held` : likesOf(level),
        }));
        continue;
      }
      const price = priceOfSeed(level);
      grid.appendChild(fruitCard({
        level, meta: `${price}元`, enabled: canBuy(c.cash, price),
        note: held > 0 ? `×${held} held` : likesOf(level),
        onPick: () => {
          if (seedLock(c, level) || !spend(c, price)) return;
          addSeeds(c, level, 1);
          sfx('buy');
          save.touch();
          buildShop(c);
          paintCards();
          refresh();
        },
      }));
    }
    const hint = $('shop-locked-hint');
    hint.textContent = peeked
      ? 'Merge a fruit at the market to meet its seed.' + (anyRankLocked ? ' Rank up by harvesting to plant the bigger ones.' : '')
      : anyRankLocked ? 'Rank up by harvesting to plant the bigger ones.' : '';
    hint.hidden = !hint.textContent;
    showFarmStats();

    // Things that are not plants, then the things that stop the farm asking
    // anything of the player.
    const kit = [];
    for (const kind of STRUCTURE_KINDS) {
      const s = STRUCTURES[kind];
      const price = priceOfStructure(kind);
      const lock = structureLock(c, kind);
      const held = kitCount(c, kind);
      kit.push({
        label: s.name, hanzi: s.hanzi, price, can: !lock && canBuy(c.cash, price),
        note: lock ? `Rank ${rankForStructure(kind)} · ${s.note}` : `${s.note}${held ? ` · ×${held} in the drawer` : ''}`,
        go: () => {
          if (structureLock(c, kind) || !spend(c, price)) return;
          addKit(c, kind, 1);
          sfx('buy');
          save.touch();
          buildShop(c);
          refresh();
        },
      });
    }
    if (!c.farm.irrigation) {
      const sLock = equipmentLock(c, 'sprinkler');
      c.farm.terraces.forEach((terrace, ti) => {
        if (terrace.sprinkler) return;
        const price = priceOfEquipment('sprinkler');
        kit.push({
          label: `Sprinkler — terrace ${ti + 1}`, hanzi: '洒水器', price,
          can: !sLock && canBuy(c.cash, price),
          note: sLock ? `Rank ${rankForEquipment('sprinkler')} · Waters it forever` : 'Waters it forever',
          go: () => {
            if (equipmentLock(c, 'sprinkler') || !spend(c, price)) return;
            installSprinkler(c.farm, ti, wallNow());
            sfx('buy');
            save.touch();
            buildShop(c);
            refresh();
          },
        });
      });
      const price = priceOfEquipment('irrigation');
      const iLock = equipmentLock(c, 'irrigation');
      kit.push({
        label: 'Stream irrigation', hanzi: '灌溉', price, can: !iLock && canBuy(c.cash, price),
        note: iLock ? `Rank ${rankForEquipment('irrigation')} · The whole mountain, forever` : 'The whole mountain, forever',
        go: () => {
          if (equipmentLock(c, 'irrigation') || !spend(c, price)) return;
          installIrrigation(c.farm, wallNow());
          sfx('terrace-fanfare');
          save.touch();
          buildShop(c);
          refresh();
        },
      });
    }
    rows($('shop-kit'), kit);
  }

  // The campaign's own record, quietly, at the bottom of the drawer.
  function showFarmStats() {
    const el = $('shop-stats');
    const s = Arcade.stats.get('farm');
    const days = (s && s.marketDays) || 0;
    if (!days) { el.hidden = true; el.textContent = ''; return; }
    const parts = [`Market days ${days}`, `Earned ${money((s && s.earned) || 0)}元`];
    if (s.soldOut > 0) parts.push(`Sold out ${s.soldOut}`);
    el.textContent = parts.join(' · ');
    el.hidden = false;
  }

  // ── the almanac ────────────────────────────────────────────────────────
  // Every rank, what it takes to reach it and what it opens. The whole
  // campaign arc on one page — the answer to "what am I working towards?"

  function showAlmanac() {
    const c = save.get();
    open = null;
    showSheet('almanac');
    const rank = rankOfCampaign(c);
    const p = rankProgress(c.xp);
    $('almanac-now').textContent = p.toNext == null
      ? `${money(c.xp)} XP — the top of the mountain.`
      : `${money(c.xp)} XP · ${money(p.toNext)} more to rank ${rank + 1}. Every fruit you pick earns its face value in XP.`;
    const list = $('almanac-list');
    list.textContent = '';
    for (let r = 1; r <= MAX_RANK; r++) {
      const info = rankInfo(r);
      const li = document.createElement('li');
      li.className = r < rank ? 'done' : r === rank ? 'here' : 'ahead';
      const head = document.createElement('div');
      head.className = 'almanac-head';
      head.innerHTML = '<b></b><span></span>';
      head.querySelector('b').textContent = `${r}. ${info.title} ${info.hanzi}`;
      head.querySelector('span').textContent = r === 1 ? 'start' : `${money(RANKS[r - 1].xp)} XP`;
      const body = document.createElement('div');
      body.className = 'almanac-unlocks';
      const unlocks = unlocksAt(r);
      body.textContent = unlocks.length
        ? unlocks.map((u) => `${u.name} ${u.hanzi}`).join(' · ')
        : (r === MAX_RANK ? 'The title, and the mountain' : '—');
      li.append(head, body);
      list.appendChild(li);
    }
  }

  // ── cards and rows ─────────────────────────────────────────────────────

  const CARD_GRIDS = [['shop', 'shop-seeds'], ['plot', 'plot-seeds']];

  function paintCards() {
    for (const [sheet, grid] of CARD_GRIDS) {
      if ($(sheet).hidden) continue;
      paintCardsIn($(grid));
    }
  }

  function rows(holder, list, emptyNote) {
    holder.textContent = '';
    if (!list.length) {
      if (!emptyNote) return;
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = emptyNote;
      holder.appendChild(p);
      return;
    }
    for (const row of list) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = row.can ? 'shop-row' : 'shop-row off';
      el.disabled = !row.can;
      el.innerHTML = '<span class="row-name"></span><span class="row-note"></span><span class="row-price"></span>';
      el.querySelector('.row-name').textContent = row.hanzi ? `${row.label} ${row.hanzi}` : row.label;
      el.querySelector('.row-note').textContent = row.note || '';
      el.querySelector('.row-price').textContent = row.price == null ? (row.meta || '') : `${money(row.price)}元`;
      el.addEventListener('click', row.go);
      holder.appendChild(el);
    }
  }

  // ── the opening pan ────────────────────────────────────────────────────

  function panUp() {
    const c = save.get();
    if (getSettings().reducedMotion) { scrollY = null; return; }   // the farm is simply there
    // framed on the next draw if the canvas has not been sized yet
    if (!canvas.height) resize();
    const to = frameHome(c);
    pan = { t0: performance.now(), from: 0, to };
    scrollY = to;
  }

  function inBox(box, x, y) {
    return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  }

  // ── the HUD ────────────────────────────────────────────────────────────

  function refresh() {
    const c = save.get();
    const now = wallNow();
    if (c.farm) evaluateFarm(c.farm, now);
    $('farm-cash').textContent = money(c.cash);
    $('crate-count').textContent = String(crateSize(c));
    $('to-shop').disabled = !c.farm;
    const ready = canGoToMarket(c);
    $('to-market').classList.toggle('ready', ready);
    $('to-market').disabled = !ready;
    $('farm-badge').hidden = !couldUseAHand(c, now);

    // the rank strip: where you are, how far to the next, and what it opens
    const strip = $('farm-rank');
    strip.hidden = !c.farm;
    if (c.farm) {
      const p = rankProgress(c.xp);
      const info = rankInfo(p.rank);
      $('rank-title').textContent = `Rank ${p.rank} · ${info.title} ${info.hanzi}`;
      $('rank-fill').style.width = `${Math.round(p.fraction * 100)}%`;
      if (p.toNext == null) {
        $('rank-next').textContent = 'Top of the mountain';
      } else {
        const next = unlocksAt(p.rank + 1).map((u) => u.name);
        $('rank-next').textContent = `${money(p.toNext)} XP to rank ${p.rank + 1}${next.length ? `: ${next.slice(0, 3).join(', ')}` : ''}`;
      }
    }

    // the bulk verbs and the move banner, over the canvas
    let ripe = 0, thirsty = 0;
    if (c.farm) {
      for (const { ti, col, plot } of eachPlot(c.farm)) {
        if (isRipe(plot)) ripe++;
        else if (needsWater(c.farm, ti, col, now)) thirsty++;
      }
    }
    $('farm-tools').hidden = !live;
    $('harvest-all').hidden = !!moving || ripe < BULK_MIN;
    $('harvest-all').textContent = `Pick all ${ripe} 全收`;
    $('water-all').hidden = !!moving || thirsty < BULK_MIN;
    $('water-all').textContent = `Water all ${thirsty} 浇水`;
    $('move-banner').hidden = !moving;

    if (!$('shop').hidden) buildShop(c);
    paintCards();
    if (live) loop.kick();
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  function enter() {
    live = true;
    resetEffects(fx);
    pouring.clear();
    moving = null;
    coast = 0;
    closeSheets();
    const c = save.get();
    if (c.farm) {
      evaluateFarm(c.farm, wallNow());
      // A soft chime, once, for walking in on something ready to pick.
      if (eachPlot(c.farm).some(({ plot }) => isRipe(plot))) sfx('ripe-chime');
    }
    resize();
    refresh();
    loop.start();
  }

  function exit() {
    live = false;
    moving = null;
    closeSheets();
    $('farm-tools').hidden = true;
    loop.stop();
    save.flushIfDirty();
  }

  // ── wiring ─────────────────────────────────────────────────────────────
  // One pointer at a time. A press that stays put is a tap; one that travels
  // scrolls the mountain, and a release mid-travel coasts.

  let press = null;   // { id, x, y, scroll, t, moved, vy }

  canvas.addEventListener('pointerdown', (e) => {
    if (!live) return;
    if (press) return;
    if (pan) landCamera();
    coast = 0;
    if (scrollY == null) scrollY = frameHome(save.get());
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, scroll: scrollY, t: performance.now(), lastY: e.clientY, vy: 0, moved: false };
    if (canvas.setPointerCapture && e.pointerId != null) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!press || (e.pointerId != null && e.pointerId !== press.id)) return;
    const dy = e.clientY - press.y;
    if (!press.moved && Math.abs(dy) < DRAG_SLOP && Math.abs(e.clientX - press.x) < DRAG_SLOP) return;
    press.moved = true;
    const t = performance.now();
    const dt = Math.max(1, t - press.t);
    press.vy = -cssToWorld(e.clientY - press.lastY) / dt;
    press.t = t;
    press.lastY = e.clientY;
    scrollY = clampScroll(press.scroll - cssToWorld(dy));
    loop.kick();
  });

  function release(e) {
    if (!press || (e && e.pointerId != null && e.pointerId !== press.id)) return null;
    const was = press;
    press = null;
    return was;
  }

  canvas.addEventListener('pointerup', (e) => {
    if (!live) return;
    const was = release(e);
    if (was && was.moved) {
      if (performance.now() - was.t < 80) coast = was.vy;
      return;
    }
    if (anySheetUp()) { closeSheets(); return; }
    onTap(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointercancel', (e) => { release(e); });

  canvas.addEventListener('wheel', (e) => {
    if (!live) return;
    if (e.preventDefault) e.preventDefault();
    landCamera();
    if (scrollY == null) scrollY = frameHome(save.get());
    scrollY = clampScroll(scrollY + cssToWorld(e.deltaY || 0));
    loop.kick();
  }, { passive: false });

  $('to-shop').addEventListener('click', () => { sfx('menu-click'); showShop(); });
  $('shop-close').addEventListener('click', () => { sfx('menu-click'); closeSheets(); });
  $('shop-x').addEventListener('click', () => { sfx('menu-click'); closeSheets(); });
  $('plot-close').addEventListener('click', () => { sfx('menu-click'); closeSheets(); });
  $('plot-x').addEventListener('click', () => { sfx('menu-click'); closeSheets(); });
  $('farm-rank').addEventListener('click', () => { sfx('menu-click'); showAlmanac(); });
  $('almanac-close').addEventListener('click', () => { sfx('menu-click'); closeSheets(); });
  $('almanac-x').addEventListener('click', () => { sfx('menu-click'); closeSheets(); });
  $('harvest-all').addEventListener('click', () => { harvestAll(); });
  $('water-all').addEventListener('click', () => { waterAll(); });
  $('move-cancel').addEventListener('click', () => { sfx('menu-click'); endMove(); });

  return {
    enter, exit, resize, draw, refresh, panUp,
    // The map's Seed Shop spot: walk to the farm, then open the drawer.
    openShop: showShop,
    isLive: () => live,
    nextRipeMs: () => {
      const c = save.get();
      return c.farm ? msUntilNextRipe(c.farm, wallNow()) : null;
    },
  };
}

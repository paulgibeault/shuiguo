// The farm screen: the mountainside on the canvas, the shop and the plot sheet
// over it, and the one tap that does whatever the plot needs doing.
//
// Host, not logic. Every rule it enforces is asked of js/farm.js, js/campaign.js
// or js/economy.js — this file owns DOM, canvas, input and the Arcade calls, and
// nothing here decides what anything costs or how fast anything grows.
//
// THE ONE-TAP RULE. Tapping a plot does the obvious thing outright: a ripe plot
// is harvested, a thirsty plot is watered. Only a plot with a CHOICE to make
// (bare earth, or something to buy for it) opens a sheet. Nothing on the farm
// is a long-press, a drag, or a confirm.
//
// EVALUATE ON LOOK. There are no timers. Every read of the farm brings it up to
// date against wall time first, which is what makes closing the app for a week
// cost nothing and why this file never schedules anything but its own repaint.

import { WORLD, TUNING, FRUITS, MAX_LEVEL } from './constants.js';
import {
  evaluateFarm, eachPlot, plotAt, isRipe, progressOf, needsWater,
  msUntilNextRipe, msUntilRipeAt, soonestRipening,
  canPlant, plant, water, harvest, fertilize, buildTrellis,
  addTerrace, nextTerraceIndex, installSprinkler, installIrrigation,
} from './farm.js';
import {
  spend, seedCount, takeSeed, addSeeds, unlockedLevels, isUnlocked, harvestInto, crateSize,
  buyFarm, canBuyFarm, canGoToMarket,
} from './campaign.js';
import { canBuy, priceOfSeed, priceOfTerrace, priceOfEquipment } from './economy.js';
import {
  FARM_SCENE, farmThemeOf, plotGeom, plotAtPoint, forSaleBox,
  paintFarmSky, paintRidges, paintHillside, paintTerrace, paintForSale,
  paintTerracePrice, paintStream, paintFog, paintLanterns, paintFireflies,
} from './farm-scene.js';
import {
  paintPlant, paintSoil, paintTrellis, paintGlint,
  paintProgressRing, paintCountdown, paintPlantHint,
} from './plant-art.js';
import { countdown, money } from './format.js';
import { makeEffects, pruneEffects, resetEffects, dropletAt, floatAt, FX } from './effects.js';
import { paintChip } from './chips.js';
import { sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);
const N = TUNING.plotsPerTerrace;

// The watering can: a short arc of droplets over the plot, in the stream's own
// colour. Rate-limited to one pour per plot per second so a player tapping fast
// gets water, not a firehose.
const POUR_MS = 520;
const POUR_COOLDOWN_MS = 900;

// The one scripted camera move in the game: after the first appraisal the view
// rises off the road to the terrace that is for sale. Long enough to read as a
// place rather than a transition, short enough that nobody waits for it — and
// interruptible, because the whole opening is skippable by simply doing the
// thing it is pointing at.
const PAN_MS = 1500;
const PAN_FROM = 150;      // world units below the settled view

// How far up the chain the shop lets you peer. Three silhouettes read as "the
// next few"; all nine would read as a wall of things you cannot have.
const LOCKED_PEEK = 3;

export function makeFarmHost({ canvas, save, getSettings, wallNow, loop, rng, onFarmBought }) {
  const fx = makeEffects();
  const pouring = new Map();          // plot key → t0, for the pour arc
  let openPlot = null;                // { ti, pi } while the plot sheet is up
  let openTerrace = null;             // terrace index while the for-sale sheet is up
  let scale = 1, offX = 0, offY = 0;
  let live = false;
  let panFrom = null;        // performance.now() while the opening pan runs

  const ctx = canvas.getContext('2d');

  // ── the view transform ─────────────────────────────────────────────────
  // The farm fills the same 360×560 world the board does, without the stall's
  // side planks — so it fits the bare world and nothing else.
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    scale = Math.min(canvas.width / WORLD.width, canvas.height / WORLD.height);
    offX = (canvas.width - WORLD.width * scale) / 2;
    offY = (canvas.height - WORLD.height * scale) / 2;
  }

  // Screen → world. It does NOT account for the opening pan, because onTap
  // lands the camera before it converts: a tap during a camera move must hit
  // what the player is looking at when it stops, not what was under their
  // finger mid-flight.
  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    return {
      x: ((clientX - rect.left) * dpr - offX) / scale,
      y: ((clientY - rect.top) * dpr - offY) / scale,
    };
  }

  // ── drawing ────────────────────────────────────────────────────────────

  function draw(tMs) {
    const c = save.get();
    const settings = getSettings();
    const th = farmThemeOf(settings);
    const motion = settings.reducedMotion ? 0 : 1;
    const owned = c.farm ? c.farm.terraces.length : 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    paintFarmSky(ctx, th, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offX, offY + panOffset(tMs) * scale);

    paintRidges(ctx, th);
    paintHillside(ctx, th);
    paintStream(ctx, th, tMs, motion);

    // Bottom terrace first: each band's wall overlaps the one below it, so the
    // hillside reads as stacked rather than as stripes.
    for (let i = 0; i < FARM_SCENE.bands; i++) paintTerrace(ctx, th, i, i < owned);
    if (c.farm) {
      const now = wallNow();
      const plots = eachPlot(c.farm);
      const thirstyGlints = !plots.some(({ plot }) => isRipe(plot));
      // ONE countdown on the whole mountain. The plot it belongs to is asked of
      // the farm, not chosen here — the host does not get to have an opinion
      // about which crop is soonest.
      const next = soonestRipening(c.farm, now);
      const canSow = (ti, pi) => canSowIn(c, ti, pi);
      for (const p of plots) drawPlot(p, tMs, motion, thirstyGlints, canSow, now);
      if (next) drawCountdown(next);
    }

    // Every shelf ABOVE the one for sale wears its price, small and unlit. One
    // sign is the offer; these are the ladder it stands at the bottom of.
    for (let i = (forSaleIndex(c) ?? owned) + 1; i < FARM_SCENE.bands; i++) {
      paintTerracePrice(ctx, th, i, priceOfTerrace(i));
    }

    // One thing for sale at a time — the next shelf up the mountain, or, before
    // there is a farm at all, the bottom one with the whole farm attached to it.
    const forSale = forSaleIndex(c);
    if (forSale != null) {
      const price = c.farm ? priceOfTerrace(forSale) : priceOfEquipment('farm');
      paintForSale(ctx, th, forSale, price, tMs, motion);
      // A glint on the sign while it is affordable — the same "tap me" the ripe
      // fruit wears, because it is the same instruction.
      if (canBuy(c.cash, price)) {
        const box = forSaleBox(forSale);
        ctx.save();
        ctx.translate(box.x + box.w * 0.5, box.y + box.h);
        paintGlint(ctx, box.h, tMs, motion);
        ctx.restore();
      }
    }

    pruneEffects(fx, tMs);
    drawPour(tMs);
    paintFog(ctx, th, tMs, motion);
    paintFireflies(ctx, th, tMs, motion);
    paintLanterns(ctx, th, tMs, motion);
    drawFloats(tMs, settings);
  }

  // A plot's identity, as one integer. It phases the sway and the blinks so a
  // terrace does not lean or wink in unison, and it has to be the SAME number
  // every frame for the same plot — which is why it is derived from the address
  // rather than from anything that moves.
  function seedOf(ti, pi) { return ti * 31 + pi * 7; }

  function drawPlot({ ti, pi, plot, watered }, tMs, motion, thirstyGlints, canSow, now) {
    const g = plotGeom(ti, pi, N);
    const wet = watered || plot.wateredUntilMs > now;
    const growing = !!plot.kind && !isRipe(plot);
    ctx.save();
    ctx.translate(g.cx, g.groundY);
    paintSoil(ctx, g.w * 0.86, FARM_SCENE.soilH + 2, { wet, bare: !plot.kind });
    // Behind the plant: a ring the crop grows over as it fills, so every plot
    // says how far along it is without anything having to be read.
    if (growing) paintProgressRing(ctx, g.h, progressOf(plot));
    if (plot.trellis) paintTrellis(ctx, g.w * 0.8, g.h);
    paintPlant(ctx, {
      kind: plot.kind, level: plot.level, progress: progressOf(plot),
      mature: plot.mature, ripe: isRipe(plot), trellis: plot.trellis,
    }, g.h, { tMs, motion, seed: seedOf(ti, pi) });
    // 种 over ground that is bare AND has something in the drawer to go in it.
    if (!plot.kind && canSow(ti, pi)) paintPlantHint(ctx, g.h, tMs, motion);
    // Thirst glints only when there is nothing ripe anywhere. It is the same
    // instruction as a ripe glint — one tap, here — and scoping it this way
    // keeps the guidance of the opening without a farm in full production
    // twinkling at the player from every dry bed it owns.
    if (thirstyGlints && !wet && plot.kind && !isRipe(plot)) paintGlint(ctx, g.h * 0.7, tMs, motion);
    ctx.restore();
  }

  function drawCountdown({ ti, pi, ms }) {
    const g = plotGeom(ti, pi, N);
    ctx.save();
    ctx.translate(g.cx, g.groundY);
    paintCountdown(ctx, countdown(ms), g.h);
    ctx.restore();
  }

  // Is there anything in the drawer that would go in THIS plot right now? Asked
  // of `canPlant` — the same predicate the plot sheet fills itself from — so the
  // hint on the ground and the seeds in the sheet can never disagree about what
  // is plantable. A bare bench with only vine seeds held is not sowable, and
  // correctly wears no hint: what it needs is a trellis, which the sheet sells.
  function canSowIn(c, ti, pi) {
    for (const level of unlockedLevels(c)) {
      if (seedCount(c, level) > 0 && !canPlant(c.farm, ti, pi, level)) return true;
    }
    return false;
  }

  // Droplets and the pour arc, both closed-form readers over the shared
  // effects machinery — no per-frame integration, so a dropped frame cannot
  // desync the watering can.
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
      const size = 15 * f.scale * (settings.fontScale || 1);
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
  // Reduced motion gets the soil darkening and nothing that flies: the wet
  // ground is the information, the arc is the pleasure.
  function pour(ti, pi) {
    if (getSettings().reducedMotion) return;
    const g = plotGeom(ti, pi, N);
    const th = farmThemeOf(getSettings());
    const t = performance.now();
    for (let i = 0; i < 10; i++) {
      const u = i / 10;
      fx.droplets.push({
        x: g.cx - g.w * 0.34, y: g.groundY - g.h * 0.95,
        vx: 40 + u * 26, vy: -30 + u * 20,
        r: 1.1 + (i % 3) * 0.5,
        color: i % 3 === 0 ? th.shimmer : th.stream,
        t0: t + u * POUR_MS * 0.5, life: POUR_MS,
      });
    }
  }

  function float(ti, pi, text, color) {
    const g = plotGeom(ti, pi, N);
    fx.floats.push({
      x: g.cx, y: g.groundY - g.h, t0: performance.now(), life: FX.floatMs * 1.3,
      text, scale: 1.1, color: color || null,
    });
  }

  // ── the one tap ────────────────────────────────────────────────────────

  // Which terrace wears the 出售 sign. Before the first appraisal there is no
  // farm and nothing is for sale; after it, the starter terrace is — and that
  // one sign IS the "buy the farm" beat, no dialog and no separate screen.
  function forSaleIndex(c) {
    if (!c.farm) return c.phase === 'buy-farm' ? 0 : null;
    return nextTerraceIndex(c.farm);
  }

  function onTap(clientX, clientY) {
    if (!live) return;
    panFrom = null;                 // a tap lands the camera at once
    const c = save.get();
    if (c.farm) evaluateFarm(c.farm, wallNow());
    const { x, y } = toWorld(clientX, clientY);

    // the 出售 sign first: it hangs over the terrace above, so it would
    // otherwise be shadowed by that terrace's plots
    const forSale = forSaleIndex(c);
    if (forSale != null && inBox(forSaleBox(forSale), x, y)) { showTerrace(forSale); return; }

    if (!c.farm) return;
    const hit = plotAtPoint(x, y, c.farm.terraces.length, N);
    if (!hit) return;
    tapPlot(hit.ti, hit.pi);
  }

  function tapPlot(ti, pi) {
    const c = save.get();
    const plot = plotAt(c.farm, ti, pi);
    if (!plot) return;

    if (isRipe(plot)) { doHarvest(ti, pi); return; }
    if (needsWater(c.farm, ti, pi, wallNow())) { doWater(ti, pi); return; }
    showPlot(ti, pi);                      // bare earth, or something to buy
  }

  function doHarvest(ti, pi) {
    const c = save.get();
    const picked = harvest(c.farm, ti, pi, wallNow());
    if (!picked) return;
    const got = harvestInto(c, picked, rng);
    sfx('harvest', { level: picked.level });
    float(ti, pi, `+${picked.count} ${FRUITS[picked.level - 1].hanzi}`);
    if (got && got.bonusSeed != null) {
      // the pineapple's golden hour: a seed falls out of the crown
      sfx('discover');
      float(ti, pi, `+1 ${FRUITS[got.bonusSeed - 1].hanzi} 种子`, '#f0a03c');
    }
    save.touch();
    refresh();
  }

  function doWater(ti, pi) {
    const c = save.get();
    const key = `${ti}:${pi}`;
    const t = performance.now();
    if (pouring.has(key) && t - pouring.get(key) < POUR_COOLDOWN_MS) return;
    if (!water(c.farm, ti, pi, wallNow())) return;
    pouring.set(key, t);
    pour(ti, pi);
    sfx('water');
    save.touch();
    refresh();
  }

  // ── the sheets ─────────────────────────────────────────────────────────
  // Bottom sheets the farm owns, not router screens: they are drawers over a
  // canvas that keeps drawing, in the same spirit as the discovery cards.

  function closeSheets() {
    openPlot = null;
    openTerrace = null;
    $('shop').hidden = true;
    $('plot').hidden = true;
  }

  function showPlot(ti, pi) {
    const c = save.get();
    const plot = plotAt(c.farm, ti, pi);
    openPlot = { ti, pi };
    openTerrace = null;
    $('shop').hidden = true;
    $('plot').hidden = false;
    buildPlotSheet(c, plot, ti, pi);
    paintCards();       // the sheet is up NOW, so its chips finally have a size
  }

  // The 出售 sheet. It sells one of two things depending on whether there is a
  // farm yet: the whole starter farm (a terrace, a young cherry tree and a few
  // strawberry seeds), or one more shelf up the mountain.
  function showTerrace(i) {
    const c = save.get();
    const first = !c.farm;
    const price = first ? priceOfEquipment('farm') : priceOfTerrace(i);
    openTerrace = i;
    openPlot = null;
    $('shop').hidden = true;
    $('plot').hidden = false;
    $('plot-title').textContent = first ? 'The farm 农场' : `Terrace ${i + 1} 梯田`;
    $('plot-note').textContent = first
      ? 'A weedy terrace with a young cherry tree, a strawberry bed halfway up, and a packet of seeds thrown in.'
      : 'A weedy shelf further up the mountain, going cheap.';
    $('plot-seeds').textContent = '';
    rows($('plot-rows'), [{
      label: first ? 'Buy the farm' : 'Buy this terrace', hanzi: '出售', price,
      can: first ? canBuyFarm(c) : canBuy(c.cash, price),
      go: () => {
        if (first) {
          if (!buyFarm(c, wallNow())) return;
        } else {
          if (!spend(c, price)) return;
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

  // What one plot can have done to it right now. Bare ground offers the seeds
  // the player actually holds; a growing plot offers the fertilizer; a bare
  // bench offers the trellis that would let a vine climb it.
  function buildPlotSheet(c, plot, ti, pi) {
    const ripe = isRipe(plot);
    $('plot-title').textContent = plot.kind
      ? `${FRUITS[plot.level - 1].hanzi} ${FRUITS[plot.level - 1].name}`
      : (plot.slot === 'tree' ? 'Bench 树位' : 'Bed 苗床');

    const seeds = $('plot-seeds');
    seeds.textContent = '';
    const options = [];

    if (!plot.kind) {
      $('plot-note').textContent = 'Bare earth. Plant something.';
      for (const level of unlockedLevels(c)) {
        const held = seedCount(c, level);
        if (held <= 0) continue;
        if (canPlant(c.farm, ti, pi, level)) continue;
        seeds.appendChild(seedCard(level, `×${held}`, true, () => {
          if (!takeSeed(c, level)) return;
          plant(c.farm, ti, pi, level, wallNow());
          sfx('plant', { level });
          save.touch();
          closeSheets();
          refresh();
        }));
      }
      if (!seeds.children.length) {
        $('plot-note').textContent = plot.slot === 'tree'
          ? 'Bare earth. No saplings in the drawer — the shop has them.'
          : 'Bare earth. No seeds in the drawer — the shop has them.';
      }
      if (plot.slot === 'tree' && !plot.trellis) {
        const price = priceOfEquipment('trellis');
        options.push({
          label: 'Build a trellis', hanzi: '棚架', price, can: canBuy(c.cash, price),
          note: 'Vines need one', go: () => {
            if (!spend(c, price)) return;
            buildTrellis(c.farm, ti, pi);
            sfx('buy');
            save.touch();
            showPlot(ti, pi);
            refresh();
          },
        });
      }
    } else if (!ripe) {
      const dry = needsWater(c.farm, ti, pi, wallNow());
      // A percentage is a number about the plot; a time is a number about the
      // player's evening. `msUntilRipe` is null exactly when the plot is not on
      // its way anywhere, which is the dry case the first branch already covers.
      const left = msUntilRipeAt(c.farm, ti, pi, wallNow());
      $('plot-note').textContent = dry || left == null
        ? 'Thirsty. Tap the plot to water it.'
        : `Growing — ready in ${countdown(left)}.`;
      const price = priceOfEquipment('fertilizer');
      options.push({
        label: 'Fertilize', hanzi: '肥料', price, can: canBuy(c.cash, price),
        note: 'Halves the time left', go: () => {
          if (!spend(c, price)) return;
          fertilize(c.farm, ti, pi, wallNow());
          sfx('buy');
          save.touch();
          showPlot(ti, pi);
          refresh();
        },
      });
    }
    rows($('plot-rows'), options);
  }

  function showShop() {
    const c = save.get();
    openPlot = null;
    openTerrace = null;
    $('plot').hidden = true;
    $('shop').hidden = false;
    buildShop(c);
    paintCards();
  }

  function buildShop(c) {
    $('shop-cash').textContent = String(c.cash);
    // The shop is reachable before the farm is bought (the farm screen is the
    // "buy the farm" beat), and there is nothing to sell someone with nowhere
    // to plant it. Seeds and equipment both wait for the ground.
    if (!c.farm) {
      $('shop-seeds').textContent = '';
      rows($('shop-kit'), [], 'Nothing to sell you yet — buy the farm first.');
      return;
    }

    const grid = $('shop-seeds');
    grid.textContent = '';
    for (const level of unlockedLevels(c)) {
      const price = priceOfSeed(level);
      const affordable = canBuy(c.cash, price);
      grid.appendChild(seedCard(level, `${price}元`, affordable, () => {
        if (!spend(c, price)) return;
        addSeeds(c, level, 1);
        sfx('buy');
        save.touch();
        buildShop(c);
        refresh();
      }, seedCount(c, level)));
    }

    // …and then the next few the player has not earned yet, as silhouettes. The
    // shop already greys what you cannot afford rather than hiding it, on the
    // grounds that seeing it is most of the reason to go and earn it — this is
    // the same argument one step further back, applied to what you cannot BUY
    // yet at all. The rule that unlocks them (merge one at market) was
    // previously discoverable only by accident.
    const locked = nextLockedLevels(c);
    for (const level of locked) grid.appendChild(lockedSeedCard(level));
    $('shop-locked-hint').hidden = locked.length === 0;
    showFarmStats();

    // Equipment: the things that stop the farm asking anything of the player.
    const kit = [];
    if (!c.farm.irrigation) {
      c.farm.terraces.forEach((terrace, ti) => {
        if (terrace.sprinkler) return;
        const price = priceOfEquipment('sprinkler');
        kit.push({
          label: `Sprinkler — terrace ${ti + 1}`, hanzi: '洒水器', price,
          can: canBuy(c.cash, price), note: 'Waters it forever',
          go: () => {
            if (!spend(c, price)) return;
            installSprinkler(c.farm, ti, wallNow());
            sfx('buy');
            save.touch();
            buildShop(c);
            refresh();
          },
        });
      });
      const price = priceOfEquipment('irrigation');
      kit.push({
        label: 'Stream irrigation', hanzi: '灌溉', price, can: canBuy(c.cash, price),
        note: 'The whole mountain, forever',
        go: () => {
          if (!spend(c, price)) return;
          installIrrigation(c.farm, wallNow());
          sfx('terrace-fanfare');
          save.touch();
          buildShop(c);
          refresh();
        },
      });
    }
    rows($('shop-kit'), kit, 'The stream runs through every terrace. Nothing here needs water again.');
  }

  // The next few levels the player has not earned the right to plant. Capped,
  // and that is the whole design of it: nine question marks read as a grind,
  // three read as almost-there.
  function nextLockedLevels(c) {
    const out = [];
    for (let level = 2; level <= MAX_LEVEL && out.length < LOCKED_PEEK; level++) {
      if (!isUnlocked(c, level)) out.push(level);
    }
    return out;
  }

  // A locked seed is a figure, not a button: there is nothing to click, so
  // there is nothing to tab to either. The chip painter draws the real fruit and
  // knows nothing about progress — style.css flattens it to a silhouette, the
  // same treatment (and the same class) the menu's collection chart uses.
  function lockedSeedCard(level) {
    const cell = document.createElement('figure');
    cell.className = 'seed-card locked';
    cell.innerHTML =
      '<canvas class="chip-art" role="img" aria-label="Undiscovered fruit"></canvas>' +
      '<span class="seed-hanzi">?</span>';
    cell.setAttribute('aria-label', 'Locked seed — merge one at market to earn it');
    cell.dataset.level = String(level);
    return cell;
  }

  // The campaign's own record, quietly, at the bottom of the drawer. Display
  // only — every one of these was already being banked by the market host, and
  // nothing new is counted to show them.
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

  // A seed as a chip card: the real fruit at its best, what it is called in both
  // languages, and the one number that matters here — its price in the shop, or
  // how many are in the drawer when the question is what to plant.
  //
  // It carries the bilingual name for the same reason the discovery cards do:
  // this is a game about learning eleven fruit, and the shop is where a player
  // spends the most time reading. The card also wears the fruit's OWN colour, as
  // a custom property the stylesheet mixes into the border and the wash — so the
  // grid reads as a row of specific fruit rather than a row of boxes, and the
  // one table that decides what a cherry looks like stays js/constants.js.
  //
  // Unaffordable cards are greyed, never hidden — seeing what you cannot afford
  // yet is most of the reason to go and earn it.
  function seedCard(level, meta, affordable, go, held) {
    const f = FRUITS[level - 1];
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = affordable ? 'seed-card' : 'seed-card off';
    cell.disabled = !affordable;
    cell.style.setProperty('--fruit', f.color);
    cell.innerHTML =
      '<canvas class="chip-art" role="img"></canvas>' +
      '<span class="seed-hanzi"></span><span class="seed-pinyin"></span>' +
      '<span class="seed-en"></span><span class="seed-price"></span>' +
      '<span class="seed-held"></span>';
    cell.querySelector('.seed-hanzi').textContent = f.hanzi;
    cell.querySelector('.seed-pinyin').textContent = f.pinyin;
    cell.querySelector('.seed-en').textContent = f.name;
    cell.querySelector('.seed-price').textContent = meta;
    cell.querySelector('.seed-held').textContent = held > 0 ? `×${held} held` : '';
    const art = cell.querySelector('.chip-art');
    art.setAttribute('aria-label', f.name);
    cell.setAttribute('aria-label', `${f.name} ${f.hanzi} ${f.pinyin}, ${meta}`);
    cell.addEventListener('click', go);
    // painted after append by the caller's parent being visible; see paintCards
    cell.dataset.level = String(level);
    return cell;
  }

  // Chip canvases measure 0 while their sheet is display:none, so every card is
  // painted only once its own sheet is actually up. The holder→sheet pairing is
  // written down rather than walked up the DOM: which sheet a grid belongs to is
  // a fact about this screen, not something to rediscover from markup nesting.
  const CARD_GRIDS = [['shop', 'shop-seeds'], ['plot', 'plot-seeds']];

  function paintCards() {
    for (const [sheet, grid] of CARD_GRIDS) {
      if ($(sheet).hidden) continue;
      for (const cell of $(grid).children) {
        paintChip(cell.querySelector('.chip-art'), Number(cell.dataset.level), 0.3);
      }
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
      el.querySelector('.row-price').textContent = row.price == null ? '—' : `${row.price}元`;
      el.addEventListener('click', row.go);
      holder.appendChild(el);
    }
  }

  // ── the opening pan ────────────────────────────────────────────────────

  // Where the camera is, in world units below where it settles. Closed-form off
  // the host clock like every other animation in this game, so a dropped frame
  // cannot leave the view stranded halfway up the mountain.
  function panOffset(tMs) {
    if (panFrom == null) return 0;
    const u = (tMs - panFrom) / PAN_MS;
    if (u >= 1) { panFrom = null; return 0; }
    if (u <= 0) return PAN_FROM;
    return PAN_FROM * (1 - u) * (1 - u) * (1 - u);      // ease out, and settle
  }

  function panUp() {
    if (getSettings().reducedMotion) return;   // the farm is simply there
    panFrom = performance.now();
  }

  function inBox(box, x, y) {
    return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  }

  // ── the HUD ────────────────────────────────────────────────────────────

  function refresh() {
    const c = save.get();
    if (c.farm) evaluateFarm(c.farm, wallNow());
    $('farm-cash').textContent = String(c.cash);
    $('crate-count').textContent = String(crateSize(c));
    $('to-shop').disabled = !c.farm;
    // The button glows once the crate is worth carrying down the hill — and it
    // asks the campaign whether the trip is possible rather than counting the
    // crate itself, so the most eye-catching thing on the screen can never be
    // a control that does nothing when tapped.
    const ready = canGoToMarket(c);
    $('to-market').classList.toggle('ready', ready);
    $('to-market').disabled = !ready;
    paintCards();
    if (live) loop.kick();
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  function enter() {
    live = true;
    resetEffects(fx);
    pouring.clear();
    closeSheets();
    const c = save.get();
    if (c.farm) {
      evaluateFarm(c.farm, wallNow());
      // A soft chime, once, for walking in on something ready to pick. It is a
      // greeting, never a summons: nothing sounds when nothing is ripe, and
      // nothing ever nags for staying away.
      if (eachPlot(c.farm).some(({ plot }) => isRipe(plot))) sfx('ripe-chime');
    }
    resize();
    refresh();
    loop.start();
  }

  function exit() {
    live = false;
    closeSheets();
    loop.stop();
    save.flushIfDirty();
  }

  // ── wiring ─────────────────────────────────────────────────────────────

  canvas.addEventListener('pointerup', (e) => {
    if (!live) return;
    if (!$('shop').hidden || !$('plot').hidden) { closeSheets(); return; }
    onTap(e.clientX, e.clientY);
  });

  $('to-shop').addEventListener('click', () => { sfx('menu-click'); showShop(); paintCards(); });
  $('shop-close').addEventListener('click', () => { sfx('menu-click'); closeSheets(); });
  $('plot-close').addEventListener('click', () => { sfx('menu-click'); closeSheets(); });

  return {
    enter, exit, resize, draw, refresh, panUp,
    // WP10's staging asks these: what is worth pointing a glint at.
    isLive: () => live,
    nextRipeMs: () => {
      const c = save.get();
      return c.farm ? msUntilNextRipe(c.farm, wallNow()) : null;
    },
  };
}

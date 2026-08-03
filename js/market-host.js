// The campaign's market day: the same board, the same physics, the same fruit —
// fed from a finite crate instead of the rng, with a way to stop on purpose and
// an appraisal at the end.
//
// It reuses js/render.js and js/game.js untouched. The only two things a
// campaign run needs that free play does not are a crate-backed spawn source
// (injected, js/game.js §drawFruit) and a held fruit that fits in the dropper
// when it is the size of a watermelon — both handled here, in the host, which
// is where the plan puts render configuration.
//
// EVERY ENDING IS A SALE. Toppling, packing up and selling out all land on the
// same appraisal sheet; the only difference is that the two deliberate ones
// earn the Tidy Stall bonus. There is no lose state on this screen.

import { FRUITS, MAX_LEVEL, PHYS } from './constants.js';
import {
  makeGame, start, tick, drop, aim, serialize, restore, inDanger, finish,
  isSoldOut, isSettled,
} from './game.js';
import { makeRenderer } from './render.js';
import { makeEffects, pushEvent, pruneEffects, resetEffects } from './effects.js';
import { deepestChain } from './progress.js';
import {
  drawFromCrate, crateSize, levelsIn, countOf, makeRunTally, noteMerges, rollSeedDrip,
  finishFirstRun, earn, canGoToMarket,
} from './campaign.js';
import { appraise, tidyBonusPercent } from './economy.js';
import { paintChip } from './chips.js';
import { sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);

// How long the host waits for the pile to stop rolling after the last fruit is
// dropped before it calls the day. `isSettled` usually fires long before this;
// the cap is for a pile that found a way to jiggle forever.
const SOLD_OUT_GRACE_MS = 4000;

// The appraisal lands its lines one at a time. Slow enough to read, fast enough
// that nobody taps through it — and under reduced motion they all simply arrive.
const LINE_MS = 420;
const COIN_MS = 900;

// Big fruit in the dropper (a crate may hold anything up to a watermelon) is
// drawn scaled-to-fit over a true-size ring, so a held pear does not read as a
// board already lost. That lives in js/render.js — it is a drawing rule, and
// free play can never reach it.

export function makeMarketHost({ canvas, router, save, getSettings, rng, loop, session, onDone }) {
  const R = makeRenderer(canvas);
  const fx = makeEffects();

  let g = null;
  let tally = makeRunTally();
  let saveDirty = false;
  let saveTimer = null;
  let soldOutAt = null;
  let wasInDanger = false;
  let live = false;

  // ── the crate-backed dropper ───────────────────────────────────────────
  // One draw function for the life of the host; it reads whatever crate the
  // campaign currently has, so a restored run picks up the crate its save
  // carried without rebuilding the game.
  function drawFruit() {
    return drawFromCrate(save.get().crate, rng);
  }

  function ensureGame() {
    if (!g) g = makeGame({ rng, now: () => performance.now(), drawFruit });
    return g;
  }

  // ── starting and resuming ──────────────────────────────────────────────

  function begin() {
    const c = save.get();
    if (!canGoToMarket(c)) return false;
    ensureGame();
    resetEffects(fx);
    tally = makeRunTally();
    soldOutAt = null;
    wasInDanger = false;
    start(g);
    g.events.length = 0;
    save.touch();
    saveDirty = true;
    return true;
  }

  // A mid-run board out of `market-save`. The crate is already in the campaign
  // state (it was decremented at draw time), so all that rides here is the
  // board and the run's own tally.
  function resume() {
    const raw = save.readMarket();
    if (!raw || !raw.board) return false;
    ensureGame();
    resetEffects(fx);
    if (!restore(g, raw.board)) { save.clearMarket(); return false; }
    tally = restoreTally(raw.tally);
    soldOutAt = null;
    wasInDanger = inDanger(g);
    return true;
  }

  function restoreTally(raw) {
    const t = makeRunTally();
    if (!raw || typeof raw !== 'object') return t;
    if (Array.isArray(raw.unlockedThisRun)) {
      for (const level of raw.unlockedThisRun) {
        if (Number.isInteger(level) && level >= 2 && level <= MAX_LEVEL) t.unlockedThisRun.push(level);
      }
    }
    if (raw.dripEligible && typeof raw.dripEligible === 'object') {
      for (const key of Object.keys(raw.dripEligible)) {
        const level = Number(key);
        const n = raw.dripEligible[key];
        if (Number.isInteger(level) && level >= 2 && level <= MAX_LEVEL
          && Number.isInteger(n) && n > 0 && n <= 99999) t.dripEligible[level] = n;
      }
    }
    return t;
  }

  function packTally() {
    const out = { unlockedThisRun: tally.unlockedThisRun.slice(), dripEligible: {} };
    for (const level of levelsIn(tally.dripEligible)) out.dripEligible[level] = countOf(tally.dripEligible, level);
    return out;
  }

  function flushBoard() {
    if (!g || g.state !== 'playing') return;
    save.writeMarket({ v: 1, board: serialize(g), tally: packTally() });
    saveDirty = false;
  }

  // ── the HUD ────────────────────────────────────────────────────────────

  function refreshHud() {
    if (!g) return;
    $('m-score').textContent = String(g.score);
    const label = $('m-next-label');
    if (g.next == null) {
      label.textContent = crateSize(save.get()) > 0 ? '' : 'Sold out 卖完了';
      clearCanvas($('m-next'));
    } else {
      const f = FRUITS[g.next - 1];
      label.textContent = `${f.hanzi} ${f.name}`;
      paintChip($('m-next'), g.next, 0.34);
    }
    buildCrateStrip();
    refreshPackUp();
  }

  // "Pack up 收摊" is the smart play and reads as the cowardly one, so once
  // there is a bonus to be had the button says what it pays. Asked of the same
  // appraisal that will pay it, rather than of a rule written twice — a run
  // worth nothing yet advertises nothing.
  function refreshPackUp() {
    const earned = appraise({
      score: g.score,
      boardLevels: g.bodies.map((b) => b.level),
      reason: 'packed',
    }).tidyBonus;
    $('pack-up').textContent = earned > 0
      ? `Pack up 收摊 +${tidyBonusPercent()}%`
      : 'Pack up 收摊';
  }

  function clearCanvas(el) {
    const c = el.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, el.width, el.height);
  }

  // What is left to sell, as chips with counts. It is the run's whole clock:
  // the crate emptying IS the timer, and it has to be legible at a glance.
  function buildCrateStrip() {
    const holder = $('crate-strip');
    const crate = save.get().crate;
    holder.textContent = '';
    for (const level of levelsIn(crate)) {
      const cell = document.createElement('figure');
      cell.className = 'crate-chip';
      const art = document.createElement('canvas');
      art.className = 'chip-art';
      art.setAttribute('role', 'img');
      art.setAttribute('aria-label', FRUITS[level - 1].name);
      const cap = document.createElement('figcaption');
      cap.textContent = `×${countOf(crate, level)}`;
      cell.append(art, cap);
      holder.appendChild(cell);
      paintChip(art, level, 0.3);
    }
  }

  // ── the run ────────────────────────────────────────────────────────────

  function frame(deltaMs) {
    if (!g) return;
    const settings = getSettings();
    const FIXED = 1 / 60 / PHYS.substeps;
    let acc = Math.min(deltaMs / 1000, PHYS.maxDt);
    while (acc > 0) { tick(g, FIXED); acc -= FIXED; }

    const tNow = performance.now();
    let hudStale = false;
    let ended = null;
    for (const ev of g.events) {
      if (ev.type === 'drop') { sfx('drop', { level: ev.level }); hudStale = true; saveDirty = true; }
      else if (ev.type === 'merge') {
        sfx(ev.level === MAX_LEVEL ? 'watermelon' : 'merge', { level: ev.level });
        if (ev.chain > 1) sfx('chain', { chain: ev.chain });
        hudStale = true; saveDirty = true;
      } else if (ev.type === 'annihilate') { sfx('annihilate'); hudStale = true; saveDirty = true; }
      else if (ev.type === 'gameover') { ended = ev.reason || 'toppled'; }
      pushEvent(fx, ev, tNow, settings.reducedMotion);
    }

    const chain = deepestChain(g.events);
    if (chain >= 3) onChain(chain);
    // First campaign make of a level: the right to plant it, celebrated with
    // the discovery-card idiom and a different kicker. Detected live so the
    // card lands on the merge, not at the till.
    const unlocked = noteMerges(save.get(), tally, g.events);
    if (unlocked.length) { save.touch(); onUnlock(unlocked); }
    g.events.length = 0;

    const danger = g.state === 'playing' && inDanger(g);
    if (danger && !wasInDanger) sfx('warning');
    wasInDanger = danger;

    // Sold out: the crate and both hands are empty. Wait for the pile to stop
    // rolling — a fruit still in the air might yet merge, and closing the stall
    // mid-chain would rob the player of the score.
    if (g.state === 'playing' && isSoldOut(g)) {
      if (soldOutAt == null) soldOutAt = tNow;
      if (isSettled(g) || tNow - soldOutAt > SOLD_OUT_GRACE_MS) finish(g, 'sold-out');
    } else {
      soldOutAt = null;
    }

    if (hudStale) refreshHud();
    if (ended) { closeStall(ended); return; }

    if (saveDirty && !saveTimer) {
      saveTimer = session.setTimeout(() => { saveTimer = null; flushBoard(); }, 1000);
    }

    pruneEffects(fx, tNow);
    R.draw(g, settings, tNow, fx);
  }

  // ── the appraisal ──────────────────────────────────────────────────────

  function closeStall(reason) {
    live = false;
    loop.stop();
    if (saveTimer) { saveTimer.cancel(); saveTimer = null; }
    save.clearMarket();

    const c = save.get();
    const isFirstRun = c.phase === 'gift-run';
    const bill = appraise({
      score: g.score,
      boardLevels: g.bodies.map((b) => b.level),
      reason,
      isFirstRun,
    });

    // Seeds found in the till: the run's drip, rolled once, here, so it batches
    // into one line instead of dribbling out mid-run.
    const found = rollSeedDrip(c, tally, rng);
    if (isFirstRun) finishFirstRun(c, bill.total);
    else earn(c, bill.total);
    save.touch();
    save.flush();

    if (g.score > 0) {
      // The campaign's own lane: score is still arcade pride, it just does not
      // compete with free play's board.
      Arcade.scores.add('campaign', { score: g.score });
    }
    Arcade.stats.update('farm', (prev) => {
      const p = prev || {};
      return {
        marketDays: (p.marketDays || 0) + 1,
        earned: (p.earned || 0) + bill.total,
        packedUp: (p.packedUp || 0) + (reason === 'packed' ? 1 : 0),
        soldOut: (p.soldOut || 0) + (reason === 'sold-out' ? 1 : 0),
      };
    });

    sfx(reason === 'toppled' ? 'game-over' : 'pack-up');
    router.route('appraisal');
    showAppraisal(bill, reason, found);
  }

  function showAppraisal(bill, reason, found) {
    const settings = getSettings();
    const still = !!settings.reducedMotion;
    const dl = $('appraisal-lines');
    dl.textContent = '';
    $('appraisal-total').textContent = '0';

    const lines = [['Merges 合并', bill.runScore]];
    if (bill.boardValue > 0) lines.push(['On the counter 摊上', bill.boardValue]);
    if (bill.tidyBonus > 0) lines.push(['Tidy stall 收摊整齐', bill.tidyBonus]);
    if (bill.floorTopUp > 0) lines.push(['A good start 开门红', bill.floorTopUp]);

    lines.forEach(([label, value], i) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = `+${value}`;
      row.append(dt, dd);
      if (!still) {
        row.classList.add('landing');
        row.style.animationDelay = `${i * LINE_MS}ms`;
      }
      dl.appendChild(row);
    });

    const seedLevels = levelsIn(found);
    $('appraisal-seeds').hidden = seedLevels.length === 0;
    const chips = $('appraisal-seed-chips');
    chips.textContent = '';
    for (const level of seedLevels) {
      const cell = document.createElement('figure');
      cell.className = 'seed-card';
      const art = document.createElement('canvas');
      art.className = 'chip-art';
      art.setAttribute('role', 'img');
      art.setAttribute('aria-label', FRUITS[level - 1].name);
      const cap = document.createElement('figcaption');
      cap.textContent = `×${countOf(found, level)}`;
      cell.append(art, cap);
      chips.appendChild(cell);
      paintChip(art, level, 0.3);
    }

    countTo(bill.total, still ? 0 : lines.length * LINE_MS + COIN_MS);
  }

  // The total counts up with the coin cue rather than appearing — the one
  // number the whole run was for.
  function countTo(total, ms) {
    const el = $('appraisal-total');
    if (ms <= 0) { el.textContent = String(total); sfx('till'); return; }
    const t0 = performance.now();
    let last = -1;
    const stepTimer = { cancelled: false };
    const step = () => {
      if (stepTimer.cancelled) return;
      const u = Math.min(1, (performance.now() - t0) / ms);
      const value = Math.round(total * (1 - (1 - u) * (1 - u)));
      if (value !== last) {
        el.textContent = String(value);
        if (value > last) sfx('coin');
        last = value;
      }
      if (u < 1) session.setTimeout(step, 60);
      else sfx('till');
    };
    session.setTimeout(step, 60);
  }

  // ── celebration hooks (filled in by the boot wiring) ───────────────────
  let onChain = () => {};
  let onUnlock = () => {};

  // ── lifecycle ──────────────────────────────────────────────────────────

  function enter() {
    live = true;
    R.resize();
    refreshHud();
    loop.start();
    canvas.focus();
  }

  function exit() {
    live = false;
    loop.stop();
    if (saveDirty) flushBoard();
    if (saveTimer) { saveTimer.cancel(); saveTimer = null; }
  }

  // Input: the same gestures as free play, on the same canvas. Bound by the
  // boot wiring through js/input.js so both modes cannot disagree about what a
  // drag means.
  function game() { return g; }

  return {
    begin, resume, enter, exit, game, frame, refreshHud,
    resize: () => R.resize(),
    flush: () => { if (saveDirty) flushBoard(); },
    isLive: () => live,
    setHooks(h) { onChain = h.onChain || onChain; onUnlock = h.onUnlock || onUnlock; },
    finishRun: (reason) => { if (g && g.state === 'playing') finish(g, reason); },
    hasResumableRun: () => !!save.readMarket(),
    done: () => onDone && onDone(),
    aimAt: (x) => g && aim(g, x),
    dropAt: (x) => g && drop(g, x),
  };
}

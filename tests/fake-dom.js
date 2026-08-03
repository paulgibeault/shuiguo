// A DOM and an Arcade small enough to boot the game under `node --test`.
//
// The three hosts are ~1200 lines of wiring — element ids, router hooks, save
// keys, Arcade calls — and none of it is reachable by a pure-module test. The
// failures that wiring actually has are dull and total: a typo'd id, a function
// used above its `const`, a save written to the wrong key, a host that keeps
// drawing after it left the screen. All of them are caught by simply booting.
//
// So this is not a DOM. It is the smallest object graph that lets js/main.js
// run to completion and then be poked at: elements are created on demand from
// the ids index.html actually declares, canvases hand out a recording stub
// context, and Arcade is an in-memory store with hooks the test can fire.
//
// It is deliberately NOT jsdom: a dependency for this would be a bigger risk
// than the thing it is testing, and everything below is behaviour this game
// genuinely relies on rather than a general-purpose emulation.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every id index.html declares. Asking for one it does NOT declare is a test
// failure rather than a silent null — a typo'd getElementById is exactly the
// class of bug this file exists to catch.
export function declaredIds() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
}

// `texts` collects every string actually painted on the canvas, which is the
// only way a test can read a score float — the effects list is host-private and
// the renderer is a pure reader of it. What a popup SAYS is behaviour (WP-H
// makes campaign floats speak 元), so it needs to be observable.
function makeCtx(calls, texts) {
  const noop = () => {};
  const rec = (name) => () => calls.push(name);
  const recText = () => (s) => { calls.push('text'); texts.push(String(s)); };
  return {
    canvas: null,
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, clip: noop,
    setTransform: noop, resetTransform: noop, setLineDash: noop, clearRect: rec('clear'),
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, arc: noop, ellipse: noop, rect: noop,
    fillRect: rec('fill'), strokeRect: rec('stroke'),
    fill: rec('fill'), stroke: rec('stroke'),
    fillText: recText(), strokeText: recText(),
    measureText: () => ({ width: 10 }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
  };
}

class El {
  constructor(tag, doc) {
    this.tagName = String(tag || 'div').toUpperCase();
    this._doc = doc;
    this.children = [];
    this.parent = null;
    this.hidden = false;
    this.disabled = false;
    this.dataset = {};
    // Enough of CSSStyleDeclaration for the hosts: named properties assigned
    // directly (`el.style.animationDelay = …`) and custom properties set through
    // the API, which is the only way to reach a `--var` on a real element.
    this.style = {
      setProperty(name, value) { this[name] = value; },
      getPropertyValue(name) { return this[name] == null ? '' : this[name]; },
    };
    this.attrs = {};
    this.listeners = new Map();
    this.drawCalls = [];
    this.drawnText = [];
    this._classes = new Set();
    this._text = '';
    this.width = 0;
    this.height = 0;
    // Chip canvases scale their backing store from the CSS size, so they must
    // report one — a 0-wide canvas is the real bug this stands in for.
    this.clientWidth = 44;
    this.offsetWidth = 44;
  }

  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }

  get classList() {
    const set = this._classes;
    return {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      contains: (c) => set.has(c),
      toggle: (c, on) => { if (on === undefined ? set.has(c) : !on) set.delete(c); else set.add(c); },
    };
  }

  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }

  set textContent(v) {
    this.children.forEach((c) => { c.parent = null; });
    this.children = [];
    this._text = v == null ? '' : String(v);
  }

  // Enough of innerHTML for the four literal templates this game builds:
  // create one child per tag, carrying its class, so querySelector('.x') finds
  // it. No parsing beyond that, and none needed.
  set innerHTML(html) {
    this.textContent = '';
    for (const m of String(html).matchAll(/<(\w+)([^>]*)>/g)) {
      const child = this._doc.createElement(m[1]);
      const cls = /class="([^"]+)"/.exec(m[2]);
      if (cls) child.className = cls[1];
      this.appendChild(child);
    }
  }
  get innerHTML() { return ''; }

  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  append(...kids) { kids.forEach((k) => this.appendChild(k)); }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }

  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }
  focus() {}

  querySelector(sel) {
    const want = sel.replace(/^\./, '');
    const walk = (el) => {
      for (const c of el.children) {
        if (c._classes.has(want) || c.tagName === sel.toUpperCase()) return c;
        const deep = walk(c);
        if (deep) return deep;
      }
      return null;
    };
    return walk(this);
  }

  closest(sel) {
    const want = sel.replace(/^\./, '');
    let el = this;
    while (el) {
      if (el._classes.has(want) || el.id === want) return el;
      el = el.parent;
    }
    return null;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  setPointerCapture() {}

  /** Fire a listener as the browser would. Returns how many ran. */
  fire(type, event = {}) {
    const fns = this.listeners.get(type) || [];
    const ev = { preventDefault() {}, clientX: 0, clientY: 0, pointerId: 1, ...event };
    for (const fn of fns) fn(ev);
    return fns.length;
  }

  getContext() {
    if (!this._ctx) this._ctx = makeCtx(this.drawCalls, this.drawnText);
    return this._ctx;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 360, height: 560, right: 360, bottom: 560 };
  }
}

export function makeDom() {
  const ids = declaredIds();
  const byId = new Map();
  const doc = {
    createElement(tag) { return new El(tag, doc); },
    getElementById(id) {
      if (!ids.has(id)) throw new Error(`getElementById('${id}') — no such id in index.html`);
      if (!byId.has(id)) {
        const el = new El(id.includes('next') || id === 'board' ? 'canvas' : 'div', doc);
        el.id = id;
        byId.set(id, el);
      }
      return byId.get(id);
    },
  };
  return { doc, byId, ids, El };
}

// An Arcade that records everything, so a test can ask what a mode wrote.
export function makeArcade({ state = {}, stats = {}, records = {}, settings = {} } = {}) {
  const hooks = { suspend: [], resume: [], settings: [], replaced: [] };
  const loops = [];
  const timers = [];
  const scores = [];
  const store = { ...state };
  const statStore = { ...stats };
  // The frame clock, and the one performance.now() the booted game sees.
  //
  // Every rule in the game that is measured in wall time — the drop cooldown,
  // the deadline's three seconds, the combo window, the sold-out grace — reads
  // performance.now(). Against the real one, a test either sleeps for real or
  // cannot reach the rule at all, and the loop's 16ms deltas disagree with the
  // clock the same loop's game is checking itself against. So it advances with
  // the frames instead: one tick is one 16ms frame, in the sim and on the wall.
  let clock = 0;

  const arcade = {
    ready: Promise.resolve(),
    init() {},
    writes: [],            // every state key ever written, in order
    removes: [],
    scores: {
      lanes: scores,
      add(lane, entry) { scores.push({ lane, ...entry }); },
    },
    records: {
      get(id) { return records[id] || null; },
      best(id, r) { records[id] = r; },
      all: records,
    },
    stats: {
      get(k) { return statStore[k]; },
      update(k, fn) { statStore[k] = fn(statStore[k]); },
      store: statStore,
    },
    state: {
      get(k) { return store[k]; },
      set(k, v) { arcade.writes.push(k); store[k] = v; },
      remove(k) { arcade.removes.push(k); delete store[k]; },
      store,
    },
    settings: {
      theme: () => settings.theme || 'light',
      fontScale: () => settings.fontScale || 1,
      reducedMotion: () => !!settings.reducedMotion,
    },
    session: {
      setTimeout(fn, ms) {
        const t = { fn, ms, cancelled: false, cancel() { this.cancelled = true; } };
        timers.push(t);
        return t;
      },
      timers,
    },
    loop(fn) {
      const l = {
        fn, running: false, kicks: 0,
        start() { l.running = true; },
        stop() { l.running = false; },
        kick() { l.kicks++; clock += 16; fn(16); },
      };
      loops.push(l);
      return l;
    },
    loops,
    onSuspend(fn) { hooks.suspend.push(fn); },
    onResume(fn) { hooks.resume.push(fn); },
    onSettingsChange(fn) { hooks.settings.push(fn); },
    onStateReplaced(fn) { hooks.replaced.push(fn); },
    hooks,
    // test helpers
    fire(which) { for (const fn of hooks[which]) fn(); },
    now() { return clock; },
    /** Pass time without drawing a frame — for a rule the player waits out. */
    advance(ms) { clock += ms; return clock; },
    tick(n = 1) {
      for (let i = 0; i < n; i++) {
        clock += 16;
        for (const l of loops) if (l.running) l.fn(16);
      }
    },
    runTimers() {
      const due = timers.splice(0, timers.length);
      for (const t of due) if (!t.cancelled) t.fn();
    },
  };
  return arcade;
}

/**
 * Install the fakes as globals and boot js/main.js.
 *
 * Returns everything a test needs to poke at the running game. Import is
 * cache-busted per boot so each test gets a game that has never been played.
 */
export async function bootGame(opts = {}) {
  const { doc, byId, ids } = makeDom();
  const arcade = makeArcade(opts);

  globalThis.document = doc;
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, Arcade: arcade };
  globalThis.Arcade = arcade;
  globalThis.performance = { now: () => arcade.now() };

  const url = new URL('../js/main.js', import.meta.url);
  url.searchParams.set('boot', String(bootGame.n = (bootGame.n || 0) + 1));
  await import(url.href);

  return { doc, byId, ids, arcade, $: (id) => doc.getElementById(id) };
}

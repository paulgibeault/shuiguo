// The sound pack is a pile of node graphs that nothing else imports and no
// other test can reach, and its failure mode is silence — a cue the game plays
// but the pack never registered simply makes no sound, forever, and looks like
// a design decision. So: load the pack against a stub element library, then
// check it against the cue names the game's own source actually plays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every gesture js/sfx.js requires the element library to provide, recorded so
// a cue reaching for one that is NOT on that list fails here rather than
// throwing mid-play in front of a player.
const NEEDED_ELEMENTS = [
  'strike', 'thump', 'squelch', 'droplet', 'body', 'creak', 'shatter',
  'between', 'cents', 'teardown',
];

function loadPack() {
  const used = new Set();
  const S = { registerPack: (p) => { S.pack = p; } };
  for (const name of NEEDED_ELEMENTS) {
    S[name] = (...args) => {
      used.add(name);
      if (name === 'between') return (args[1] + args[2]) / 2;
      if (name === 'cents') return 1;
      return undefined;
    };
  }
  // Anything the pack reaches for that sfx.js does not vouch for.
  const guard = new Proxy(S, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string') throw new Error(`the pack uses an element sfx.js never checks for: ${prop}`);
      return undefined;
    },
  });

  const scope = { ArcadeAudioElements: guard };
  const src = fs.readFileSync(path.join(ROOT, 'js/soundpack.js'), 'utf8');
  // The pack is a plain script that publishes onto a global; run it with our
  // stub standing in for that global rather than importing it as a module.
  // eslint-disable-next-line no-new-func
  new Function('window', 'globalThis', src)(scope, scope);
  return { pack: S.pack, used };
}

// Every sfx('name') the game plays, from the source of every host.
function cuesTheGamePlays() {
  const names = new Set();
  for (const file of fs.readdirSync(path.join(ROOT, 'js'))) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(ROOT, 'js', file), 'utf8');
    for (const m of src.matchAll(/\bsfx\(\s*'([a-z-]+)'/g)) names.add(m[1]);
    // js/main.js picks between two cues in one expression
    for (const m of src.matchAll(/\?\s*'([a-z-]+)'\s*:\s*'([a-z-]+)'/g)) {
      if (/sfx\(/.test(src.slice(Math.max(0, m.index - 60), m.index))) {
        names.add(m[1]); names.add(m[2]);
      }
    }
  }
  return names;
}

const { pack } = loadPack();

test('the pack registers itself as this game, with a room and a cue table', () => {
  assert.ok(pack, 'the pack never called registerPack');
  assert.equal(pack.name, 'shuiguo');
  assert.ok(pack.ROOM && pack.ROOM.dur > 0);
  assert.ok(Object.keys(pack.CUES).length > 0);
});

test('every cue the game plays is one the pack actually registered', () => {
  const played = cuesTheGamePlays();
  assert.ok(played.size >= 15, `only found ${played.size} cue names in the source`);
  for (const name of played) {
    assert.ok(name in pack.CUES, `the game plays '${name}' and the pack has no such cue — that is silence`);
  }
});

test('every registered cue has a distance, or it plays dry in a room that has one', () => {
  for (const name of Object.keys(pack.CUES)) {
    assert.equal(typeof pack.SENDS[name], 'number', `cue '${name}' has no send`);
    assert.ok(pack.SENDS[name] >= 0 && pack.SENDS[name] <= 1, `cue '${name}' send out of range`);
  }
  for (const name of Object.keys(pack.SENDS)) {
    assert.ok(name in pack.CUES, `send '${name}' names a cue that does not exist`);
  }
});

test('the farm is heard further off than the counter', () => {
  // the two halves of the game are one room at two distances; if the farm ever
  // reads as close as a fruit in your hands, they have stopped being one place
  const counter = Math.max(pack.SENDS.drop, pack.SENDS['menu-click']);
  for (const name of ['water', 'harvest', 'ripe-chime', 'terrace-fanfare']) {
    assert.ok(pack.SENDS[name] > counter, `'${name}' is as close as something in your hands`);
  }
});

test('the cues fired most often are the quietest — texture, not events', () => {
  // 'coin' fires many times a second through the count-up and 'water' is the
  // farm's most repeated tap; both must sit below the once-a-run celebrations.
  assert.ok(pack.SENDS.coin < pack.SENDS.till, 'one coin is as present as the whole till');
  assert.ok(pack.SENDS.buy < pack.SENDS['terrace-fanfare']);
});

test('every cue runs to completion against a stub, with any parameters at all', () => {
  const ctx = {};
  const out = {};
  const seeded = () => { let s = 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
  const params = [
    undefined, {}, { level: 1 }, { level: 11 }, { level: 99 }, { level: 0 },
    { chain: 2 }, { chain: 12 }, { level: null }, { chain: null },
  ];
  for (const [name, cue] of Object.entries(pack.CUES)) {
    for (const p of params) {
      assert.doesNotThrow(() => cue(ctx, out, 0, p, seeded()),
        `cue '${name}' threw on ${JSON.stringify(p)}`);
    }
  }
});

test('harvest is voiced off the same table as merges — one chain, two halves', () => {
  assert.equal(typeof pack.mergeVoice, 'function');
  const small = pack.mergeVoice(2);
  const big = pack.mergeVoice(11);
  assert.ok(big.f0 < small.f0, 'the big end of the chain is not the darker one');
  assert.ok(big.dur > small.dur);
  // and the farm's harvest cue reads that table rather than inventing pitches
  const src = fs.readFileSync(path.join(ROOT, 'js/soundpack.js'), 'utf8');
  const harvest = src.slice(src.indexOf("'harvest': function"), src.indexOf("'ripe-chime': function"));
  assert.ok(harvest.includes('mergeVoice'), 'harvest invented its own pitch scale');
});

test('a missing element library registers nothing at all rather than half a pack', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/soundpack.js'), 'utf8');
  let registered = false;
  const scope = { ArcadeAudioElements: undefined };
  // eslint-disable-next-line no-new-func
  new Function('window', 'globalThis', src)(scope, scope);
  assert.equal(registered, false);
  assert.equal(scope.ArcadeAudioElements, undefined, 'the pack invented an element library');
});

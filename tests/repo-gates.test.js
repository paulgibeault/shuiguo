// Source-level fleet gates: every tracked JS/JSON parses, the vendored rng is
// byte-identical in behavior (known-answer vectors), and sw.js keeps the
// exact APP_VERSION line-shape fleet CI rewrites — if that shape drifts, CI's
// sed silently stops firing and deploys freeze the cache identity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../js/arcade-rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = execSync('git ls-files -z', { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);

test('every tracked JSON file parses', () => {
  for (const f of files.filter((f) => f.endsWith('.json'))) {
    JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  }
});

test('every tracked JS file parses', () => {
  for (const f of files.filter((f) => /\.(js|mjs)$/.test(f))) {
    // syntax-only: node --check handles scripts and modules alike, and never
    // executes (a DOM module would throw at run time, which isn't this gate)
    execSync(`node --check ${JSON.stringify(path.join(ROOT, f))}`, { stdio: 'pipe' });
  }
});

test('vendored arcade-rng matches the canonical algorithm (known-answer)', () => {
  const rng = makeRng(42);
  assert.equal(rng(), 0.6011037519201636);
  assert.equal(rng(), 0.44829055899754167);
  assert.equal(rng(), 0.8524657934904099);
});

test("sw.js keeps the CI-rewritable version line and this game's id", () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /^const APP_VERSION = '\d+\.\d+\.\d+';$/m, 'anchored, single-quoted APP_VERSION');
  assert.match(sw, /^const GAME_ID = 'shuiguo';/m);
  assert.ok(sw.includes('arcade:sw.skipWaiting'), 'launcher-mediated activation handler present');
});

test('gameId is consistent across manifest, sw, and index.html', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.scope, '/shuiguo/');
  // start_url is CI-owned: fleet-ci's version_bump rewrites it to a
  // cache-busted './index.html?v=<version>' on every deploy (that is the
  // documented point of the input). Pinning the literal string made this gate
  // fail on the bump commit itself. What identity actually depends on is that
  // start_url resolves INSIDE the scope — assert that, and leave the
  // cache-buster to CI.
  const resolved = new URL(manifest.start_url, `https://example.invalid${manifest.scope}`);
  assert.ok(
    resolved.pathname.startsWith(manifest.scope),
    `start_url ${manifest.start_url} resolves to ${resolved.pathname}, outside scope ${manifest.scope}`,
  );
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(index, /Arcade\.init\(\{ gameId: 'shuiguo' \}\)/);
  assert.match(index, /src="\/arcade-sdk\.js"/, 'evergreen SDK alias');
  assert.match(index, /scope: '\/shuiguo\/'/);
});

// GAME_INTEGRATION §6d, as a source gate. An infinite CSS animation is a rAF
// loop that never stops, expressed declaratively — it is the one way a game
// that is doing everything else right still keeps the compositor awake on a
// screen nobody is touching. There is no `infinite` in this stylesheet, and
// the one looping effect that used to be reads its budget off the launcher's
// token instead, with a `var()` fallback so it never depends on the SDK
// having shipped it.
test('style.css has no infinite animation, and the pulse takes the launcher\'s count', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  // Declarations only — the comment above the pulse explains the rule, and a
  // gate that cannot tell an explanation from a violation is not a gate.
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /animation[^;{}]*\binfinite\b/,
    'an infinite animation is back — see GAME_INTEGRATION §6d');
  assert.match(css, /animation-iteration-count:\s*var\(--arcade-pulse-count,\s*3\)/,
    'the crate pulse stopped reading --arcade-pulse-count (or lost its fallback)');
  // …and a counted pulse is only safe if what it was saying survives it.
  assert.match(css, /\.crate-dock:has\(\.crate-strip\.pulse\)/,
    'the gift crate has no static resting treatment to settle into');
});

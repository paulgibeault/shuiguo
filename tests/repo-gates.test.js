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

test('every tracked JS file parses', async () => {
  for (const f of files.filter((f) => /\.(js|mjs)$/.test(f))) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    // new Function only accepts scripts; modules get a syntax-only import check
    if (/^\s*(import|export)\s/m.test(src)) {
      await import(path.join(ROOT, f)).catch((e) => {
        // browser-only modules fail on missing DOM at RUN time; a SyntaxError
        // is the only failure this gate is about
        if (e instanceof SyntaxError) throw e;
      });
    } else {
      new Function(src);   // eslint-disable-line no-new-func
    }
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
  assert.ok(!/skipWaiting\(\)/.test(sw.split('arcade:sw.skipWaiting')[0].split('install')[1] || ''), 'no skipWaiting on install');
});

test('gameId is consistent across manifest, sw, and index.html', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.scope, '/shuiguo/');
  assert.equal(manifest.start_url, '/shuiguo/');
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(index, /Arcade\.init\(\{ gameId: 'shuiguo' \}\)/);
  assert.match(index, /src="\/arcade-sdk\.js"/, 'evergreen SDK alias');
  assert.match(index, /scope: '\/shuiguo\/'/);
});

// The fruit table IS the game spec — pin it so a casual edit can't silently
// reshape scoring or sizes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRUITS, FACES, MAX_LEVEL, MAX_SPAWN_LEVEL, ANNIHILATE_SCORE, radiusOf, scoreOf, bounceOf, WORLD } from '../js/constants.js';

test('eleven fruit levels, cherry through watermelon', () => {
  assert.equal(MAX_LEVEL, 11);
  assert.equal(FRUITS[0].name, 'Cherry');
  assert.equal(FRUITS[10].name, 'Watermelon');
});

test('scores double up the chain: 1,2,4,...,1024; annihilation continues it', () => {
  FRUITS.forEach((f, i) => assert.equal(f.score, 2 ** i, f.name));
  assert.equal(ANNIHILATE_SCORE, 2048);
});

test('radii grow strictly and follow the GRD relative scale', () => {
  const expected = [1.0, 1.4, 1.8, 2.2, 2.6, 3.0, 3.5, 4.0, 4.6, 5.2, 6.0];
  FRUITS.forEach((f, i) => assert.equal(f.scale, expected[i], f.name));
  for (let l = 2; l <= MAX_LEVEL; l++) assert.ok(radiusOf(l) > radiusOf(l - 1));
});

test('every fruit has a bounce personality; big fruit never out-bounces small', () => {
  FRUITS.forEach((f) => {
    assert.equal(typeof f.bounce, 'number', f.name);
    assert.ok(f.bounce > 0 && f.bounce < 1, `${f.name} bounce ${f.bounce} in (0,1)`);
    assert.equal(bounceOf(FRUITS.indexOf(f) + 1), f.bounce);
  });
  for (let l = 2; l <= MAX_LEVEL; l++) {
    assert.ok(bounceOf(l) <= bounceOf(l - 1), `${FRUITS[l - 1].name} is not bouncier than its parent`);
  }
  assert.ok(bounceOf(1) > bounceOf(MAX_LEVEL) * 2, 'the cherry/watermelon contrast is legible');
});

test('every fruit carries its whole palette — the painter has no hex of its own', () => {
  for (const f of FRUITS) {
    for (const k of ['color', 'rind', 'face', 'accent', 'leaf']) {
      assert.match(f[k] || '', /^#[0-9a-f]{6}$/i, `${f.name}.${k} is not a #rrggbb colour`);
    }
  }
  // one row of face parameters per fruit, or a level paints a blank face
  assert.equal(FACES.length, FRUITS.length);
});

test('only levels 1-5 spawn; the watermelon fits the box with room to work', () => {
  assert.equal(MAX_SPAWN_LEVEL, 5);
  // two watermelons must be able to coexist side by side, or the ultimate
  // merge could never be set up
  assert.ok(2 * (2 * radiusOf(11)) < WORLD.width + 2 * radiusOf(11) * 0.35);
  assert.ok(scoreOf(11) === 1024);
});

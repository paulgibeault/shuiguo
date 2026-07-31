// The fruit table IS the game spec — pin it so a casual edit can't silently
// reshape scoring or sizes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRUITS, MAX_LEVEL, MAX_SPAWN_LEVEL, ANNIHILATE_SCORE, radiusOf, scoreOf, WORLD } from '../js/constants.js';

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

test('only levels 1-5 spawn; the watermelon fits the box with room to work', () => {
  assert.equal(MAX_SPAWN_LEVEL, 5);
  // two watermelons must be able to coexist side by side, or the ultimate
  // merge could never be set up
  assert.ok(2 * (2 * radiusOf(11)) < WORLD.width + 2 * radiusOf(11) * 0.35);
  assert.ok(scoreOf(11) === 1024);
});

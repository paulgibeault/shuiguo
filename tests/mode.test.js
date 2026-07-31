// Three hosts share one canvas and one frame, and the only thing stopping two
// of them from driving at once is this router. Its rules — exactly one screen
// current, exit before enter, re-routing nowhere is free — are what a host is
// allowed to assume, so they get pinned against plain objects rather than a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRouter } from '../js/mode.js';

const el = () => ({ hidden: false });

function threeScreens(log = []) {
  const sheets = { menu: el(), farm: el(), hud: el() };
  const r = makeRouter();
  r.add('menu', { sheet: sheets.menu, onEnter: (f) => log.push(`menu:enter:${f}`), onExit: (t) => log.push(`menu:exit:${t}`) });
  r.add('board', { chrome: [sheets.hud], onEnter: (f) => log.push(`board:enter:${f}`), onExit: (t) => log.push(`board:exit:${t}`) });
  r.add('farm', { sheet: sheets.farm, onEnter: (f) => log.push(`farm:enter:${f}`), onExit: (t) => log.push(`farm:exit:${t}`) });
  return { r, sheets, log };
}

test('exactly one screen is up, and every other sheet is down', () => {
  const { r, sheets } = threeScreens();
  r.route('menu');
  assert.equal(sheets.menu.hidden, false);
  assert.equal(sheets.farm.hidden, true);
  assert.equal(sheets.hud.hidden, true, 'the board HUD showed over the menu');

  r.route('farm');
  assert.equal(sheets.menu.hidden, true);
  assert.equal(sheets.farm.hidden, false);
  assert.equal(r.current(), 'farm');
  assert.ok(r.is('farm'));
  assert.ok(!r.is('menu'));
});

test('a screen with no sheet is the bare board: every sheet down, its chrome up', () => {
  const { r, sheets } = threeScreens();
  r.route('board');
  assert.equal(sheets.menu.hidden, true);
  assert.equal(sheets.farm.hidden, true);
  assert.equal(sheets.hud.hidden, false);
});

test('exit always runs before enter, and both are told the other screen', () => {
  const log = [];
  const { r } = threeScreens(log);
  r.route('menu');
  assert.deepEqual(log, ['menu:enter:null']);

  log.length = 0;
  r.route('board');
  assert.deepEqual(log, ['menu:exit:board', 'board:enter:menu'],
    'a host started before the last one stopped');
});

test('the DOM is settled before either hook runs — a hook may repaint at once', () => {
  const sheet = el();
  const r = makeRouter();
  let sawHidden = null;
  r.add('a', {});
  r.add('b', { sheet, onEnter: () => { sawHidden = sheet.hidden; } });
  r.route('a');
  r.route('b');
  assert.equal(sawHidden, false, 'onEnter ran while its own sheet was still display:none');
});

test('re-routing to the screen already up is free', () => {
  const log = [];
  const { r } = threeScreens(log);
  assert.equal(r.route('menu'), true);
  log.length = 0;
  assert.equal(r.route('menu'), false, 'the same screen was entered twice');
  assert.deepEqual(log, [], 'a no-op route restarted the screen');
});

test('routing somewhere that does not exist is a bug, and says so', () => {
  const { r, sheets } = threeScreens();
  r.route('menu');
  assert.throws(() => r.route('orchard'), /no such screen/);
  assert.equal(r.current(), 'menu', 'a failed route left the router adrift');
  assert.equal(sheets.menu.hidden, false);
  assert.ok(r.has('farm'));
  assert.ok(!r.has('orchard'));
});

test('refresh() re-asserts the current screen after something moved the furniture', () => {
  const { r, sheets } = threeScreens();
  r.route('farm');
  sheets.farm.hidden = true;          // e.g. a settings change re-rendered the frame
  sheets.menu.hidden = false;
  r.refresh();
  assert.equal(sheets.farm.hidden, false);
  assert.equal(sheets.menu.hidden, true);
});

test('a screen registered with nothing at all still routes', () => {
  const r = makeRouter();
  r.add('bare');
  assert.equal(r.route('bare'), true);
  assert.equal(r.current(), 'bare');
  r.refresh();
});

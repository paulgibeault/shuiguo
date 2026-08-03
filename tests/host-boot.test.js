// Booting the actual game, wiring and all.
//
// Everything else in this suite tests a pure module. This one boots js/main.js
// against tests/fake-dom.js and drives it through the campaign the way a player
// would, because the bugs the host layer really has are wiring bugs — a typo'd
// element id, a const used before it exists, a save written to the wrong key, a
// host still drawing after it left the screen — and every one of them shows up
// the moment the thing is actually run.
//
// The isolation promise is pinned here too, and it is the strongest claim the
// campaign makes: playing free play must not write a campaign key, and playing
// the campaign must not write a free-play one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootGame } from './fake-dom.js';
import { TUNING, RULES, FRIENDS, scoreOf } from '../js/constants.js';
import { evaluateFarm, eachPlot, isRipe, harvest } from '../js/farm.js';
import { mergeValue, chainMultiplier, friendCut } from '../js/economy.js';
import { multiplier } from '../js/format.js';
import { FREE_PLAY_KEYS, CAMPAIGN_KEYS, CAMPAIGN_KEY, MARKET_KEY } from '../js/campaign-save.js';
import { makeCampaign, finishFirstRun, buyFarm, harvestInto, noteMerges, makeRunTally, serialize as packCampaign } from '../js/campaign.js';

// One drop, cooldown and all. js/game.js locks input for RULES.dropCooldownMs
// on the wall clock, so a test that only spins the loop gets exactly one fruit
// however many frames it asks for — the frames have to carry the time too, and
// tests/fake-dom's clock advances with them.
function dropAt(booted, x) {
  booted.$('board').fire('pointerdown', { clientX: x, clientY: 300 });
  booted.$('board').fire('pointerup', { clientX: x, clientY: 300 });
  booted.arcade.tick(Math.ceil(RULES.dropCooldownMs / 16) + 4);
}

// Which sheet is up, by the ids the router owns.
function screen($) {
  for (const id of ['mode', 'menu', 'over', 'appraisal']) if (!$(id).hidden) return id;
  if (!$('farm-hud').hidden) return 'farm';
  if (!$('market-hud').hidden) return 'market';
  if (!$('hud').hidden) return 'game';
  return '(none)';
}

// ── it boots at all ────────────────────────────────────────────────────────

test('a fresh player lands on the map, with every place in the valley visible', async () => {
  const { $, arcade } = await bootGame();
  assert.equal(screen($), 'mode');
  assert.equal($('campaign-badge').hidden, false, 'the new-shoot badge is missing on a fresh save');
  assert.ok(arcade.stats.get('session').launches >= 1, 'the boot never proved the storage bridge');

  // The whole valley, and what a fresh player can actually do in it: the gift
  // crate makes the market live, the shop waits for ground to plant, the farm
  // says out loud that it is for sale.
  assert.equal($('map-market').disabled, false, 'the gift crate did not open the market');
  assert.equal(Number($('map-crate').textContent) > 0, true, 'the crate pill is empty on the gift run');
  assert.equal($('map-shop').disabled, true, 'the shop sold to a player with nowhere to plant');
  assert.match($('farm-note').textContent, /For sale/, 'the farm does not say it is for sale');
  assert.equal($('map-hint').hidden, false, 'the opening line under the map is missing');
  assert.equal($('play-free').hidden, false, 'the first friend\'s door is missing');
  assert.equal($('friends').hidden, true, 'a chooser of one went up');
});

test('every id the hosts reach for is one index.html actually declares', async () => {
  // fake-dom throws on an undeclared id, so simply walking every screen and
  // opening every sheet is the assertion.
  const { $, arcade } = await bootGame();
  $('to-collection').fire('click');
  assert.equal(screen($), 'menu');
  $('menu-to-mode').fire('click');
  $('play-campaign').fire('click');           // gift run
  assert.equal(screen($), 'market');
  arcade.tick(2);
  $('pack-up').fire('click');
  arcade.tick(1);
  assert.equal(screen($), 'appraisal');
  $('appraisal-done').fire('click');
  assert.equal(screen($), 'farm');
  $('to-shop').fire('click');
  $('shop-x').fire('click');                  // the corner ✕
  $('to-shop').fire('click');
  $('shop-close').fire('click');              // …and the bottom Close
  $('farm-to-menu').fire('click');
  assert.equal(screen($), 'mode');
});

// ── free play is untouched ─────────────────────────────────────────────────

test('free play still resumes into its own board, exactly as it did', async () => {
  const board = { v: 1, score: 40, current: 3, next: 2, fruits: [[2, 100, 400]], rngState: 7 };
  const { $, arcade } = await bootGame({ state: { save: board } });
  assert.equal(screen($), 'game', 'a mid-game free-play save no longer resumes');
  assert.equal($('score').textContent, '40');
  assert.ok(arcade.loops.some((l) => l.running), 'the board resumed without a loop');
});

test('a mid-drop campaign run outranks everything and resumes into the market', async () => {
  const c = makeCampaign();
  const board = { v: 1, score: 12, current: 11, next: null, fruits: [[9, 100, 400]], rngState: 3 };
  const { $ } = await bootGame({
    state: {
      [CAMPAIGN_KEY]: packCampaign(c),
      [MARKET_KEY]: { v: 1, board, tally: { unlockedThisRun: [3], dripEligible: { 3: 4 } }, earnings: 640 },
      save: { v: 1, score: 5, current: 1, next: 1, fruits: [], rngState: 1 },
    },
  });
  assert.equal(screen($), 'market', 'someone mid-drop was sent somewhere else');
  assert.equal($('m-score').textContent, '640', 'the till the run had banked did not come back');
});

// The till is the one field in the campaign where believing a save would be
// minting money, so it is the one field that is disbelieved by default. A save
// written before it existed — or doctored after — resumes with the board intact
// and the earnings it can prove, which is none.
test('a market save cannot mint a till out of nothing', async () => {
  const board = { v: 1, score: 12, current: 11, next: null, fruits: [[9, 100, 400]], rngState: 3 };
  for (const earnings of [undefined, -50, 1.5, 1e9 + 0.5, 'lots', null, NaN, {}]) {
    const c = makeCampaign();
    const { $ } = await bootGame({
      state: {
        [CAMPAIGN_KEY]: packCampaign(c),
        [MARKET_KEY]: { v: 1, board, tally: {}, earnings },
      },
    });
    assert.equal(screen($), 'market');
    assert.equal($('m-score').textContent, '0',
      `earnings ${JSON.stringify(earnings)} was believed`);
  }
});

// A player who has been through the opening: gift run played out, farm bought,
// money in the till. Five tests wanted this and each was re-deriving it; the
// opening sequence lives here now, and `farmedGame` below is this plus the tap
// that walks into it.
function farmedCampaign({ cash = TUNING.firstRunFloor, met = [], crate = false } = {}) {
  const c = makeCampaign();
  finishFirstRun(c, cash);
  buyFarm(c, Date.now());
  if (!crate) c.crate = Object.create(null);
  // seeds earned at market, which is the only way a grower is met
  for (const f of met) noteMerges(c, makeRunTally(), [{ type: 'merge', level: f.level }]);
  return packCampaign(c);
}

// A market board that merges itself on the very first tick: two pears sitting
// inside each other's radius. Every test that needs a real 元 figure out of the
// host uses this rather than trying to drop and aim its way into a merge.
const MERGING_PEARS = { v: 1, score: 0, current: 7, next: 7, fruits: [[7, 130, 490], [7, 230, 490]], rngState: 3 };

async function resumedMarket(state = {}) {
  return bootGame({
    settings: { reducedMotion: true },
    state: {
      [CAMPAIGN_KEY]: farmedCampaign({ cash: TUNING.firstRunFloor * 4, crate: true }),
      [MARKET_KEY]: { v: 1, board: MERGING_PEARS, tally: {}, earnings: 0 },
      ...state,
    },
  });
}

// The HUD counts the day up and the appraisal itemizes it, and they are the
// same arithmetic asked twice. If they can ever disagree, the player watched a
// number assemble that the receipt then denies.
test('the 元 on the HUD at pack-up is exactly the appraisal\'s Merges line', async () => {
  const { $, arcade } = await resumedMarket();
  assert.equal(screen($), 'market');
  arcade.tick(2);
  const onHud = Number($('m-score').textContent);
  assert.ok(onHud > 0, 'a merge banked nothing at all');
  // the merchant's premium, not the arcade score: a peach is worth 128 there
  assert.ok(onHud > scoreOf(8), `a peach merge paid ${onHud} against ${scoreOf(8)} face`);

  $('pack-up').fire('click');
  arcade.tick(1);
  assert.equal(screen($), 'appraisal');
  const merges = [...$('appraisal-lines').children].find((r) => r.textContent.includes('Merges'));
  assert.ok(merges, 'the appraisal itemized no merges');
  assert.equal(merges.textContent, `Merges 合并+${onHud}`, 'the receipt disagrees with the HUD');
});

// ── what the board says a merge was worth ──────────────────────────────────
// During a market day every reward on screen is money; in free play every
// reward on screen is arcade score. The renderer is shared and knows about
// neither — the popup's words are supplied by the host that pushed the event —
// so what each mode ends up saying is worth pinning on both sides.

// Every string painted on the board since the last look. Score floats are the
// only text the board draws, so this is them.
function floatsOn($) {
  return $('board').drawnText.filter((s) => s.startsWith('+'));
}

test('a campaign merge float is paid in 元, at the merchant price', async () => {
  const { $, arcade } = await resumedMarket();
  arcade.tick(2);
  const floats = floatsOn($);
  assert.ok(floats.length > 0, 'the merge produced no float at all');
  for (const f of floats) assert.match(f, /^\+\d+元/, `a market-day float said "${f}"`);
  // and it is the merchant's figure, not the arcade score the engine banked
  assert.equal(floats[0], `+${mergeValue(8, 1)}元`);
  assert.notEqual(floats[0], `+${scoreOf(8)}元`, 'the float quoted face value');
});

test('a free-play merge float is byte-identical to what it always said', async () => {
  // two cherries already inside each other's radius: they merge on tick one
  const board = { v: 1, score: 0, current: 1, next: 1, fruits: [[1, 165, 540], [1, 193, 540]], rngState: 7 };
  const { $, arcade } = await bootGame({ state: { save: board }, settings: { reducedMotion: true } });
  assert.equal(screen($), 'game');
  arcade.tick(2);
  const floats = floatsOn($);
  assert.ok(floats.length > 0, 'the merge produced no float at all');
  assert.equal(floats[0], `+${scoreOf(2)}`, 'free play started talking about money');
  for (const f of floats) assert.ok(!f.includes('元'), `free play's float said "${f}"`);
});

// Four pairs of cherries, each pair inside its own radius and well clear of the
// next. They all merge on the same tick, which the wall-time window credits as
// a 4-chain — the shortest honest way to raise a banner out of a real board.
const FOUR_CHAIN = {
  v: 1, score: 0, current: 1, next: 1, rngState: 5,
  fruits: [[1, 20, 540], [1, 48, 540], [1, 90, 540], [1, 118, 540],
    [1, 160, 540], [1, 188, 540], [1, 230, 540], [1, 258, 540]],
};

test('the chain banner carries its bonus at market and stays plain in free play', async () => {
  const paid = await resumedMarket({ [MARKET_KEY]: { v: 1, board: FOUR_CHAIN, tally: {}, earnings: 0 } });
  paid.arcade.tick(2);
  assert.equal(paid.$('banner').hidden, false, 'a 4-chain raised no banner');
  assert.equal(paid.$('banner').textContent, `4-chain! 四连! ×${multiplier(chainMultiplier(4))}`);
  assert.match(paid.$('banner').textContent, /×1\.45$/, 'the bonus is not two decimals of the knob');

  const free = await bootGame({ state: { save: FOUR_CHAIN }, settings: { reducedMotion: true } });
  free.arcade.tick(2);
  assert.equal(free.$('banner').hidden, false, 'a 4-chain raised no banner in free play');
  assert.equal(free.$('banner').textContent, '4-chain! 四连!', 'free play\'s banner grew a price tag');
});

// Floats are information, not decoration — js/effects.js lets them through
// under reduced motion as a static fade for exactly that reason, and a market
// day's takings are the most information a float ever carries.
test('reduced motion still shows what a merge paid', async () => {
  const { $, arcade } = await resumedMarket();
  arcade.tick(2);
  assert.ok(floatsOn($).length > 0, 'reduced motion swallowed the payout');
});

// ── the friend's stall, and the one thing it may write ─────────────────────
//
// The isolation promise USED to be "free play writes not one campaign key". It
// is deliberately narrower now, because a friend's stall pays you a share of
// the till: the friend's stall may write campaign CASH, and never anything
// else. No seeds, no unlocks, no crate, no farm mutation, no phase change —
// which is what keeps a lucky evening on somebody else's stall from skipping
// the campaign's whole progression. A player with no campaign still writes
// nothing at all, exactly as before.

test('a player with no campaign minds the stall and writes not one campaign key', async () => {
  const { $, arcade } = await mindedStall({ campaign: null });
  finishStall($, arcade);
  arcade.runTimers();
  arcade.fire('suspend');

  assert.equal(screen($), 'over');
  for (const key of CAMPAIGN_KEYS) {
    assert.ok(!arcade.writes.includes(key), `a friend's stall wrote the campaign's ${key}`);
  }
  assert.ok(!arcade.scores.lanes.some((s) => s.lane === 'campaign'), 'the stall scored in the campaign lane');
  assert.equal($('friend-cut').textContent, '', 'a player with no farm was paid a split anyway');
  assert.equal($('friend-cut').hidden, true);
});

test('minding a stall still saves its own board under its own key', async () => {
  const { $, arcade } = await mindedStall({ campaign: null });
  arcade.tick(3);
  arcade.runTimers();
  arcade.fire('suspend');
  assert.ok(arcade.writes.includes('save'), 'free play stopped saving its board');
});

// A run that ends the only way free play's runs end — a pile already over the
// line, waiting the deadline out — with a score worth splitting on it. 430 is
// the worked example from the issue: 草莓's fifth of it is 86元.
const TOPPLED_STALL = {
  v: 1, score: 430, current: 1, next: 1, rngState: 5, tally: { chainBest: 4 },
  fruits: [[7, 180, 492.5], [8, 180, 380], [7, 180, 267.5], [8, 180, 155], [7, 180, 42.5]],
};

// `campaign` is a packed campaign, or null for a player who has never opened
// one. `who` is whose stall it is, riding on the save exactly as it does for a
// real resumed run.
async function mindedStall({ campaign = farmedCampaign(), score = 430, who = null } = {}) {
  const save = { ...TOPPLED_STALL, score };
  if (who) save.friend = who.level;
  const state = { save };
  if (campaign) state[CAMPAIGN_KEY] = campaign;
  const booted = await bootGame({ settings: { reducedMotion: true }, state });
  assert.equal(screen(booted.$), 'game', 'the stall never opened');
  booted.before = booted.arcade.state.get(CAMPAIGN_KEY);
  return booted;
}

// Let the deadline claim the pile. One frame to start every fruit's clock, the
// rule's own three seconds on the wall, one more frame to notice.
function finishStall($, arcade) {
  arcade.tick(1);
  arcade.advance(RULES.overLineMs + 100);
  arcade.tick(1);
  assert.equal($('over').hidden, false, 'the pile never reached the line');
}

test('minding the stall with a farm behind you pays the friend\'s split, and says so', async () => {
  const { $, arcade, before } = await mindedStall();
  finishStall($, arcade);

  assert.equal(friendCut(430), 86, 'the worked example moved — check TUNING.friendCut');
  assert.equal($('friend-cut').hidden, false, 'the friend took their cut without a word');
  assert.equal($('friend-cut').textContent, 'Strawberry splits the till +86元');

  const after = arcade.state.get(CAMPAIGN_KEY);
  assert.equal(after.cash, before.cash + 86, 'the till did not reach the campaign');
});

test('the split is CASH and nothing else — not a seed, an unlock, a crate or a farm', async () => {
  const { $, arcade, before } = await mindedStall();
  finishStall($, arcade);
  const after = arcade.state.get(CAMPAIGN_KEY);

  assert.notEqual(after.cash, before.cash, 'nothing was paid at all');
  for (const field of ['phase', 'firstRunDone']) {
    assert.equal(after[field], before[field], `the friend's stall changed ${field}`);
  }
  // The board is full of pears and peaches — exactly the levels a campaign
  // merge would have unlocked the right to plant. Minding a friend's stall
  // must earn none of that: unlocks are campaign-merge-only, and js/campaign.js
  // §noteMerges is never reached from this path.
  for (const field of ['seeds', 'unlocked', 'crate', 'farm']) {
    assert.deepEqual(after[field], before[field], `the friend's stall wrote ${field}`);
  }
  assert.ok(!arcade.writes.includes(MARKET_KEY), 'a friend\'s stall left a market board behind');
  assert.ok(!arcade.scores.lanes.some((s) => s.lane === 'campaign'), 'the split scored in the campaign lane');
});

test('the split survives a reload, because it is flushed at the moment it is paid', async () => {
  const { $, arcade } = await mindedStall();
  finishStall($, arcade);
  const paid = arcade.state.get(CAMPAIGN_KEY).cash;
  assert.ok(paid > 0);

  const again = await bootGame({ state: { [CAMPAIGN_KEY]: arcade.state.get(CAMPAIGN_KEY) } });
  again.$('play-campaign').fire('click');
  assert.equal(Number(again.$('farm-cash').textContent), paid, 'the friend\'s cut did not survive a reload');
});

// ── the cast ───────────────────────────────────────────────────────────────
// Each friend's stall opens when their seed is earned in a CAMPAIGN run, which
// is the campaign reaching into free play the same way the friend's split
// reaches back. The chooser is where that shows up.

test('with only 草莓 open there is no chooser — a menu of one is a speed bump', async () => {
  const { $ } = await bootGame();
  assert.equal($('friends').hidden, true, 'a chooser of one went up anyway');
  assert.equal($('play-free').hidden, false, 'and it took the door with it');
  assert.match($('play-free-name').textContent, /Strawberry/, 'the door does not say whose stall it is in English');

  $('play-free').fire('click');
  assert.equal(screen($), 'game', '草莓\'s stall did not open');
});

test('meeting a grower at market puts their stall in the chooser next time', async () => {
  const { $ } = await bootGame({ state: { [CAMPAIGN_KEY]: farmedCampaign({ met: [FRIENDS[1]] }) } });
  assert.equal($('friends').hidden, false, 'the chooser never appeared on the map');
  assert.equal($('play-free').hidden, true, 'the chooser and the single door were both up');

  const cards = [...$('friends').children];
  assert.equal(cards.length, FRIENDS.length, 'the cast is not all accounted for');
  const open = cards.filter((c) => !c.classList.contains('locked'));
  const shut = cards.filter((c) => c.classList.contains('locked'));
  assert.equal(open.length, 2, '葡萄 was met and their stall stayed shut');
  assert.equal(shut.length, 1, '苹果 was never met and their stall opened');
  assert.equal(shut[0].dataset.level, String(FRIENDS[2].level));
  assert.notEqual(shut[0].tagName, 'BUTTON', 'a grower you have not met is a figure, not a button');
  assert.equal($('friends-hint').hidden, false, 'the silhouette came with no way to earn it');

  // and every open card is painted, because the sheet is up when it is built
  assertPainted(open, 'the chooser');
});

test('the chooser says how each stall is stocked, English first', async () => {
  const { $ } = await bootGame({ state: { [CAMPAIGN_KEY]: farmedCampaign({ met: [FRIENDS[1]] }) } });
  const text = [...$('friends').children].map((c) => c.textContent).join(' ');
  assert.ok(text.includes('Strawberry'), 'the chooser does not name the fruit in English');
  assert.ok(text.includes('Grape'));
  assert.ok(text.includes('草莓'), 'the learning flavor fell off the card');
  assert.ok(text.includes(FRIENDS[0].flavor), 'a stall does not say how it is stocked');
  assert.ok(text.includes(FRIENDS[1].flavor));
});

test('picking a stall from the chooser opens THAT stall, and remembers it', async () => {
  const { $, arcade } = await bootGame({ state: { [CAMPAIGN_KEY]: farmedCampaign({ met: [FRIENDS[1]] }) } });
  const cozy = [...$('friends').children].find((c) => c.dataset.level === String(FRIENDS[1].level));
  cozy.fire('click');
  assert.equal(screen($), 'game', '葡萄\'s stall did not open');

  arcade.tick(3);
  arcade.runTimers();
  arcade.fire('suspend');
  assert.equal(arcade.state.get('save').friend, FRIENDS[1].level,
    'the save forgot whose stall it was — a resume would land in the wrong one');
});

test('a resumed run comes back to the stall it was in, and an old save to 草莓\'s', async () => {
  const cozy = await mindedStall({ who: FRIENDS[1], campaign: farmedCampaign({ met: [FRIENDS[1]] }) });
  finishStall(cozy.$, cozy.arcade);
  assert.ok(cozy.$('friend-cut').textContent.includes('Grape'), 'the wrong friend was paid');

  // a save written before there was a cast carries no friend at all
  const old = await mindedStall();
  finishStall(old.$, old.arcade);
  assert.ok(old.$('friend-cut').textContent.includes('Strawberry'), 'an old save landed in somebody else\'s stall');
});

// Specialty loadouts make scores incomparable — 葡萄's stall rains small fruit
// and is a chain paradise, 苹果's fills fast and pays fast — so a high score off
// either would be a lie sitting next to everybody else's honest one. They still
// pay the split, because visiting them is the entire point of them.
test('a specialty stall pays the split but posts no record — the board stays honest', async () => {
  const fair = await mindedStall();
  finishStall(fair.$, fair.arcade);
  assert.ok(fair.arcade.scores.lanes.some((s) => s.lane === 'classic'), '草莓\'s stall stopped competing');
  assert.ok(fair.arcade.records.all['high-score'], 'a balanced run set no high score');
  assert.ok(fair.arcade.records.all['best-chain'], 'a balanced run set no best chain');

  const risky = await mindedStall({ who: FRIENDS[2], campaign: farmedCampaign({ met: [FRIENDS[2]] }) });
  finishStall(risky.$, risky.arcade);
  assert.ok(!risky.arcade.scores.lanes.some((s) => s.lane === 'classic'),
    'a specialty stall posted to the arcade board');
  assert.equal(risky.arcade.records.all['high-score'], undefined, 'a specialty run claimed the high score');
  assert.equal(risky.arcade.records.all['best-chain'], undefined, 'a specialty run claimed the best chain');
  assert.equal(risky.$('new-best').hidden, true, 'a specialty run was congratulated for a score nobody counted');

  // …and it pays exactly like every other stall
  assert.equal(risky.$('friend-cut').hidden, false, 'visiting a specialty stall paid nothing');
  assert.ok(risky.$('friend-cut').textContent.includes('Apple'), 'the split line names the wrong friend');
});

// The collection book is NOT gated. A first pear is a first pear wherever you
// made it, and the chart is a book of fruit rather than a leaderboard.
test('the collection book still fills from a specialty stall', async () => {
  const { arcade } = await mindedStall({ who: FRIENDS[2], campaign: farmedCampaign({ met: [FRIENDS[2]] }) });
  const found = arcade.stats.get('discovered');
  assert.ok(found && found.levels.includes(8), 'the peach on the counter was not recorded');
});

// ── the map ────────────────────────────────────────────────────────────────
// The front door is a picture of the valley: every place the game can go is a
// spot, a spot you cannot use yet is greyed rather than hidden, and the whole
// thing is derived from campaign state on every look — no flags, no timers.

test('the map knows the valley: shop opens once there is a farm, and walks you there', async () => {
  const { $ } = await bootGame({ state: { [CAMPAIGN_KEY]: farmedCampaign() } });
  assert.equal(screen($), 'mode');
  assert.equal($('map-shop').disabled, false, 'a farmed player found the shop closed');
  assert.match($('farm-note').textContent, /Cash [\d,]+元/, 'the farm spot does not show the till');
  assert.equal($('map-hint').hidden, true, 'the opening hint outstayed the opening');

  $('map-shop').fire('click');
  assert.equal(screen($), 'farm', 'the shop spot did not walk to the farm');
  assert.equal($('shop').hidden, false, 'the shop drawer did not open');
  $('shop-x').fire('click');
  assert.equal($('shop').hidden, true, 'the ✕ did not close the drawer');
});

test('the map\'s market spot is the market, crate pill and all', async () => {
  const c = makeCampaign();
  finishFirstRun(c, TUNING.firstRunFloor * 2);
  buyFarm(c, Date.now());
  c.crate = Object.create(null);
  harvestInto(c, { level: 1, count: 9 });
  const { $ } = await bootGame({ state: { [CAMPAIGN_KEY]: packCampaign(c) } });
  assert.equal($('map-crate').textContent, '9');
  assert.equal($('map-market').disabled, false);
  $('map-market').fire('click');
  assert.equal(screen($), 'market', 'the market spot went somewhere else');

  // …and with nothing to sell, the market spot is greyed rather than a dead end
  const bare = await bootGame({ state: { [CAMPAIGN_KEY]: farmedCampaign() } });
  assert.equal(bare.$('map-market').disabled, true, 'an empty crate could be carried to market');
});

test('the collection is one tap off the map and one tap back', async () => {
  const { $ } = await bootGame();
  $('to-collection').fire('click');
  assert.equal(screen($), 'menu');
  assert.ok($('chart').children.length > 0, 'the collection book has no chart in it');
  $('menu-to-mode').fire('click');
  assert.equal(screen($), 'mode');
});

test('game over returns to the map, where everything is', async () => {
  const { $, arcade } = await mindedStall({ campaign: null });
  finishStall($, arcade);
  $('to-menu').fire('click');
  assert.equal(screen($), 'mode', 'the way out of a run does not lead back to the map');
});

// ── the dead-spot pointer ──────────────────────────────────────────────────

// A farm at its genuinely quiet moment: everything picked, everything sold, and
// the orchard partway through a cycle. There is nothing here to tap and nothing
// to carry down the hill — which is the dead spot this badge answers.
function quietFarm() {
  const c = makeCampaign();
  finishFirstRun(c, TUNING.firstRunFloor * 2);
  buyFarm(c, Date.now() - 30 * 60 * 1000);   // long enough that it all came ripe
  const now = Date.now();
  evaluateFarm(c.farm, now);
  for (const { ti, pi, plot } of eachPlot(c.farm)) if (isRipe(plot)) harvest(c.farm, ti, pi, now);
  c.crate = Object.create(null);             // …and the harvest was sold at market
  return packCampaign(c);
}

test('the farm points at a friend when the crate is empty and nothing is close', async () => {
  const { $ } = await bootGame({ state: { [CAMPAIGN_KEY]: quietFarm() } });
  // …on the map, where the friends' corner wears the same quiet 🍓 —
  assert.equal($('friends-badge').hidden, false, 'the map does not point at the friends');
  $('play-campaign').fire('click');
  assert.equal(screen($), 'farm');
  assert.equal($('crate-count').textContent, '0');
  // — and on the farm's own way back to it.
  assert.equal($('farm-badge').hidden, false,
    'an empty crate with nothing ripening soon offered the player nothing to do');
});

test('the badge retires the moment there is anything to carry down the hill', async () => {
  const c = makeCampaign();
  finishFirstRun(c, TUNING.firstRunFloor * 2);
  buyFarm(c, Date.now());
  c.crate = Object.create(null);
  harvestInto(c, { level: 1, count: 6 });
  const { $ } = await bootGame({ state: { [CAMPAIGN_KEY]: packCampaign(c) } });
  $('play-campaign').fire('click');
  assert.equal($('crate-count').textContent, '6');
  assert.equal($('farm-badge').hidden, true, 'the badge nagged at a player with a full crate');
});

test('a farm with something about to ripen is not nagged at either', async () => {
  // the starter farm's bed comes half grown, so a crop lands inside the minute
  const c = makeCampaign();
  finishFirstRun(c, TUNING.firstRunFloor * 2);
  buyFarm(c, Date.now());
  c.crate = Object.create(null);
  const { $ } = await bootGame({ state: { [CAMPAIGN_KEY]: packCampaign(c) } });
  $('play-campaign').fire('click');
  assert.equal($('farm-badge').hidden, true,
    'a farm with a crop a minute out was told to go and help somebody else');
});

test('a stall minded for nothing pays nothing, and leaves no line saying so', async () => {
  // 20% of zero is not a receipt line, it is a scold
  const { $, arcade, before } = await mindedStall({ score: 0 });
  finishStall($, arcade);
  assert.equal($('friend-cut').hidden, true, 'a scoreless run got a receipt for 0元');
  assert.equal(arcade.state.get(CAMPAIGN_KEY).cash, before.cash, 'nothing earned still moved the till');
});

test('playing the campaign writes campaign keys and NOT ONE free-play key', async () => {
  const { $, arcade } = await bootGame();
  const booted = { $, arcade };
  $('play-campaign').fire('click');
  arcade.tick(3);
  dropAt(booted, 120);
  arcade.runTimers();
  $('pack-up').fire('click');
  arcade.tick(1);

  assert.ok(arcade.writes.includes(CAMPAIGN_KEY), 'the campaign never banked its own state');
  for (const key of FREE_PLAY_KEYS) {
    assert.ok(!arcade.writes.includes(key), `the campaign wrote free play's ${key}`);
  }
  assert.ok(!arcade.scores.lanes.some((s) => s.lane === 'classic'), 'a market day landed on the arcade board');
});

test('the two modes claim no key in common', () => {
  for (const key of CAMPAIGN_KEYS) assert.ok(!FREE_PLAY_KEYS.includes(key), `${key} is claimed twice`);
});

// ── the opening ────────────────────────────────────────────────────────────

test('the gift run goes straight to the stall, with a crate and no farm', async () => {
  const { $, arcade } = await bootGame();
  $('play-campaign').fire('click');
  assert.equal(screen($), 'market', 'the first campaign tap asked the player to choose something');
  assert.ok($('crate-strip').children.length > 0, 'the gift crate never reached the HUD');
  arcade.tick(1);
  assert.ok($('board').drawCalls.length > 0, 'the board never drew');
});

test('the first appraisal is floored, and the farm is for sale on the way out', async () => {
  const { $, arcade } = await bootGame({ settings: { reducedMotion: true } });
  $('play-campaign').fire('click');
  arcade.tick(2);
  $('pack-up').fire('click');
  arcade.tick(1);

  assert.equal(screen($), 'appraisal');
  assert.ok($('appraisal-lines').children.length >= 1, 'the appraisal itemized nothing');
  assert.equal(Number($('appraisal-total').textContent), TUNING.firstRunFloor,
    'the gift run was not floored to the price of the farm');

  $('appraisal-done').fire('click');
  assert.equal(screen($), 'farm');
  assert.equal(Number($('farm-cash').textContent), TUNING.firstRunFloor);
});

test('tapping the 出售 sign buys the farm, and the farm arrives planted', async () => {
  const c = makeCampaign();
  finishFirstRun(c, TUNING.firstRunFloor);
  const { $, arcade } = await bootGame({ state: { [CAMPAIGN_KEY]: packCampaign(c) } });
  $('play-campaign').fire('click');
  assert.equal(screen($), 'farm');
  arcade.tick(1);

  // the sign hangs over the bottom terrace; tap it, then take the offer
  $('board').fire('pointerup', { clientX: 180, clientY: 505 });
  assert.equal($('plot').hidden, false, 'the for-sale sheet never opened');
  const buy = $('plot-rows').children[0];
  assert.equal(buy.disabled, false, 'the floored first run could not afford the farm it was floored for');
  buy.fire('click');

  assert.equal($('plot').hidden, true);
  assert.equal(Number($('farm-cash').textContent), TUNING.firstRunFloor - TUNING.starterFarmCost);
  const saved = arcade.state.get(CAMPAIGN_KEY);
  assert.ok(saved.farm, 'buying the farm did not survive to the save');
  assert.equal(saved.phase, 'open');
});

// ── the farm ───────────────────────────────────────────────────────────────

// A player who has been through the opening: gift run played out (so the gift
// crate is gone, the way a real run empties it), farm bought, money in the till.
async function farmedGame(cash = TUNING.firstRunFloor * 2) {
  const booted = await bootGame({ state: { [CAMPAIGN_KEY]: farmedCampaign({ cash }) } });
  booted.$('play-campaign').fire('click');
  return booted;
}

test('the farm draws the mountainside, and an empty crate cannot go to market', async () => {
  const { $, arcade } = await farmedGame();
  assert.equal(screen($), 'farm');
  arcade.tick(1);
  assert.ok($('board').drawCalls.length > 50, 'the mountainside barely drew anything');
  assert.equal($('crate-count').textContent, '0');
  assert.equal($('to-market').disabled, true, 'an empty crate could be carried to market');
});

test('a crate with something in it lights the Market button up', async () => {
  const c = makeCampaign();
  finishFirstRun(c, TUNING.firstRunFloor * 2);
  buyFarm(c, Date.now());
  c.crate = Object.create(null);
  harvestInto(c, { level: 1, count: 12 });
  const { $ } = await bootGame({ state: { [CAMPAIGN_KEY]: packCampaign(c) } });
  $('play-campaign').fire('click');
  assert.equal($('crate-count').textContent, '12');
  assert.equal($('to-market').disabled, false);
  assert.ok($('to-market').classList.contains('ready'), 'the Market button never lit up');
});

test('the shop sells what the player has unlocked, and greys what they cannot afford', async () => {
  const { $ } = await farmedGame();
  $('to-shop').fire('click');
  assert.equal($('shop').hidden, false);
  const cards = [...$('shop-seeds').children];
  const buyable = cards.filter((c) => !c.classList.contains('locked'));
  assert.equal(buyable.length, 1, 'the shop sold a seed the player has not unlocked');
  assert.equal(buyable[0].disabled, false, 'a rich player could not buy a cherry sapling');

  // and equipment is offered, priced, and greyed when out of reach
  const rows = [...$('shop-kit').children];
  assert.ok(rows.length >= 2, 'the shop sells no equipment at all');
  assert.ok(rows.some((r) => r.disabled), 'stream irrigation was affordable on day one');
});

// A chip canvas measures 0 while its sheet is display:none, so every seed card
// has to be painted AFTER its own sheet is up. The plot picker was never painted
// at all, and showed a grid of named blanks with the fruit missing.
test('a seed card is painted the moment its own sheet opens, in either sheet', async () => {
  const c = makeCampaign();
  finishFirstRun(c, TUNING.firstRunFloor * 2);
  buyFarm(c, Date.now());
  c.crate = Object.create(null);
  // the drawer's strawberries come with the farm, but the RIGHT to plant them is
  // earned at market — so earn it, or the picker has nothing to offer
  noteMerges(c, makeRunTally(), [{ type: 'merge', level: 2 }]);
  const { $, arcade } = await bootGame({ state: { [CAMPAIGN_KEY]: packCampaign(c) } });
  $('play-campaign').fire('click');
  arcade.tick(1);

  $('to-shop').fire('click');
  assertPainted([...$('shop-seeds').children].filter((x) => !x.classList.contains('locked')), 'the shop');
  $('shop-close').fire('click');

  // the starter terrace's last bed is bare, and tapping bare earth is the one
  // tap on the farm that opens a picker
  $('board').fire('pointerup', { clientX: 311, clientY: 536 });
  assert.equal($('plot').hidden, false, 'tapping bare earth opened nothing');
  assertPainted([...$('plot-seeds').children], 'the plot picker');
});

function assertPainted(cards, where) {
  assert.ok(cards.length > 0, `${where} offered no seeds at all`);
  for (const cell of cards) {
    const art = cell.querySelector('.chip-art');
    assert.ok(art, `a card in ${where} has no art element`);
    assert.ok(art.width > 0 && art.height > 0,
      `a card in ${where} was never painted — its canvas is ${art.width}×${art.height}`);
  }
}

// The unlock rule — merge one at market and you may plant it — is the campaign's
// whole progression, and until now the shop simply did not mention it. Locked
// levels show as silhouettes, capped at a few, and go away as they are earned.
test('the shop shows the next few seeds you have not earned, and says how', async () => {
  const { $ } = await farmedGame();
  $('to-shop').fire('click');
  const locked = [...$('shop-seeds').children].filter((c) => c.classList.contains('locked'));
  assert.ok(locked.length > 0 && locked.length <= 3, `${locked.length} silhouettes is not "the next few"`);
  assert.equal($('shop-locked-hint').hidden, false, 'the silhouettes came with no way to earn them');
  for (const cell of locked) {
    assert.notEqual(cell.tagName, 'BUTTON', 'a locked seed is a figure, not a button to tab to');
    assert.ok(cell.getAttribute('aria-label').includes('Locked'), 'a locked seed reads as a fruit');
  }
  // the first silhouette is the very next level, not a random one further up
  assert.equal(locked[0].dataset.level, '2');
});

// Everything here was already being banked by the market host; the shop just
// never showed it back. Nothing new is counted.
test('the farm keeps a quiet record, and shows none of it before there is one', async () => {
  const fresh = await farmedGame();
  fresh.$('to-shop').fire('click');
  assert.equal(fresh.$('shop-stats').hidden, true, 'day one already had a record to boast about');

  const { $, arcade } = await bootGame();
  $('play-campaign').fire('click');
  arcade.tick(2);
  $('pack-up').fire('click');
  arcade.tick(1);
  $('appraisal-done').fire('click');
  $('board').fire('pointerup', { clientX: 180, clientY: 505 });
  $('plot-rows').children[0].fire('click');     // buy the farm, so the shop opens
  $('to-shop').fire('click');

  assert.equal($('shop-stats').hidden, false, 'a market day left no trace');
  assert.match($('shop-stats').textContent, /Market days 1/);
  assert.match($('shop-stats').textContent, /Earned [\d,]+元/);
});

test('tapping a bare bed opens the picker; tapping a thirsty plant waters it outright', async () => {
  const { $, arcade } = await farmedGame();
  arcade.tick(1);

  // the starter cherry is in the bench of the bottom terrace, and it is thirsty
  const before = arcade.state.get('campaign');
  $('board').fire('pointerup', { clientX: 44, clientY: 536 });
  assert.equal($('plot').hidden, true, 'watering asked a question instead of just watering');
  arcade.fire('suspend');
  const after = arcade.state.get('campaign');
  assert.ok(after.farm.terraces[0].plots[0].wateredUntilMs > 0, 'the tap did not water the tree');
  assert.notEqual(before, after);
});

// ── suspend, resume, and the settings ──────────────────────────────────────

test('suspending anywhere loses nothing and stops every loop', async () => {
  const { $, arcade } = await farmedGame();
  arcade.tick(1);
  arcade.fire('suspend');
  assert.ok(!arcade.loops.some((l) => l.running), 'a loop kept running through a suspend');
  // nothing happened, so nothing was written — a quiet screen is not a save
  assert.ok(!arcade.writes.includes(CAMPAIGN_KEY), 'an idle farm wrote a save for no reason');

  $('board').fire('pointerup', { clientX: 44, clientY: 536 });   // water the tree
  arcade.fire('suspend');
  assert.ok(arcade.writes.includes(CAMPAIGN_KEY), 'a watered plot did not survive a suspend');

  arcade.fire('resume');
  assert.equal(screen($), 'farm', 'resuming moved the player');
});

test('a settings change repaints whatever is on screen, on every screen', async () => {
  const { $, arcade } = await bootGame();
  for (const go of [
    () => { $('to-collection').fire('click'); },
    () => { $('menu-to-mode').fire('click'); $('play-campaign').fire('click'); },
  ]) {
    go();
    arcade.fire('settings');            // must not throw on any screen
  }
  assert.equal(screen($), 'market');
});

test('a replaced state re-boots both modes from storage rather than half of one', async () => {
  const { $, arcade } = await bootGame();
  $('play-free').fire('click');
  assert.equal(screen($), 'game');

  arcade.state.store.save = undefined;
  delete arcade.state.store.save;
  arcade.fire('replaced');
  assert.equal(screen($), 'mode', 'a wiped state left the player on a board that no longer exists');
});

// ── the run ends every way it can ──────────────────────────────────────────

// The bonus is a rounded tenth of the subtotal, so this needs a run with real
// value in it. Dropping four fruit out of the gift crate does not reliably have
// any — the crate is mostly cherries, and an all-cherry board rounds the bonus
// to nothing about one time in thirty. Resume a board that has already merged
// instead: the assertion is about packing up, not about what the crate rolled.
test('every ending reaches the appraisal, and only the tidy ones pay the bonus', async () => {
  const tidy = await resumedMarket();
  tidy.arcade.tick(2);
  tidy.$('pack-up').fire('click');
  tidy.arcade.tick(1);
  const labels = [...tidy.$('appraisal-lines').children].map((r) => r.textContent);
  assert.ok(labels.some((l) => l.includes('Tidy')), 'packing up earned no Tidy Stall');
  assert.equal(tidy.arcade.state.get(MARKET_KEY), undefined, 'the finished run left a resumable board behind');

  // …and toppling out of the same board earns none of it
  const toppled = await resumedMarket();
  toppled.arcade.tick(2);
  const before = [...toppled.$('appraisal-lines').children];
  assert.equal(before.length, 0, 'the appraisal was up before the run ended');
});

test('a market day banks its own stats and its own score lane', async () => {
  const { $, arcade } = await bootGame();
  $('play-campaign').fire('click');
  arcade.tick(2);
  $('board').fire('pointerdown', { clientX: 180, clientY: 300 });
  $('board').fire('pointerup', { clientX: 180, clientY: 300 });
  arcade.tick(60);
  $('pack-up').fire('click');
  arcade.tick(1);

  const stats = arcade.stats.get('farm');
  assert.equal(stats.marketDays, 1);
  assert.equal(stats.packedUp, 1);
  assert.ok(stats.earned > 0);
  assert.ok(!arcade.stats.get('play'), 'a market day folded itself into free play\'s counters');
});

// ── the opening's three beats ──────────────────────────────────────────────
// The whole tutorial is staging: a pulse, a camera move, a sign and some
// glints. There is no dialog to assert, so what gets pinned is that each beat
// fires when it should, retires when it has been understood, and is skippable.

test('beat one: the gift crate pulses, and stops the moment it is used', async () => {
  const { $, arcade } = await bootGame();
  $('play-campaign').fire('click');
  assert.ok($('crate-strip').classList.contains('pulse'), 'the gift crate never pointed at itself');
  $('board').fire('pointerup', { clientX: 180, clientY: 300 });
  assert.ok(!$('crate-strip').classList.contains('pulse'), 'the pulse kept going after the first drop');
  arcade.tick(1);
});

test('beat one is the gift run only — an ordinary market day gets neither pulse nor card', async () => {
  const c = makeCampaign();
  finishFirstRun(c, TUNING.firstRunFloor * 2);
  buyFarm(c, Date.now());
  c.crate = Object.create(null);
  harvestInto(c, { level: 1, count: 12 });
  const { $ } = await bootGame({ state: { [CAMPAIGN_KEY]: packCampaign(c) } });
  $('play-campaign').fire('click');
  $('to-market').fire('click');
  assert.equal(screen($), 'market');
  assert.ok(!$('crate-strip').classList.contains('pulse'), 'the tutorial came back uninvited');
  assert.equal($('cards').children.length, 0, 'and it brought its card');
});

test('beat two: the camera pans up the mountain, once, and a tap lands it', async () => {
  const c = makeCampaign();
  finishFirstRun(c, TUNING.firstRunFloor);
  const { $, arcade } = await bootGame({ state: { [CAMPAIGN_KEY]: packCampaign(c) } });
  $('play-campaign').fire('click');
  arcade.tick(1);
  const settled = $('board').drawCalls.length;

  // the pan is staged from the appraisal's exit, which is where it happens for
  // real; driving it here proves it runs and then finishes rather than sticking
  $('farm-to-menu').fire('click');         // leave for the map and come back
  $('play-campaign').fire('click');
  arcade.tick(3);
  assert.ok($('board').drawCalls.length > settled, 'the farm stopped drawing');
});

test('beat two is simply skipped under reduced motion', async () => {
  const c = makeCampaign();
  finishFirstRun(c, TUNING.firstRunFloor);
  const { $, arcade } = await bootGame({
    state: { [CAMPAIGN_KEY]: packCampaign(c) },
    settings: { reducedMotion: true },
  });
  $('play-campaign').fire('click');
  arcade.tick(2);
  // the sign is tappable straight away rather than sliding into place first
  $('board').fire('pointerup', { clientX: 180, clientY: 505 });
  assert.equal($('plot').hidden, false, 'the for-sale sign was out of reach');
});

test('beat three: buying the farm plays the one card the campaign has', async () => {
  const c = makeCampaign();
  finishFirstRun(c, TUNING.firstRunFloor);
  const { $, arcade } = await bootGame({ state: { [CAMPAIGN_KEY]: packCampaign(c) } });
  $('play-campaign').fire('click');
  arcade.tick(1);
  assert.equal($('cards').children.length, 0);

  $('board').fire('pointerup', { clientX: 180, clientY: 505 });
  $('plot-rows').children[0].fire('click');
  assert.equal($('cards').children.length, 1, 'the farm changed hands without a word');
  const card = $('cards').children[0];
  assert.ok(card.textContent.includes('你的农场'), 'the card says something else entirely');
  assert.ok(card.textContent.includes('农场'));
});

// Every beat of the opening is one card, and each one fires on a phase
// transition — which is why none of them needs remembering: a phase the
// campaign has left is a phase it never returns to.
test('the opening says its three things, one card per beat, in order', async () => {
  const { $, arcade } = await bootGame();
  const seen = drainCards($, arcade, () => {
    $('play-campaign').fire('click');            // beat one: what a market day is for
    arcade.tick(2);
    $('pack-up').fire('click');
    arcade.tick(1);
    $('appraisal-done').fire('click');           // beat two: the farm is for sale
    $('board').fire('pointerup', { clientX: 180, clientY: 505 });
    $('plot-rows').children[0].fire('click');    // beat three: it is yours
  });

  assert.equal(seen.length, 3, `the opening played ${seen.length} cards: ${seen.join(' / ')}`);
  assert.ok(seen[0].includes('合并'), 'beat one never said merging is the point');
  assert.ok(seen[1].includes('出售'), 'beat two never named the sign it pans to');
  assert.ok(seen[2].includes('你的农场'), 'beat three: the farm changed hands without a word');
});

test('the campaign never puts more than a handful of words on screen at once', async () => {
  // Design pillar: very light narrative. No dialog boxes, no named characters,
  // no cutscene text — a card is a kicker and a bilingual name, and that is all
  // the prose the campaign is allowed. Held over EVERY card of the opening, not
  // just the last one: three beats is three chances to start writing dialog.
  const { $, arcade } = await bootGame();
  const seen = drainCards($, arcade, () => {
    $('play-campaign').fire('click');
    arcade.tick(2);
    $('pack-up').fire('click');
    arcade.tick(1);
    $('appraisal-done').fire('click');
    $('board').fire('pointerup', { clientX: 180, clientY: 505 });
    $('plot-rows').children[0].fire('click');
  });

  assert.ok(seen.length > 0, 'no card was played at all');
  for (const text of seen) {
    const words = text.split(/\s+/).filter(Boolean);
    assert.ok(words.length <= 8, `a card runs to ${words.length} words: ${text}`);
  }
});

// Play `walk`, then run the card queue out and collect every card it showed, in
// the order it showed them. Only one card is up at a time (they queue rather
// than stack), so the queue has to be pumped to see past the first.
function drainCards($, arcade, walk) {
  const seen = [];
  const collect = () => {
    for (const card of $('cards').children) {
      if (!seen.includes(card.textContent)) seen.push(card.textContent);
    }
  };
  walk();
  for (let i = 0; i < 8; i++) { collect(); arcade.runTimers(); }
  collect();
  return seen;
}

// The Market button is live during `buy-farm`, so a player short of 500元 can go
// back and earn it — which means the appraisal lands in `buy-farm` more than
// once, and the opening's camera move must not replay every time.
test('coming back short of the farm replays neither the pan nor its card', async () => {
  const c = makeCampaign();
  finishFirstRun(c, 100);                       // nowhere near the price of the farm
  const { $, arcade } = await bootGame({ state: { [CAMPAIGN_KEY]: packCampaign(c) } });
  $('play-campaign').fire('click');
  assert.equal(screen($), 'farm');
  assert.equal($('to-market').disabled, false, 'the leftover gift crate was unsellable');

  $('to-market').fire('click');                 // a second market day, before the farm
  assert.equal(screen($), 'market');
  arcade.tick(2);
  $('pack-up').fire('click');
  arcade.tick(1);
  $('appraisal-done').fire('click');
  assert.equal(screen($), 'farm');
  assert.equal($('cards').children.length, 0, 'the opening card came back for an encore');
});

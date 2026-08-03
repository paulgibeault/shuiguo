// The campaign's storage, and the rules for where a boot lands.
//
// Both campaign hosts read and write the same two keys, so the plumbing lives
// here rather than being duplicated (and drifting) between them:
//
//   campaign      cash, farm, seeds, unlocks, flags, crate     (Arcade.state)
//   market-save   a mid-run campaign board + that run's tally  (Arcade.state)
//
// FREE PLAY'S KEYS ARE NOT TOUCHED BY ANY PATH THROUGH THIS FILE. `save`,
// `discovered` and the `classic` score lane belong to js/main.js and stay
// exactly as they were; the campaign lives alongside them, never on top of
// them. tests/free-play-isolation pins that by enumerating what each mode may
// write.
//
// Save discipline matches the board's: a debounced write during play, and a
// synchronous flush in Arcade.onSuspend so it lands inside the grace window.

import { serialize as serializeCampaign, restore as restoreCampaign, makeCampaign } from './campaign.js';

export const CAMPAIGN_KEY = 'campaign';
export const MARKET_KEY = 'market-save';

// Keys free play owns: today's mid-run board, and which friends are still
// picking the next morning's produce (js/friends.js §the morning after — a
// friend's farm is not the player's, and the campaign has never heard of it).
// Named here so the isolation test can assert the two sets never intersect,
// rather than trusting a comment.
export const FREE_PLAY_KEYS = ['save', 'stalls'];
export const CAMPAIGN_KEYS = [CAMPAIGN_KEY, MARKET_KEY];

export function makeCampaignSave(state) {
  let campaign = null;
  let dirty = false;

  // The campaign state object, loaded on first use. A save we cannot read is a
  // fresh campaign rather than an error: the player gets their gift run back,
  // which is the most generous thing a broken save can mean.
  function load() {
    if (campaign) return campaign;
    campaign = restoreCampaign(state.get(CAMPAIGN_KEY)) || makeCampaign();
    return campaign;
  }

  function flush() {
    if (!campaign) return;
    state.set(CAMPAIGN_KEY, serializeCampaign(campaign));
    dirty = false;
  }

  return {
    get: load,
    touch() { dirty = true; },
    isDirty() { return dirty; },
    flush,
    flushIfDirty() { if (dirty) flush(); },

    // Recompute from storage — Arcade.onStateReplaced, or a sync from another
    // device. Drops the in-memory copy so the next get() re-reads.
    reload() { campaign = null; dirty = false; return load(); },

    // ── the mid-run board ────────────────────────────────────────────────
    // The crate rides here rather than inside js/game.js's payload: the game
    // module owns a board, and the harvest that feeds it is the host's.
    readMarket() { return state.get(MARKET_KEY); },
    writeMarket(payload) { state.set(MARKET_KEY, payload); },
    clearMarket() { state.remove(MARKET_KEY); },
  };
}

/**
 * Where a boot lands.
 *
 * The rules, in order, and each is the answer to "what was this player in the
 * middle of?":
 *
 *   1. A mid-run campaign board resumes into the market. Someone was mid-drop.
 *   2. A mid-game free-play board resumes into free play — unchanged, and
 *      FIRST among the free-play paths so today's behaviour is preserved for
 *      anyone who has never touched the campaign.
 *   3. Otherwise the mode menu, which is the only genuinely new screen in the
 *      boot path.
 *
 * A campaign in progress does NOT auto-open the farm: the farm is a place you
 * choose to go, and dropping the player into it on every launch would make the
 * game feel like it wanted something from them.
 */
export function bootScreen({ marketSave, freePlaySave }) {
  if (marketSave) return 'market';
  if (freePlaySave) return 'free-play-resume';
  return 'mode';
}

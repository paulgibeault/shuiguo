// Which screen is up.
//
// The game grew from three screens (menu / board / game over) to seven, split
// across three hosts that must never both think they are driving. So routing
// stops being a `show()` helper inside js/main.js and becomes one object that
// owns the whole set: exactly one screen is current, every other sheet is
// hidden, and a host learns it is on or off through its own enter/exit hooks
// rather than by inspecting the DOM.
//
// It touches elements but knows nothing about this game — screens are handed
// in by the hosts at boot — so it tests against plain `{ hidden: false }`
// objects with no DOM at all.
//
// The one rule that makes it safe to have three hosts: `enter` and `exit` are
// called with the OTHER screen's name, and exit always runs before enter. A
// host that stops its loop in exit can rely on that having happened before the
// next host starts its own.

export function makeRouter() {
  const screens = new Map();
  let current = null;

  function apply() {
    for (const [name, spec] of screens) {
      const on = name === current;
      if (spec.sheet) spec.sheet.hidden = !on;
      // Chrome that belongs to a screen rather than to the frame — the score
      // HUD, the crate strip, the farm's cash bar.
      for (const el of spec.chrome) el.hidden = !on;
    }
  }

  return {
    /**
     * Register one screen.
     *
     * spec: { sheet, chrome = [], onEnter(from), onExit(to) }
     * A screen with no sheet is a bare canvas view (the board), which is what
     * "playing" looks like: every sheet hidden, chrome up.
     */
    add(name, spec = {}) {
      screens.set(name, {
        sheet: spec.sheet || null,
        chrome: spec.chrome || [],
        onEnter: spec.onEnter || null,
        onExit: spec.onExit || null,
      });
      return this;
    },

    /**
     * Go to a screen. Re-routing to the screen already up is a no-op — hosts
     * call route() freely from settings changes and resume handlers, and
     * re-entering would restart animations and re-run one-shot staging.
     */
    route(name) {
      if (!screens.has(name)) throw new Error(`no such screen: ${name}`);
      if (current === name) return false;
      const from = current;
      const leaving = from == null ? null : screens.get(from);
      current = name;
      apply();
      if (leaving && leaving.onExit) leaving.onExit(name);
      const entering = screens.get(name);
      if (entering.onEnter) entering.onEnter(from);
      return true;
    },

    current() { return current; },
    is(name) { return current === name; },
    has(name) { return screens.has(name); },

    // Re-assert the DOM from the current screen. For onSettingsChange and
    // onStateReplaced, where something else may have moved the furniture.
    refresh() { apply(); },
  };
}

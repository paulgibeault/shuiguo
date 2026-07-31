// Stage the deploy artifact: tracked files minus the dev set.
//
// The per-app half of the fleet CI contract (GAME_INTEGRATION.md §13a):
// exports stage(outDir) and ROOT; the deploy job runs exactly this module,
// and tools/verify-artifact.mjs (byte-identical fleet-wide) proves the result.
//
// Usage: node tools/stage.mjs <outDir>
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectPrecache } from "./inject-precache.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Published, deliberately not precached: the audition timeline (players never
// hear the test material) and its config, and the licence text.
export const PRECACHE_EXCLUDE = [
  "audio/audition.js",
  "soundpack.config.json",
  "LICENSE",
];

// Dev-only: tooling, tests, notes, and local helpers.
const EXCLUDE_DIRS = new Set([".github", ".claude", "node_modules",
  "tests", "test", "docs", "scratch", "tools", "scripts"]);
const EXCLUDE_ROOT = new Set(["package.json", "package-lock.json",
  ".gitignore", "go.sh", "ago"]);
const EXCLUDE_EXT = new Set([".md", ".py", ".pid"]);

export function isDevOnly(f) {
  return EXCLUDE_DIRS.has(f.split("/")[0]) ||
    (!f.includes("/") && EXCLUDE_ROOT.has(f)) ||
    (!f.includes("/") && /^test_/.test(f)) ||
    EXCLUDE_EXT.has(path.extname(f));
}

/** Stage into outDir and return it. */
export function stage(outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  const files = execSync("git ls-files -z", { cwd: ROOT, encoding: "utf8" })
    .split("\0").filter(Boolean);
  let staged = 0;
  for (const f of files) {
    if (isDevOnly(f)) continue;
    fs.mkdirSync(path.join(outDir, path.dirname(f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(outDir, f));
    staged++;
  }
  // Last, so the precache list is written from what actually deploys.
  injectPrecache(outDir, { exclude: PRECACHE_EXCLUDE });
  return { outDir, staged, total: files.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = process.argv[2];
  if (!out) { console.error("usage: node tools/stage.mjs <outDir>"); process.exit(1); }
  const r = stage(path.resolve(ROOT, out));
  console.log(`staged ${r.staged} files to ${out}/ (${r.total - r.staged} dev files excluded)`);
}

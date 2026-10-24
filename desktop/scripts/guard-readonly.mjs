// CI guard: Treatable Desktop work must not modify the extension, the scaffold,
// the installer, or the root install scripts. Usage: node scripts/guard-readonly.mjs [baseRef]
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEFAULT_BASE = "e61f744";

/** True when a repo-relative path belongs to a read-only area. */
export function isProtectedPath(file) {
  const p = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (p.startsWith("extension/") || p.startsWith("scaffold/") || p.startsWith("installer/")) return true;
  return /^install-[^/]*\.(?:sh|ps1)$/.test(p);
}

export function offenders(files) {
  return [...new Set(files)].filter(isProtectedPath).sort();
}

export function changedFiles(base) {
  // Paths are reported relative to the repository root regardless of the cwd.
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const run = (args) => execFileSync("git", ["-C", top, ...args], { encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean);
  const committed = run(["diff", "--name-only", `${base}...HEAD`]);
  const working = run(["diff", "--name-only", "HEAD"]);
  const untracked = run(["ls-files", "--others", "--exclude-standard"]);
  return [...committed, ...working, ...untracked];
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const base = process.argv[2] || process.env.GUARD_BASE || DEFAULT_BASE;
  const bad = offenders(changedFiles(base));
  if (bad.length) {
    console.error(`Read-only paths changed since ${base}:`);
    for (const f of bad) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`guard-readonly: no protected paths changed since ${base}.`);
}

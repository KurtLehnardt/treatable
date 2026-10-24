import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain JavaScript module without type declarations
import { isProtectedPath, offenders } from "../scripts/guard-readonly.mjs";

test("protected paths are classified", () => {
  for (const p of ["extension/src/core.ts", "scaffold/data/studies.json", "installer/package.json", "install-mac.sh", "install-win.ps1"]) {
    assert.equal(isProtectedPath(p), true, p);
  }
});

test("desktop and other paths are allowed", () => {
  for (const p of ["desktop/src/main/index.ts", "README.md", "docs/install-notes.md", "desktop/install-x.sh", "extensions/a.ts", "installer-notes.md"]) {
    assert.equal(isProtectedPath(p), false, p);
  }
});

test("offenders lists unique protected paths only", () => {
  assert.deepEqual(offenders(["desktop/a.ts", "extension/a.ts", "extension/a.ts", "install-linux.sh"]), ["extension/a.ts", "install-linux.sh"]);
});

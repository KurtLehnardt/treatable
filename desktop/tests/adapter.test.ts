import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const srcDir = new URL("../src/", import.meta.url).pathname;
const adapter = join(srcDir, "main/core/extensionCore.ts");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const IMPORT_RE = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\)/g;
const specifiers = (text: string): string[] => [...text.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3]);

test("the adapter exists", () => {
  assert.ok(existsSync(adapter));
});

test("only the adapter imports from extension/ or scaffold/", () => {
  const offenders: string[] = [];
  for (const file of walk(srcDir).filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && f !== adapter)) {
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      if (/(^|\/)(extension|scaffold)(\/|$)/.test(spec)) offenders.push(`${relative(srcDir, file)}: ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the adapter imports no forbidden extension modules", () => {
  const forbidden = /\/(panel|storage|background|native|hipaaGate)(\.[a-z]+)?$/;
  const specs = specifiers(readFileSync(adapter, "utf8"));
  assert.ok(specs.length > 0);
  assert.deepEqual(specs.filter((s) => forbidden.test(s)), []);
  assert.ok(specs.every((s) => /(^|\/)(extension)\//.test(s)), "adapter imports only from extension/");
});

test("the adapter loads and runs an unrefined pipeline on the real snapshot", async () => {
  const core = await import("../src/main/core/extensionCore");
  const dir = new URL("../../scaffold/data/", import.meta.url).pathname;
  const studies = JSON.parse(readFileSync(join(dir, "studies.json"), "utf8"));
  const zips = JSON.parse(readFileSync(join(dir, "us-zip-centroids.json"), "utf8"));
  assert.equal(studies.length, 2000);
  const profile = core.profileFromForm({ condition: "lumbar disc herniation", notes: "", age: "45", sex: "female", zip: "55905", radius: "anywhere" }, zips);
  const result = await core.runPipeline({ studies, profile, unrefinedReason: "test" });
  assert.equal(result.mode, "unrefined");
  assert.equal(result.corpusCount, 2000);
  assert.ok(result.studies.every((s) => s.breakdown.final <= 79));
  assert.equal(typeof core.hasLocalWeights, "function");
  assert.ok(core.MODEL_PATTERN instanceof RegExp);
});

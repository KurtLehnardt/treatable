#!/usr/bin/env node
/**
 * CON-02 — WCAG AA contrast checker for the design-token contract (R7.6).
 *
 * Computes real WCAG 2.x relative-luminance contrast ratios (not "by eye")
 * for every intended fg/bg pairing in the token contract, plus a set of
 * advisory pairings that are *expected* to fail and are documented as
 * unsupported usages rather than silently worked around.
 *
 * Exit code is 1 if any REQUIRED pairing fails its threshold. Advisory
 * pairings are always printed but never affect the exit code — they exist
 * so the constraint is visible to whoever builds R7.3 later, not to gate
 * this task.
 *
 * NOTE ON SOURCE OF TRUTH: this script intentionally does NOT import
 * lib/design/tokens.ts. tokens.ts is consumed by tailwind.config.ts (which
 * Tailwind loads via its own bundler, so a .ts-importing-.ts is fine
 * there) and by React components (compiled by Next). This script is meant
 * to run standalone under plain `node` in CI, where the Node major version
 * is not guaranteed to support importing TypeScript directly. The hex
 * values below are therefore literal and MUST be kept in sync with
 * lib/design/tokens.ts by hand if either changes. This is a deliberate
 * portability tradeoff — see the CON-02 report.
 */

// ---------------------------------------------------------------------------
// WCAG 2.x contrast math
// ---------------------------------------------------------------------------

function srgbToLinear(c) {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const int = parseInt(full, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const [rl, gl, bl] = [r, g, b].map(srgbToLinear);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------------------
// Token values (keep in sync with lib/design/tokens.ts)
// ---------------------------------------------------------------------------

const light = {
  canvas: "#f9f9f9",
  canvasAlt: "#ecf1f7",
  foreground: "#212121",
  structureFill: "#005ea2",
  structureOnCanvas: "#005ea2",
  action: "#538200",
  white: "#ffffff",
  // H8 — theme-independent dark ink for text on a semantic fill (badges/chips).
  onSemantic: "#212121",
};

const dark = {
  canvas: "#1b1b1b",
  canvasAlt: "#16232c",
  foreground: "#f1f1f1",
  structureFill: "#005ea2",
  structureOnCanvas: "#73b3e7",
  action: "#538200",
  white: "#ffffff",
  // H8 — identical to light (theme-independent; the fills don't flip).
  onSemantic: "#212121",
};

const semantic = {
  info: "#00bde3",
  success: "#04c585",
  warning: "#ffbe2e",
  error: "#e52207",
};

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3.0;

// ---------------------------------------------------------------------------
// Pairings that the design system actually uses. These must all pass.
// ---------------------------------------------------------------------------

const REQUIRED_PAIRINGS = [
  ["light: body text on canvas", light.foreground, light.canvas, AA_TEXT],
  ["light: body text on canvas-alt (card/section fill)", light.foreground, light.canvasAlt, AA_TEXT],
  ["light: white text on structure fill (navy header/nav/buttons)", light.white, light.structureFill, AA_TEXT],
  ["light: structure link/heading text on canvas", light.structureOnCanvas, light.canvas, AA_TEXT],
  ["light: structure link/heading text on canvas-alt", light.structureOnCanvas, light.canvasAlt, AA_TEXT],
  ["light: white text on action (primary CTA / progress fill) — spec: ~4.6:1, no margin", light.white, light.action, AA_TEXT],
  ["light: white text on error fill (banner/badge)", light.white, semantic.error, AA_TEXT],
  // H8 — tier/eligibility badges: theme-independent dark ink (--color-on-semantic),
  // NOT --color-foreground (which flips near-white in dark mode). Guarded in BOTH
  // themes because these badges ship live via prefers-color-scheme.
  ["light: badge ink on info fill (chip/badge)", light.onSemantic, semantic.info, AA_TEXT],
  ["light: badge ink on success fill (chip/badge)", light.onSemantic, semantic.success, AA_TEXT],
  ["light: badge ink on warning fill (chip/badge)", light.onSemantic, semantic.warning, AA_TEXT],
  ["[non-text] light: action fill vs canvas-alt (progress track)", light.action, light.canvasAlt, AA_NON_TEXT],
  ["[non-text] light: action fill vs canvas", light.action, light.canvas, AA_NON_TEXT],

  ["dark: body text on canvas", dark.foreground, dark.canvas, AA_TEXT],
  ["dark: body text on canvas-alt", dark.foreground, dark.canvasAlt, AA_TEXT],
  ["dark: white text on structure fill (theme-independent pairing)", dark.white, dark.structureFill, AA_TEXT],
  ["dark: structure link/heading text on canvas (uses blue-30v, NOT raw navy)", dark.structureOnCanvas, dark.canvas, AA_TEXT],
  ["dark: structure link/heading text on canvas-alt", dark.structureOnCanvas, dark.canvasAlt, AA_TEXT],
  ["dark: white text on action (theme-independent pairing)", dark.white, dark.action, AA_TEXT],
  ["dark: white text on error fill (theme-independent pairing)", dark.white, semantic.error, AA_TEXT],
  // H8 — the same tier/eligibility badges in dark mode. The ink is theme-
  // independent (dark.onSemantic === light.onSemantic) and the fills are
  // constant, so these must clear AA here too — this is the pairing that was
  // ~1.4-1.9:1 when the badges used the (flipped) foreground token.
  ["dark: badge ink on info fill (chip/badge)", dark.onSemantic, semantic.info, AA_TEXT],
  ["dark: badge ink on success fill (chip/badge)", dark.onSemantic, semantic.success, AA_TEXT],
  ["dark: badge ink on warning fill (chip/badge)", dark.onSemantic, semantic.warning, AA_TEXT],
];

// ---------------------------------------------------------------------------
// Advisory pairings — combinations the spec raises or that are tempting to
// reach for, verified here specifically so nobody "fixes" the failure by
// eye later. These are NOT used anywhere in the token contract and do not
// gate the script's exit code.
// ---------------------------------------------------------------------------

const ADVISORY_PAIRINGS = [
  ["white text on success fill — DO NOT USE (spec-flagged: fails, this is why success uses dark text)", light.white, semantic.success, AA_TEXT],
  ["white text on warning fill — DO NOT USE (spec-flagged: fails, this is why warning uses dark text)", light.white, semantic.warning, AA_TEXT],
  ["dark text on error fill — DO NOT USE (error uses white text instead)", light.foreground, semantic.error, AA_TEXT],
  ["error as small/normal inline text directly on light canvas — DO NOT USE this way (use a filled badge instead)", semantic.error, light.canvas, AA_TEXT],
  ["error as small/normal inline text directly on dark canvas — DO NOT USE this way", semantic.error, dark.canvas, AA_TEXT],
  ["[non-text] info as a bare border/icon directly on light canvas — DO NOT USE this way (use a filled chip)", semantic.info, light.canvas, AA_NON_TEXT],
  ["[non-text] success as a bare border/icon directly on light canvas — DO NOT USE this way", semantic.success, light.canvas, AA_NON_TEXT],
  ["[non-text] warning as a bare border/icon directly on light canvas — DO NOT USE this way", semantic.warning, light.canvas, AA_NON_TEXT],
  ["raw structure navy (#005ea2) as text directly on DARK canvas — DO NOT USE (this is why dark mode substitutes #73b3e7)", light.structureOnCanvas, dark.canvas, AA_TEXT],
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function row(label, fg, bg, min) {
  const ratio = contrastRatio(fg, bg);
  const pass = ratio >= min;
  return { label, fg, bg, min, ratio, pass };
}

function printTable(title, rows) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
  for (const r of rows) {
    const status = r.pass ? "PASS" : "FAIL";
    console.log(
      `${status}  ${r.ratio.toFixed(2)}:1  (min ${r.min.toFixed(1)}:1)  fg=${r.fg} bg=${r.bg}  ${r.label}`
    );
  }
}

const requiredRows = REQUIRED_PAIRINGS.map(([label, fg, bg, min]) => row(label, fg, bg, min));
const advisoryRows = ADVISORY_PAIRINGS.map(([label, fg, bg, min]) => row(label, fg, bg, min));

printTable("REQUIRED pairings (must pass — gates this check)", requiredRows);
printTable("ADVISORY pairings (documented constraints — informational only)", advisoryRows);

const failedRequired = requiredRows.filter((r) => !r.pass);

console.log("");
if (failedRequired.length > 0) {
  console.log(`FAILED: ${failedRequired.length} required pairing(s) do not meet WCAG AA.`);
  console.log("Per CON-02's escalation rule: do not silently substitute a different hex.");
  console.log("Escalate to product/design before changing any spec-mandated color.");
  process.exitCode = 1;
} else {
  console.log(`OK: all ${requiredRows.length} required pairings meet WCAG AA.`);
}

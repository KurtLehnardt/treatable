/**
 * Design-token contract (CON-02).
 *
 * Single source of truth for color, spacing, type scale, and breakpoint
 * tokens for fundFinder v2. Per R7.6, components must reference token
 * names — never raw hex — see scripts/design/check-hex.mjs.
 *
 * IMPORTANT: this file defines the CONTRACT. It does not restyle any v1
 * component. v1 continues to use the ad-hoc `paper/ink/federal/rule/fit-*`
 * keys in tailwind.config.ts unchanged; applying these tokens to components
 * is FE-01 (slice 2).
 *
 * Color values are USWDS tokens (R7.2) and are NOT to be adjusted for
 * contrast reasons without a spec change — see the contrast-check script
 * and CON-02's report for verified ratios. In particular: do not lighten
 * `action` (#538200); its AA margin against white text is real (~4.6:1)
 * but intentionally tight per spec.
 *
 * Keep scripts/design/contrast-check.mjs's PAIRINGS array in sync with the
 * hex values below if either changes — the script intentionally does not
 * import this file (see that file's header comment for why).
 */

// ---------------------------------------------------------------------------
// Colors — USWDS 60/30/10 (R7.2)
// ---------------------------------------------------------------------------

/**
 * 60% — neutral canvas. Primary background + alternating-section /
 * card-fill background, plus body text.
 *
 * 30% — navy "structure". Header, nav, hero, section headings, links,
 * secondary buttons, borders. Two roles are distinguished on purpose:
 *   - `structureFill`: navy used as a substantial fill (header bar, a
 *     solid secondary-button background) with white content on top.
 *     Verified AA in both themes (see contrast-check output).
 *   - `structureOnCanvas`: navy used as small text/links/thin borders
 *     directly on the canvas background. In light mode this is the same
 *     #005ea2 hex — it clears AA there. In dark mode raw #005ea2 on the
 *     dark canvas measures 2.56:1 (fails AA, and fails the 3:1 non-text
 *     threshold too), so dark mode uses a lighter USWDS blue (#73b3e7,
 *     "blue-30v") for this role instead. This split is a measured
 *     necessity, not a stylistic choice — see the CON-02 report.
 *
 * 10% — green "action". Reserved for the primary CTA ("Find opportunities")
 * and the R4 progress-bar fill. Nothing else. Do not lighten: white text on
 * #538200 measures ~4.60:1, which clears AA (4.5:1) with effectively no
 * margin. Any darker/desaturated variant risks failing.
 *
 * `#cd425b` (decorative red) is deliberately NOT included as a token.
 * R7.2 says to drop it from the decorative palette — it sits too close to
 * `error` (#e52207) and would train users to ignore red. Escalate to
 * product if a real use case needs it; do not add it silently.
 */
export const colors = {
  light: {
    canvas: "#f9f9f9",
    canvasAlt: "#ecf1f7",
    foreground: "#212121",
    structureFill: "#005ea2",
    structureOnCanvas: "#005ea2",
    action: "#538200",
    white: "#ffffff",
    // H8 — dark ink for text on a semantic fill. THEME-INDEPENDENT: identical
    // in dark below on purpose (the fills don't flip, so the ink must not
    // either). foreground is NOT used for these badges because it flips near-
    // white in dark mode and fails AA on the light semantic fills.
    onSemantic: "#212121",
  },
  dark: {
    canvas: "#1b1b1b",
    canvasAlt: "#16232c",
    foreground: "#f1f1f1",
    structureFill: "#005ea2",
    structureOnCanvas: "#73b3e7",
    action: "#538200",
    white: "#ffffff",
    // H8 — identical to light (theme-independent; see the light note above).
    onSemantic: "#212121",
  },
} as const;

/**
 * Reserved semantic tokens (R7.2 / R7.3). Never decorative, never restyled,
 * never repurposed for the CTA. Same hex in both themes — each is used as a
 * self-contained fill (chip/badge/banner), not as a bare accent directly on
 * the page canvas.
 *
 * Verified usage per contrast-check (see CON-02 report for the full table):
 *   - info / success / warning: dark content (#212121) text on the fill.
 *     White text FAILS AA on success (2.25:1) and warning (1.66:1) — this
 *     is exactly R7.2's documented reason to keep the CTA off success-green.
 *   - error: white text on the fill (4.60:1, passes with the same tight
 *     margin as `action`). Dark text on error fails (3.50:1).
 *   - None of the four are AA-safe as a *bare* small icon/border/inline-text
 *     element directly on `colors.light.canvas` (all measure well under the
 *     3:1 non-text threshold — info 2.12:1, warning 1.58:1, success 2.14:1;
 *     error as inline text measures 4.37:1, just under the 4.5:1 text
 *     threshold). Use them as filled chips/badges/banners with adequate
 *     area, not as 1–2px accents on bare canvas. Flagged for Team Frontend /
 *     Team Verification ahead of R7.3's application work.
 */
export const semantic = {
  info: "#00bde3",
  success: "#04c585",
  warning: "#ffbe2e",
  error: "#e52207",
} as const;

// ---------------------------------------------------------------------------
// Spacing scale — 4px base grid
// ---------------------------------------------------------------------------

export const spacing = {
  0: "0px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
  20: "80px",
  24: "96px",
  32: "128px",
} as const;

// ---------------------------------------------------------------------------
// Type scale
// ---------------------------------------------------------------------------

export const fontSize = {
  xs: ["12px", { lineHeight: "16px" }],
  sm: ["14px", { lineHeight: "20px" }],
  base: ["16px", { lineHeight: "24px" }],
  lg: ["18px", { lineHeight: "28px" }],
  xl: ["20px", { lineHeight: "28px" }],
  "2xl": ["24px", { lineHeight: "32px" }],
  "3xl": ["30px", { lineHeight: "36px" }],
  "4xl": ["36px", { lineHeight: "40px" }],
  "5xl": ["48px", { lineHeight: "52px" }],
} as const satisfies Record<string, [string, { lineHeight: string }]>;

// ---------------------------------------------------------------------------
// Breakpoints (R7.4) — mobile-first, USWDS-aligned
// ---------------------------------------------------------------------------

/**
 * `xs` (360px) is the minimum supported width, not a design target below
 * which layout is expected to hold — see R7.4's `[DECIDE]`. The rest of the
 * scale mirrors USWDS's own breakpoint set (mobile-lg / tablet / tablet-lg /
 * desktop / desktop-lg / widescreen) so the token contract stays consistent
 * with the R7.2 USWDS basis.
 */
export const breakpoints = {
  xs: "360px",
  sm: "480px",
  md: "640px",
  lg: "880px",
  xl: "1024px",
  "2xl": "1200px",
  "3xl": "1400px",
} as const;

export const minSupportedWidth = breakpoints.xs;

// ---------------------------------------------------------------------------
// Aggregate export
// ---------------------------------------------------------------------------

export const tokens = {
  colors,
  semantic,
  spacing,
  fontSize,
  breakpoints,
  minSupportedWidth,
} as const;

export type ThemeName = keyof typeof colors;
export type ColorToken = keyof (typeof colors)["light"];
export type SemanticToken = keyof typeof semantic;
export type BreakpointToken = keyof typeof breakpoints;

export default tokens;

import type { Config } from "tailwindcss";
import { spacing, fontSize, breakpoints } from "./lib/design/tokens";

// CON-02 design-token contract. These are ADDITIVE, namespaced entries
// under `extend` — none of the v1 keys below (paper/ink/slate/federal/
// rule/fit-*) are touched, and no default Tailwind screen name (sm/md/
// lg/xl/2xl) is redefined, so v1 components render identically. Colors
// are exposed as CSS variables (see app/globals.css) rather than literal
// hex here, so the light/dark split lives in one place.
export default {
  darkMode: "media",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // v1 (unchanged)
        paper: "#FBFAF7",
        ink: "#12161C",
        slate: { 550: "#5A6572" },
        federal: "#1B3A6B",
        rule: "#DDD8CE",
        fit: { strong: "#1E7A4C", verify: "#B4801A", adjacent: "#C25A2B", none: "#6B7280" },

        // v2 design-token contract (CON-02) — CSS-variable-backed, themeable.
        // Not yet applied to any component (that's FE-01, slice 2).
        canvas: "var(--color-canvas)",
        "canvas-alt": "var(--color-canvas-alt)",
        foreground: "var(--color-foreground)",
        structure: "var(--color-structure-fill)",
        "structure-on-canvas": "var(--color-structure-on-canvas)",
        action: "var(--color-action)",
        "token-white": "var(--color-white)",
        info: "var(--color-info)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        error: "var(--color-error)",
        // H8: theme-independent dark ink for text on info/success/warning fills.
        "on-semantic": "var(--color-on-semantic)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },

      // Polish pass — elevation shadows, CSS-variable-backed so they adapt
      // light/dark from app/globals.css (see --shadow-* there). Used to give
      // cards / panels / overlays depth instead of a hard navy border.
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        overlay: "var(--shadow-overlay)",
      },
      letterSpacing: { eyebrow: "0.14em" },

      // v2 type scale (CON-02). Additive — v1 uses arbitrary text-[Npx]
      // values today and is untouched.
      fontSize,

      // v2 spacing scale (CON-02). Additive on top of Tailwind's default
      // spacing scale; does not remove or redefine any existing value.
      spacing,

      // v2 breakpoints (R7.4), namespaced under `bp-*` so they cannot
      // collide with or redefine Tailwind's default sm/md/lg/xl/2xl —
      // those keep their default pixel values so v1 responsive classes
      // (`sm:`, `lg:`) are unaffected. FE-01 adopts `bp-*` explicitly.
      screens: {
        "bp-xs": breakpoints.xs,
        "bp-sm": breakpoints.sm,
        "bp-md": breakpoints.md,
        "bp-lg": breakpoints.lg,
        "bp-xl": breakpoints.xl,
        "bp-2xl": breakpoints["2xl"],
        "bp-3xl": breakpoints["3xl"],
      },
    },
  },
  plugins: [],
} satisfies Config;

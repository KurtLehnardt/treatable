/** Styles for the guide host. The vendor stylesheet is adapted so it works inside a shadow root. */

/**
 * sweetalert2 declares its design tokens on `:root`, which never matches inside a shadow tree, and keeps a few
 * layout rules behind `body.swal2-*` selectors, which cannot match either. Tokens move to `:host`; the layout
 * rules are replaced by the explicit rules in GUIDE_CSS below.
 */
export function scopeSwalCss(css: string): string {
  return css.replace(/:root/g, ':host');
}

/** Rules appended after the vendor sheet. Every guide dialog is non-blocking, so the container never takes clicks. */
export const GUIDE_CSS = `
:host {
  all: initial;
  display: block;
  position: fixed;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
  font: 15px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #203b35;
  --swal2-confirm-button-background-color: #205d47;
  --swal2-confirm-button-color: #fff;
  --swal2-deny-button-background-color: #53685e;
  --swal2-deny-button-color: #fff;
  --swal2-cancel-button-background-color: transparent;
  --swal2-cancel-button-color: #203b35;
  --swal2-border-radius: 16px;
  --swal2-width: 22rem;
  --swal2-color: #203b35;
  --swal2-outline: 0 0 0 3px #507e5e;
}
.swal2-container {
  pointer-events: none;
  background: transparent !important;
  font: 15px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.swal2-container .swal2-popup { max-width: calc(100vw - 32px); box-sizing: border-box; }
/* sweetalert2 positions toasts through a body class, which a shadow tree cannot see, so the one toast position the guide uses is set here. */
.swal2-container:has(> .swal2-toast) { box-sizing: border-box; width: 360px; max-width: 100%; inset: auto 0 0 auto; }
.swal2-container .swal2-popup {
  pointer-events: auto;
  box-shadow: 0 1px 3px #183e3426, 0 12px 34px #183e3440;
  border: 1px solid #d5dfd5;
  font-size: 15px;
}
.swal2-container .swal2-title {
  font: 600 1.15rem/1.3 Georgia, serif;
  padding: 0.9rem 1rem 0;
}
.swal2-container .swal2-html-container {
  font-size: 0.95rem;
  line-height: 1.45;
  text-align: left;
  margin: 0.6rem 1rem 0;
  padding: 0;
}
.swal2-container .swal2-html-container p { margin: 0 0 0.5rem; }
.swal2-container .swal2-actions { gap: 0.4rem; margin-top: 1rem; }
.swal2-container .swal2-styled { min-height: 44px; min-width: 44px; font-size: 0.9rem; font-weight: 650; }
.swal2-container .swal2-styled.swal2-cancel { text-decoration: underline; text-underline-offset: 3px; border: 1px solid transparent; }
.swal2-container .swal2-styled:focus-visible { outline: 3px solid #507e5e; outline-offset: 2px; box-shadow: none; }
.swal2-container [data-swal2-theme="dark"] .swal2-popup,
.swal2-container[data-swal2-theme="dark"] .swal2-popup { border-color: #3b5145; }
.swal2-container[data-swal2-theme="dark"] { --swal2-cancel-button-color: #e7f0e8; --swal2-confirm-button-background-color: #a0d3b1; --swal2-confirm-button-color: #183326; }
@media (prefers-color-scheme: dark) {
  .swal2-container[data-swal2-theme="auto"] { --swal2-cancel-button-color: #e7f0e8; --swal2-confirm-button-background-color: #a0d3b1; --swal2-confirm-button-color: #183326; }
}
@media (prefers-reduced-motion: reduce) {
  .swal2-container *, .swal2-container *::before, .swal2-container *::after { animation: none !important; transition: none !important; }
}
`;

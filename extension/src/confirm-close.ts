import Swal from 'sweetalert2/dist/sweetalert2.esm.js';
import swalCss from './guide-swal-css';

/** Confirmation shown before Treatable closes while the person has typed something that closing would clear. */
export const DISCARD_TITLE = 'Close Treatable and clear what you typed?';
export const DISCARD_TEXT = 'Closing ends this session. The details, drafts and notes you typed here are cleared and cannot be brought back. Nothing is saved.';
export const DISCARD_CONFIRM = 'Close and clear';
export const DISCARD_CANCEL = 'Keep working';

/** The popup is centered by sweetalert2 itself. These rules round the dimmed backdrop to the frame's corners, size the buttons, and set the focus ring and colors. */
const CONFIRM_CSS = `
.treatable-confirm-container { border-radius: 20px; }
.treatable-confirm-popup { max-width: calc(100vw - 32px); box-sizing: border-box; --swal2-confirm-button-background-color: #8a2d1f; --swal2-confirm-button-color: #fff; --swal2-cancel-button-background-color: #205d47; --swal2-cancel-button-color: #fff; }
.treatable-confirm-popup .swal2-styled { min-height: 44px; min-width: 44px; font-weight: 650; }
.treatable-confirm-popup .swal2-styled:focus-visible { outline: 3px solid #507e5e; outline-offset: 2px; box-shadow: none; }
@media (prefers-reduced-motion: reduce) { .swal2-container *, .swal2-container *::before, .swal2-container *::after { animation: none !important; transition: none !important; } }
`;

const styled = new WeakSet<Document>();

/** Adds the packaged sweetalert2 stylesheet to this frame once. A constructed stylesheet is used because the frame's content security policy forbids style elements. */
function installStyles(doc: Document) {
  if (styled.has(doc)) return;
  styled.add(doc);
  const css = swalCss + CONFIRM_CSS;
  const win = doc.defaultView as any;
  try {
    if (win?.CSSStyleSheet && 'adoptedStyleSheets' in doc) {
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(css);
      (doc as any).adoptedStyleSheets = [...(doc as any).adoptedStyleSheets, sheet];
      return;
    }
  } catch { /* Fall back to a style element. */ }
  const style = doc.createElement('style');
  style.textContent = css;
  doc.head.appendChild(style);
}

/** The title is built as a text node so nothing in it is ever read as markup. */
const titleElement = (text: string) => { const span = document.createElement('span'); span.textContent = text; return span; };
const reducedMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/**
 * Asks whether to close and clear. Resolves true only when the person confirms; Cancel, Escape, a click outside the
 * dialog, and closeDiscardDialog all resolve false, so nothing is lost by any other way of leaving the dialog.
 *
 * Focus moves to the safe button ("Keep working") and returns to the control that had it when the dialog closes. The
 * return is done here rather than by sweetalert2, which keeps one "previous element" for the whole frame and would
 * hand focus back to a stale element once the intro tour has used the library.
 * sweetalert2 listens for Escape on the window in the capture phase and stops that keydown there, so the same key
 * press never reaches the overlay's own Escape handler.
 */
export async function confirmDiscard(options: { theme?: 'light' | 'dark' } = {}): Promise<boolean> {
  installStyles(document);
  const opener = document.activeElement as HTMLElement | null;
  const result = await Swal.fire({
    title: titleElement(DISCARD_TITLE),
    text: DISCARD_TEXT,
    showCancelButton: true,
    confirmButtonText: DISCARD_CONFIRM,
    cancelButtonText: DISCARD_CANCEL,
    focusCancel: true,
    focusConfirm: false,
    returnFocus: false,
    allowEscapeKey: true,
    allowOutsideClick: true,
    keydownListenerCapture: true,
    stopKeydownPropagation: true,
    heightAuto: false,
    scrollbarPadding: false,
    animation: !reducedMotion(),
    theme: options.theme ?? 'auto',
    customClass: { container: 'treatable-confirm-container', popup: 'treatable-confirm-popup' },
  });
  if (!result.isConfirmed && opener?.isConnected && typeof opener.focus === 'function') {
    try { opener.focus({ preventScroll: true }); } catch { /* Focus is a convenience only. */ }
  }
  return result.isConfirmed === true;
}

/** Closes the dialog without a choice, for example when the session ends while it is open. The pending confirmDiscard resolves false. */
export function closeDiscardDialog() {
  try { if (Swal.getPopup()) Swal.close(); } catch { /* Nothing to close. */ }
}

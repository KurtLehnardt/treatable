import Swal from 'sweetalert2/dist/sweetalert2.esm.js';
import type { SweetAlertOptions } from 'sweetalert2';
import swalCss from './guide-swal-css';
import { GUIDE_CSS, scopeSwalCss } from './guide-style';
import { placePopup, rectOf, type PlaceRect } from './guide-place';

/** What the person chose in a guide dialog. `closed` means the guide itself closed or replaced the dialog. */
export type GuideChoice = 'next' | 'back' | 'skip' | 'closed';

export interface GuideDialog {
  title: string;
  /** Plain-text paragraphs. They are added with textContent, never as markup. */
  body: string[];
  next?: string;
  back?: string;
  skip?: string;
  /** The control the dialog points at. The dialog is placed clear of it. */
  target?: Element | null;
  /** A larger element holding the target (for example its filter list). The dialog sits beside it instead of over its neighbours. */
  context?: Element | null;
  /** Extra regions to keep clear, read at placement time (for example the collapsed Treatable frame). */
  avoid?: () => PlaceRect[];
  /** A small confirmation that closes on its own and takes no focus. */
  toast?: boolean;
  timerMs?: number;
  /** Focus this element after the dialog opens, so keyboard users stay at the control they were pointed to. */
  focus?: Element | null;
}

export interface GuideMount {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  fire(dialog: GuideDialog): Promise<GuideChoice>;
  /** Closes the open dialog, if any. Its promise resolves with `closed`. */
  closeActive(): void;
  readonly hasDialog: boolean;
  dispose(): void;
}

export interface GuideMountOptions {
  /** Vendor stylesheet text. Defaults to the build-substituted sweetalert2 CSS. */
  css?: string;
  /** Defaults to the largest value. The host is added after Treatable's own frame, so at equal height it draws above it. */
  zIndex?: number;
  theme?: 'light' | 'dark' | 'auto';
  mode?: 'open' | 'closed';
}

export const GUIDE_HOST_ATTRIBUTE = 'data-treatable-guide-host';

function installStyles(doc: Document, root: ShadowRoot, text: string) {
  const win = doc.defaultView as any;
  try {
    if (win?.CSSStyleSheet && 'adoptedStyleSheets' in root) {
      // A constructed stylesheet is not blocked by a strict page style-src, unlike a style element.
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(text);
      (root as any).adoptedStyleSheets = [sheet];
      return;
    }
  } catch { /* Fall back to a style element. */ }
  const style = doc.createElement('style');
  style.textContent = text;
  root.appendChild(style);
}

/**
 * Creates the guide's own shadow root and mounts sweetalert2 inside it through its `target` option.
 *
 * sweetalert2 finds its own container with `document.body.querySelector`, which cannot see into a shadow tree.
 * With a shadow-root target it would render and then fail to find its buttons. The mount therefore gives this
 * one document wrapper a narrow `querySelector` that also looks inside the guide's shadow root for sweetalert2's
 * own class names, and restores the original on dispose. In a content script the wrapper object belongs to the
 * extension's isolated world, so page scripts never see it.
 */
export function createGuideMount(doc: Document, options: GuideMountOptions = {}): GuideMount {
  const body = doc.body;
  const host = doc.createElement('div');
  host.setAttribute(GUIDE_HOST_ATTRIBUTE, '');
  const hostStyle: Record<string, string> = {
    all: 'initial', position: 'fixed', top: '0', left: '0', width: '0', height: '0', 'pointer-events': 'none',
    'z-index': String(options.zIndex ?? 2147483647), display: 'block',
  };
  for (const [property, value] of Object.entries(hostStyle)) host.style.setProperty(property, value, 'important');
  const root = host.attachShadow({ mode: options.mode ?? 'closed' });
  installStyles(doc, root, scopeSwalCss(options.css ?? swalCss) + GUIDE_CSS);
  const mountPoint = doc.createElement('div');
  root.appendChild(mountPoint);
  body.appendChild(host);

  const originalQuery = body.querySelector;
  const hadOwnQuery = Object.prototype.hasOwnProperty.call(body, 'querySelector');
  const bridge = function (this: Element, selector: string) {
    const found = originalQuery.call(this, selector);
    return found ?? (typeof selector === 'string' && selector.startsWith('.swal2-') ? root.querySelector(selector) : null);
  } as typeof body.querySelector;
  body.querySelector = bridge;

  const win = doc.defaultView!;
  let sequence = 0, open = false, inFlight = false, disposed = false, closedByGuide = false, detach: (() => void) | undefined;

  const release = () => { detach?.(); detach = undefined; };
  /** Closing a dialog does not stop its auto-close timer, which would otherwise fire after the mount is gone. */
  const closeSwal = () => { try { Swal.stopTimer(); } catch { /* No timer. */ } try { Swal.close(); } catch { /* Nothing to close. */ } };
  const reducedMotion = () => { try { return !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

  function titleElement(text: string) {
    const span = doc.createElement('span');
    span.textContent = text;
    return span;
  }

  function bodyFragment(paragraphs: string[]) {
    const wrapper = doc.createElement('div');
    for (const text of paragraphs) {
      const p = doc.createElement('p');
      p.textContent = text;
      wrapper.appendChild(p);
    }
    return wrapper;
  }

  function track(popup: HTMLElement, dialog: GuideDialog) {
    const place = () => {
      const box = popup.getBoundingClientRect();
      const target = dialog.target?.isConnected ? rectOf(dialog.target.getBoundingClientRect()) : null;
      const spot = placePopup({
        viewport: { width: win.innerWidth || 1024, height: win.innerHeight || 768 },
        size: { width: box.width || 352, height: box.height || 200 },
        target,
        context: dialog.context?.isConnected ? rectOf(dialog.context.getBoundingClientRect()) : null,
        avoid: dialog.avoid?.() ?? [],
      });
      popup.style.setProperty('position', 'fixed', 'important');
      popup.style.setProperty('margin', '0', 'important');
      popup.style.setProperty('left', `${spot.left}px`, 'important');
      popup.style.setProperty('top', `${spot.top}px`, 'important');
    };
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      const raf = win.requestAnimationFrame?.bind(win) ?? ((cb: FrameRequestCallback) => win.setTimeout(() => cb(0), 16));
      frame = raf(() => { frame = 0; if (open) place(); }) as number;
    };
    place();
    win.addEventListener('scroll', schedule, true);
    win.addEventListener('resize', schedule);
    return () => { win.removeEventListener('scroll', schedule, true); win.removeEventListener('resize', schedule); };
  }

  const mount: GuideMount = {
    host,
    root,
    get hasDialog() { return inFlight; },
    async fire(dialog) {
      if (disposed) return 'closed';
      const mine = ++sequence;
      release();
      closedByGuide = false;
      inFlight = true;
      const toast = dialog.toast === true;
      const common: SweetAlertOptions = {
        target: mountPoint,
        title: titleElement(dialog.title),
        html: bodyFragment(dialog.body),
        theme: options.theme ?? 'auto',
        animation: !reducedMotion(),
        customClass: { popup: 'treatable-guide-popup' },
        // sweetalert2 marks every non-toast dialog as modal. These dialogs never trap focus or block the page.
        willOpen: popup => { popup.setAttribute('aria-modal', 'false'); },
        didOpen: popup => {
          if (mine !== sequence) return;
          open = true;
          if (!toast) detach = track(popup, dialog);
          const focusTarget = dialog.focus as HTMLElement | null | undefined;
          if (focusTarget && typeof focusTarget.focus === 'function') {
            try { focusTarget.focus({ preventScroll: true }); } catch { /* Focus is a convenience only. */ }
          }
        },
      };
      // sweetalert2 warns about, and ignores, the dialog-only options when a toast is requested.
      const config: SweetAlertOptions = toast
        ? { ...common, toast: true, position: 'bottom-end', timer: dialog.timerMs ?? 6000, timerProgressBar: true, showConfirmButton: false, showCancelButton: false, showDenyButton: false }
        : {
          ...common,
          backdrop: false,
          heightAuto: false,
          scrollbarPadding: false,
          returnFocus: false,
          allowOutsideClick: false,
          allowEscapeKey: true,
          focusConfirm: !!dialog.next && !dialog.focus,
          focusCancel: false,
          focusDeny: false,
          showConfirmButton: !!dialog.next,
          confirmButtonText: dialog.next,
          showDenyButton: !!dialog.back,
          denyButtonText: dialog.back,
          showCancelButton: dialog.skip !== '',
          cancelButtonText: dialog.skip ?? 'Skip',
        };
      const result = await Swal.fire(config);
      const wasClosedByGuide = closedByGuide;
      if (mine === sequence) { open = false; inFlight = false; release(); closedByGuide = false; }
      if (mine !== sequence || wasClosedByGuide) return 'closed';
      if (result.isConfirmed) return 'next';
      if (result.isDenied) return 'back';
      return result.dismiss === Swal.DismissReason.timer ? 'closed' : 'skip';
    },
    closeActive() {
      if (!inFlight) return;
      closedByGuide = true;
      closeSwal();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      sequence++;
      closedByGuide = true;
      release();
      inFlight = false;
      closeSwal();
      if (hadOwnQuery) body.querySelector = originalQuery; else delete (body as any).querySelector;
      host.remove();
      open = false;
    },
  };
  return mount;
}

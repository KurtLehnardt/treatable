/**
 * A small cancellation source that does not depend on the host's AbortController.
 * Its signal satisfies the CancelSignal port interface.
 */
import type { CancelSignal } from './ports.ts';

export interface CancelSource {
  readonly signal: CancelSignal;
  cancel(): void;
}

export function createCancelSource(): CancelSource {
  let aborted = false;
  const listeners = new Set<() => void>();
  const signal: CancelSignal = {
    get aborted() {
      return aborted;
    },
    addEventListener(type, listener) {
      if (type !== 'abort' || typeof listener !== 'function') return;
      if (aborted) {
        // A listener added after cancellation runs at once, so a registration race cannot miss it.
        safeCall(listener);
        return;
      }
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'abort') listeners.delete(listener);
    },
  };
  return {
    signal,
    cancel() {
      if (aborted) return;
      aborted = true;
      const pending = [...listeners];
      listeners.clear();
      for (const listener of pending) safeCall(listener);
    },
  };
}

function safeCall(listener: () => void): void {
  try {
    listener();
  } catch {
    // A failing listener must not stop cancellation of the others.
  }
}

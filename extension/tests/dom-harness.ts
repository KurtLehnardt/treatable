import { JSDOM } from 'jsdom';

/**
 * Installs a jsdom window as the global DOM for one test file and returns a teardown function.
 * Each test file runs in its own process, so the globals never leak between files.
 */
export interface TestDom {
  dom: JSDOM;
  window: any;
  document: Document;
  teardown(): void;
}

const OVERRIDE_EVEN_IF_PRESENT = ['Event', 'EventTarget', 'CustomEvent', 'MessageEvent'];
const BOUND_FUNCTIONS = ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'];

export function installDom(html = '<!doctype html><html><head></head><body></body></html>', url = 'https://clinicaltrials.gov/search?cond=asthma'): TestDom {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  const win = dom.window as any;
  const backup = new Map<string, PropertyDescriptor | undefined>();
  const define = (name: string, value: unknown) => {
    if (!backup.has(name)) backup.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  for (const name of Object.getOwnPropertyNames(win)) {
    if (!/^[A-Z]/.test(name)) continue;
    if (name in globalThis && !OVERRIDE_EVEN_IF_PRESENT.includes(name)) continue;
    try { define(name, win[name]); } catch { /* Some window properties are getters that throw outside a browser. */ }
  }
  for (const name of BOUND_FUNCTIONS) define(name, win[name].bind(win));
  define('window', win);
  define('document', win.document);
  define('navigator', win.navigator);
  define('location', win.location);
  define('history', win.history);
  return {
    dom,
    window: win,
    document: win.document,
    teardown() {
      for (const [name, descriptor] of backup) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as any)[name];
      }
      backup.clear();
      win.close();
    },
  };
}

/** Lets queued microtasks, timers and animation frames run. */
export async function settle(times = 3) {
  for (let i = 0; i < times; i++) await new Promise(resolve => setTimeout(resolve, 5));
}

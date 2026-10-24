/**
 * Deterministic test ports. Every test that uses them is mocked: no request leaves the process.
 */
import { createHash } from 'node:crypto';
import type { Clock, CorePorts, Loader, TokenSource, Transport, TransportRequest, TransportResponse } from '../../src/ports.ts';
import { nodeSha256 } from '../../node/ports.node.ts';

interface Timer {
  at: number;
  callback: () => void;
  cancelled: boolean;
}

/** Manual clock: time moves only when a test calls advance(). Timers fire in order during advance(). */
export class FakeClock implements Clock {
  /** 2026-10-24T08:05:00Z: five minutes after the fixed retrievedAt of the fictional records (decision D3). */
  wall = 1_792_829_100_000;
  mono = 10_000;
  private timers: Timer[] = [];

  now = (): number => this.wall;
  monotonic = (): number => this.mono;

  schedule = (delayMs: number, callback: () => void): (() => void) => {
    const timer: Timer = { at: this.mono + delayMs, callback, cancelled: false };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
      this.timers = this.timers.filter(t => t !== timer);
    };
  };

  advance(ms: number): void {
    const target = this.mono + ms;
    for (;;) {
      const due = this.timers.filter(t => !t.cancelled && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.wall += due.at - this.mono;
      this.mono = due.at;
      this.timers = this.timers.filter(t => t !== due);
      due.callback();
    }
    this.wall += target - this.mono;
    this.mono = target;
  }

  pendingTimers(): number {
    return this.timers.filter(t => !t.cancelled).length;
  }

  /** Monotonic time of the earliest pending timer, if any. */
  nextDue(): number | undefined {
    const due = this.timers.filter(t => !t.cancelled).map(t => t.at);
    return due.length ? Math.min(...due) : undefined;
  }
}

/** Deterministic, distinct byte strings; never all-equal. */
export class SequentialTokens implements TokenSource {
  calls = 0;
  randomBytes = (length: number): Uint8Array => {
    this.calls += 1;
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) out[i] = (this.calls * 31 + i * 7 + 1) & 0xff;
    return out;
  };
}

/** Records every request and fails it: A1a performs no network calls, so any call is a test failure signal. */
export class RecordingTransport implements Transport {
  readonly calls: TransportRequest[] = [];
  request = async (request: TransportRequest): Promise<TransportResponse> => {
    this.calls.push(request);
    throw new Error('unexpected network request in a mocked test');
  };
}

export class MapLoader implements Loader {
  private readonly resources: Record<string, Uint8Array>;
  constructor(resources: Record<string, Uint8Array>) {
    this.resources = resources;
  }
  load = async (id: string, maxBytes: number): Promise<Uint8Array> => {
    const bytes = this.resources[id];
    if (!bytes) throw new Error('unknown');
    if (bytes.length > maxBytes) throw new Error('too large');
    return bytes;
  };
}

export interface TestPorts extends CorePorts {
  readonly clock: FakeClock;
  readonly tokens: SequentialTokens;
  readonly transport: RecordingTransport;
}

export function testPorts(resources: Record<string, Uint8Array> = {}): TestPorts {
  return {
    transport: new RecordingTransport(),
    sha256: nodeSha256,
    tokens: new SequentialTokens(),
    clock: new FakeClock(),
    loader: new MapLoader(resources),
  };
}

/** Independent SHA-256 (node:crypto directly) for recomputing digests in tests. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

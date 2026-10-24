/**
 * In-memory session state. This module makes no network request and writes nothing to storage or
 * logs.
 *
 * A session holds the prepared consent, the session record index (the public study records
 * searchTrials returned, records.ts), the registry of running operations, the request IDs seen so
 * far, and typed slots that pipelines use for their own state (for example a search cursor or a
 * parsed resource). The consent subject is the record-set digest of the index, so any change to the
 * held records clears prepared consent.
 *
 * Only the dispatcher holds the Session object. Pipelines receive the read-only record view
 * (records.view) and the slot facade (slots); neither can reach the consent store or write records.
 *
 * wipe() drops everything: running operations are cancelled, consent is cleared and closed, every
 * record, slot, and request ID is removed, and the session refuses further writes. endSession
 * replaces the session object, so nothing reachable from the core keeps a reference to the old
 * state.
 */
import { createCancelSource, type CancelSource } from './cancel.ts';
import { createConsentStore, type ConsentStore } from './consent/store.ts';
import { CoreError } from './errors.ts';
import type { CancelSignal, CorePorts } from './ports.ts';
import { MAX_REQUESTS_PER_SESSION, PREVIEW_BUDGET_BYTES } from './protocol.ts';
import { createRecordIndex, type PreparedMerge, type RecordIndex } from './records.ts';

/** A typed key for session state owned by one module. */
export interface SlotKey<T> {
  readonly name: string;
  /** Type marker only; never read. */
  readonly __type?: T;
}

export function defineSlot<T>(name: string): SlotKey<T> {
  return Object.freeze({ name });
}

/** Typed per-session storage for pipelines. Wiped with the session. */
export interface SessionSlots {
  get<T>(slot: SlotKey<T>): T | undefined;
  set<T>(slot: SlotKey<T>, value: T): void;
  delete<T>(slot: SlotKey<T>): void;
}

export interface PendingOperation {
  readonly signal: CancelSignal;
  /** Ends the registration; call in a finally block. */
  end(): void;
}

export type SeenResult = 'ok' | 'duplicate' | 'limit';

export interface Session {
  readonly consent: ConsentStore;
  /** The record index writer. Hand only records.view to pipelines. */
  readonly records: RecordIndex;
  readonly slots: SessionSlots;
  readonly ended: boolean;
  /** Increments on every mutation of session inputs. */
  revision(): number;
  /**
   * Records that the session inputs changed. Clears any prepared consent, so a receipt prepared
   * before the change can never execute after it.
   */
  mutate(): void;
  /** The digest that consent preparations pin: the record-set digest, undefined while no record is held. */
  subjectDigest(): string | undefined;
  /**
   * Installs a prepared record merge (synchronously). When the record-set digest changes, prepared
   * consent is cleared and running real-data work is aborted.
   */
  commitRecords(merge: PreparedMerge): void;
  markSeen(requestId: string): SeenResult;
  requestCount(): number;
  begin(requestId: string, options: { real: boolean }): PendingOperation;
  cancel(requestId: string): boolean;
  pendingCount(): number;
  wipe(): void;
}

export interface SessionOptions {
  readonly ttlMs?: number;
}

export function createSession(ports: Pick<CorePorts, 'sha256' | 'tokens' | 'clock'>, options: SessionOptions = {}): Session {
  let ended = false;
  let revision = 0;
  const records = createRecordIndex();
  const slotValues = new Map<string, unknown>();
  const seen = new Set<string>();
  const pending = new Map<string, { source: CancelSource; real: boolean }>();

  const consent = createConsentStore(ports, {
    ...(options.ttlMs !== undefined ? { ttlMs: options.ttlMs } : {}),
    maxReplyBytes: PREVIEW_BUDGET_BYTES,
    // Port of host.mjs onInvalidate: clearing consent aborts every running real-data operation.
    onInvalidate: () => {
      for (const entry of pending.values()) if (entry.real) entry.source.cancel();
    },
  });

  function assertOpen(): void {
    if (ended) throw new CoreError('CANCELLED');
  }

  const slots: SessionSlots = Object.freeze({
    get<T>(slot: SlotKey<T>) {
      return slotValues.get(slot.name) as T | undefined;
    },
    set<T>(slot: SlotKey<T>, value: T) {
      assertOpen();
      slotValues.set(slot.name, value);
    },
    delete<T>(slot: SlotKey<T>) {
      slotValues.delete(slot.name);
    },
  });

  const session: Session = {
    consent,
    records,
    slots,
    get ended() {
      return ended;
    },
    revision: () => revision,
    mutate() {
      assertOpen();
      revision += 1;
      consent.clear();
    },
    subjectDigest: () => records.digest,
    commitRecords(merge) {
      assertOpen();
      const before = records.digest;
      merge.commit();
      if (records.digest !== before) session.mutate();
    },
    markSeen(requestId) {
      if (seen.has(requestId)) return 'duplicate';
      if (seen.size >= MAX_REQUESTS_PER_SESSION) return 'limit';
      seen.add(requestId);
      return 'ok';
    },
    requestCount: () => seen.size,
    begin(requestId, { real }) {
      assertOpen();
      if (pending.has(requestId)) throw new CoreError('BUSY');
      const source = createCancelSource();
      const entry = { source, real };
      pending.set(requestId, entry);
      return {
        signal: source.signal,
        end() {
          if (pending.get(requestId) === entry) pending.delete(requestId);
        },
      };
    },
    cancel(requestId) {
      const entry = pending.get(requestId);
      if (!entry) return false;
      entry.source.cancel();
      return true;
    },
    pendingCount: () => pending.size,
    wipe() {
      ended = true;
      for (const entry of pending.values()) entry.source.cancel();
      pending.clear();
      consent.close();
      slotValues.clear();
      seen.clear();
      records.clear();
      revision += 1;
    },
  };
  return session;
}

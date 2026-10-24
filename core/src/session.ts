/**
 * In-memory session state. Nothing here is persisted, logged, or sent anywhere.
 *
 * A session holds the prepared consent, the registry of running operations, the request IDs seen
 * so far, the public study records of the latest completed search, the pinned subject digest, and
 * typed slots that later tasks use for their own state (screening inputs from task A1b). wipe()
 * drops all of it: running operations are cancelled, consent is cleared and closed, every record,
 * slot and ID is removed, and the session refuses further writes. endSession replaces the session
 * object, so nothing reachable from the core keeps a reference to the old state.
 */
import { createCancelSource, type CancelSource } from './cancel.ts';
import { createConsentStore, type ConsentStore } from './consent/store.ts';
import { isHex64 } from './bytes.ts';
import { CoreError } from './errors.ts';
import { deepFreeze, jsonClone, type JsonValue } from './json.ts';
import type { CancelSignal, CorePorts } from './ports.ts';
import { MAX_REQUESTS_PER_SESSION, NCT_ID_PATTERN, PREVIEW_BUDGET_BYTES, type StudyRecord } from './protocol.ts';

/** A typed key for session state owned by one module. */
export interface SlotKey<T> {
  readonly name: string;
  /** Type marker only; never read. */
  readonly __type?: T;
}

export function defineSlot<T>(name: string): SlotKey<T> {
  return Object.freeze({ name });
}

export interface PendingOperation {
  readonly signal: CancelSignal;
  /** Ends the registration; call in a finally block. */
  end(): void;
}

export type SeenResult = 'ok' | 'duplicate' | 'limit';

export interface Session {
  readonly consent: ConsentStore;
  readonly ended: boolean;
  /** Increments on every mutation of session inputs. */
  revision(): number;
  /**
   * Records that the profile, the selection, or the pinned subject changed. Clears any prepared
   * consent, so a receipt prepared before the change can never execute after it.
   */
  mutate(): void;
  /** The digest that consent preparations pin (the dispatcher sets it from the live record set). */
  subjectDigest(): string | undefined;
  setSubjectDigest(digest: string | undefined): void;
  /** The public study records held from the latest completed search, ordered by NCT ID. */
  records(): readonly StudyRecord[];
  recordById(nctId: string): StudyRecord | undefined;
  /** Replaces the record set (a completed search) and invalidates any prepared consent. */
  setRecords(records: readonly StudyRecord[]): void;
  get<T>(slot: SlotKey<T>): T | undefined;
  set<T>(slot: SlotKey<T>, value: T): void;
  delete<T>(slot: SlotKey<T>): void;
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
  let subject: string | undefined;
  const heldRecords = new Map<string, StudyRecord>();
  const slots = new Map<string, unknown>();
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

  const session: Session = {
    consent,
    get ended() {
      return ended;
    },
    revision: () => revision,
    mutate() {
      assertOpen();
      revision += 1;
      consent.clear();
    },
    subjectDigest: () => subject,
    setSubjectDigest(digest) {
      assertOpen();
      if (digest !== undefined && !isHex64(digest)) throw new CoreError('INTERNAL_ERROR');
      if (digest === subject) return;
      subject = digest;
      session.mutate();
    },
    records: () => [...heldRecords.values()].sort((a, b) => (a.nctId < b.nctId ? -1 : a.nctId > b.nctId ? 1 : 0)),
    recordById: nctId => heldRecords.get(nctId),
    setRecords(values) {
      assertOpen();
      // Full replacement: only the records of the latest completed search are held. Records arrive
      // already validated by the dispatcher; each is cloned and deep-frozen, so no later writer can
      // change what consent was prepared against.
      const frozen = new Map<string, StudyRecord>();
      for (const record of values) {
        if (!NCT_ID_PATTERN.test(record.nctId) || frozen.has(record.nctId)) throw new CoreError('INTERNAL_ERROR');
        frozen.set(record.nctId, deepFreeze(jsonClone(record as unknown as JsonValue) as StudyRecord));
      }
      heldRecords.clear();
      for (const [id, record] of frozen) heldRecords.set(id, record);
      // A new search result set invalidates any prepared consent, even when the records are
      // identical: consent was confirmed against a review of the results shown before this search.
      session.mutate();
    },
    get<T>(slot: SlotKey<T>) {
      return slots.get(slot.name) as T | undefined;
    },
    set<T>(slot: SlotKey<T>, value: T) {
      assertOpen();
      slots.set(slot.name, value);
    },
    delete(slot) {
      slots.delete(slot.name);
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
      slots.clear();
      seen.clear();
      heldRecords.clear();
      subject = undefined;
      revision += 1;
    },
  };
  return session;
}

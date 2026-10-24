/**
 * Mocked ClinicalTrials.gov test support: a scripted transport, a virtual-time driver for the fake
 * clock, fictional raw studies in the API v2 JSON shape, and the recorded public fixture.
 * Nothing here makes a network request.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TransportRequest, TransportResponse, Transport } from '../../src/ports.ts';
import { utf8Encode } from '../../src/bytes.ts';
import { FakeClock } from './fakes.ts';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ctgov-real.json');

/** Recorded public ClinicalTrials.gov API v2 studies (copy of scaffold/data/fixtures/ctgov-real.json at 48c569e). */
export function recordedStudies(): Record<string, any>[] {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { studies: Record<string, any>[] };
  return fixture.studies;
}

export type Step =
  | { readonly status?: number; readonly headers?: Record<string, string>; readonly json?: unknown; readonly text?: string; readonly bytes?: Uint8Array; readonly chunks?: Uint8Array[] }
  | { readonly reject: true }
  | { readonly hang: true }
  | { readonly respond: (request: TransportRequest) => Promise<TransportResponse> };

export interface RecordedCall {
  readonly request: TransportRequest;
  /** Fake monotonic time at which the request reached the transport. */
  readonly at: number;
}

/** Plays one scripted step per request and records each request with its virtual start time. */
export class ScriptedTransport implements Transport {
  readonly calls: RecordedCall[] = [];
  readonly steps: Step[];
  readonly clock: FakeClock;
  /** Chunks the response body iterator actually delivered (to prove reads stop at the cap). */
  chunksRead = 0;

  constructor(clock: FakeClock, steps: Step[] = []) {
    this.clock = clock;
    this.steps = [...steps];
  }

  request = async (request: TransportRequest): Promise<TransportResponse> => {
    this.calls.push({ request, at: this.clock.monotonic() });
    const step = this.steps.shift();
    if (!step) throw new Error('unexpected request in a mocked test');
    if ('reject' in step) throw new Error('simulated network failure');
    if ('respond' in step) return step.respond(request);
    if ('hang' in step) {
      return new Promise((_resolve, reject) => {
        const signal = request.signal;
        if (!signal) return;
        if (signal.aborted) reject(new Error('aborted'));
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    const headers = { 'content-type': 'application/json', ...(step.headers ?? {}) };
    if (step.chunks) {
      const chunks = step.chunks;
      const self = this;
      return {
        status: step.status ?? 200,
        headers,
        body: (async function* () {
          for (const chunk of chunks) {
            self.chunksRead += 1;
            yield chunk;
          }
        })(),
      };
    }
    const body = step.bytes ?? utf8Encode(step.text ?? (step.json === undefined ? '' : JSON.stringify(step.json)));
    return { status: step.status ?? 200, headers, body };
  };

  /** The decoded query parameters of call `i`, in order. */
  params(i: number): [string, string][] {
    const url = this.calls[i]!.request.url;
    const query = url.slice(url.indexOf('?') + 1);
    return query.split('&').map(part => {
      const at = part.indexOf('=');
      return [decodeURIComponent(part.slice(0, at)), decodeURIComponent(part.slice(at + 1))];
    });
  }
}

export function page(studies: unknown[], extra: { nextPageToken?: string; totalCount?: number } = {}): { json: unknown } {
  return { json: { studies, ...extra } };
}

/**
 * Runs `promise` to completion in virtual time: whenever the event loop is idle, the fake clock jumps
 * to the next pending timer. Fails if the promise is still pending with no timer left.
 */
export async function drive<T>(clock: FakeClock, promise: Promise<T>): Promise<T> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let step = 0; step < 10_000; step += 1) {
    await new Promise(resolve => setImmediate(resolve));
    if (settled) return promise;
    const due = clock.nextDue();
    if (due === undefined) {
      await new Promise(resolve => setImmediate(resolve));
      if (settled) return promise;
      throw new Error('stalled: the promise is pending and no timer is scheduled');
    }
    clock.advance(Math.max(0, due - clock.monotonic()));
  }
  throw new Error('drive: too many steps');
}

/**
 * A fictional study in the ClinicalTrials.gov API v2 JSON shape. Every name, phone number, email
 * address, and place is invented. `patch` edits the object before it is returned.
 */
export function rawStudy(nctId: string, patch?: (study: Record<string, any>) => void): Record<string, any> {
  const study: Record<string, any> = {
    protocolSection: {
      identificationModule: { nctId, briefTitle: `Fictional asthma inhaler timing study ${nctId}`, officialTitle: 'A Fictional Study' },
      statusModule: { overallStatus: 'RECRUITING', lastUpdatePostDateStruct: { date: '2026-09-30', type: 'ACTUAL' } },
      sponsorCollaboratorsModule: { leadSponsor: { name: 'Fictional Research Group', class: 'OTHER' } },
      descriptionModule: { briefSummary: 'This fictional study compares inhaler timing in adults with asthma.' },
      conditionsModule: { conditions: ['Asthma', 'Asthma in Adults'] },
      designModule: { studyType: 'INTERVENTIONAL', phases: ['PHASE2'] },
      eligibilityModule: {
        eligibilityCriteria: 'Inclusion Criteria:\n\n* Fictional adults with asthma\n\nExclusion Criteria:\n\n* Fictional exclusion',
        healthyVolunteers: false,
        sex: 'ALL',
        minimumAge: '18 Years',
        maximumAge: '65 Years',
      },
      contactsLocationsModule: {
        centralContacts: [{ name: 'Canary Central Contact', role: 'CONTACT', phone: '555-0199', email: 'central.canary@example.invalid' }],
        overallOfficials: [{ name: 'Dr. Canary Official', role: 'PRINCIPAL_INVESTIGATOR', affiliation: 'Fictional University' }],
        locations: [
          {
            facility: 'Fictional Canary Clinic',
            status: 'RECRUITING',
            city: 'Canaryville',
            state: 'Colorado',
            zip: '80999',
            country: 'United States',
            contacts: [{ name: 'Site Canary Coordinator', role: 'CONTACT', phone: '555-0142', phoneExt: '12', email: 'site.canary@example.invalid' }],
            geoPoint: { lat: 39.7392, lon: -104.9903 },
          },
        ],
      },
    },
    derivedSection: { conditionBrowseModule: { meshes: [{ id: 'D001249', term: 'Asthma' }] } },
    hasResults: false,
  };
  patch?.(study);
  return study;
}

/** Fictional NCT IDs that are not assigned to real studies in these tests' context. */
export function fictionalId(n: number): string {
  return `NCT9${String(n).padStart(7, '0')}`;
}

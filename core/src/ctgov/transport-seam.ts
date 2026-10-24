/**
 * The one place where the ClinicalTrials.gov client reaches the injected transport port.
 *
 * createCtgovTransport wraps the host's transport in a guard. Every request is checked before the
 * port sees it and then rebuilt from the checked parts, so nothing a caller adds can pass through:
 *   - method GET and no body;
 *   - the URL is https://clinicaltrials.gov/api/v2/studies with exactly the query that
 *     buildStudiesUrl produces (parseStudiesUrl in query.ts re-derives the query and requires the
 *     same URL byte for byte): search terms, the United States, at most one state name, fixed
 *     parameters, a page size, and a ClinicalTrials.gov page token, with no other parameter;
 *   - exactly one header, Accept: application/json (no credentials, cookies, or custom headers);
 *   - only the cancellation signal is passed on.
 * A rejected request throws INVALID_ENDPOINT and never reaches the port.
 *
 * Task A1b adds a general transport gate whose allowlist covers the OpenAI endpoints only. When the
 * branches are reconciled, that gate needs a ClinicalTrials.gov rule equivalent to this guard (or
 * must hand this guard the raw port), so that the gate and this guard together still allow exactly
 * GET https://clinicaltrials.gov/api/v2/studies with the query above.
 */
import { CoreError } from '../errors.ts';
import type { CorePorts, Transport, TransportRequest, TransportResponse } from '../ports.ts';
import { parseStudiesUrl } from './query.ts';

export const CTGOV_REQUEST_HEADERS: Readonly<Record<string, string>> = Object.freeze({ Accept: 'application/json' });

/**
 * Throws INVALID_ENDPOINT unless `request` is a ClinicalTrials.gov studies request this core could
 * have built. Returns the checked URL; each field is read once, so a getter cannot change it later.
 */
export function assertCtgovRequest(request: TransportRequest): string {
  if (typeof request !== 'object' || request === null) throw new CoreError('INVALID_ENDPOINT');
  const { method, url, body, headers } = request;
  const headerNames = typeof headers === 'object' && headers !== null ? Object.keys(headers) : [];
  if (
    method !== 'GET' ||
    body !== undefined ||
    headerNames.length !== 1 ||
    headerNames[0] !== 'Accept' ||
    headers.Accept !== CTGOV_REQUEST_HEADERS.Accept ||
    typeof url !== 'string'
  ) {
    throw new CoreError('INVALID_ENDPOINT');
  }
  parseStudiesUrl(url);
  return url;
}

/** The guarded transport for ClinicalTrials.gov: it forwards only requests that pass assertCtgovRequest. */
export function createCtgovTransport(raw: Transport): Transport {
  return {
    request(request: TransportRequest): Promise<TransportResponse> {
      let url: string;
      try {
        url = assertCtgovRequest(request);
      } catch (error) {
        return Promise.reject(error);
      }
      const signal = request.signal;
      const rebuilt: TransportRequest = Object.freeze({
        method: 'GET',
        url,
        headers: Object.freeze({ ...CTGOV_REQUEST_HEADERS }),
        ...(signal !== undefined ? { signal } : {}),
      });
      return raw.request(rebuilt);
    },
  };
}

export function ctgovTransport(ports: Pick<CorePorts, 'transport'>): Transport {
  return createCtgovTransport(ports.transport);
}

/**
 * The one place where the ClinicalTrials.gov client reaches the injected transport port.
 *
 * Task A1b adds a guarded transport with an exact (method, host, path) allowlist that includes
 * GET https://clinicaltrials.gov/api/v2/studies. At merge time that guard wraps the port here, so
 * every ClinicalTrials.gov request passes through it. Until then the client checks its own requests
 * (assertCtgovRequest) before calling the port: method GET, the exact https URL prefix built by
 * query.ts, no body, and only an Accept header.
 */
import { CoreError } from '../errors.ts';
import type { CorePorts, Transport, TransportRequest } from '../ports.ts';
import { isCtgovStudiesUrl } from './query.ts';

export const CTGOV_REQUEST_HEADERS: Readonly<Record<string, string>> = Object.freeze({ Accept: 'application/json' });

export function ctgovTransport(ports: Pick<CorePorts, 'transport'>): Transport {
  return ports.transport;
}

export function assertCtgovRequest(request: TransportRequest): void {
  const headerNames = Object.keys(request.headers ?? {});
  if (
    request.method !== 'GET' ||
    !isCtgovStudiesUrl(request.url) ||
    request.body !== undefined ||
    headerNames.length !== 1 ||
    request.headers.Accept !== CTGOV_REQUEST_HEADERS.Accept
  ) {
    throw new CoreError('INVALID_ENDPOINT');
  }
}

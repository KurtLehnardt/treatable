/**
 * Bounded, integrity-checked loading of bundled public resources through the Loader port.
 *
 * Port of the integrity checks in loadPublicCorpus (extension/native/real.mjs at commit 48c569e):
 * the bytes must match a pinned SHA-256 when one is given, must decode as strict UTF-8, and must
 * parse as JSON; any failure is RESOURCE_INVALID. Unlike the extension, the read is bounded before
 * hashing, and the resource is named by an allowlisted identifier instead of a file path.
 */
import { isHex64, readBounded, utf8Decode } from './bytes.ts';
import { CoreError } from './errors.ts';
import type { CancelSignal, Loader, Sha256 } from './ports.ts';

export const RESOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const MAX_RESOURCE_BYTES = 16 * 1024 * 1024;

export interface ResourceSpec {
  /** Short identifier such as "zip-centroids.v1.json"; never a path. */
  readonly id: string;
  readonly maxBytes: number;
  /** Lower-case hex SHA-256 of the exact bundled bytes, when known at build time. */
  readonly sha256?: string;
}

function validSpec(spec: ResourceSpec): boolean {
  return (
    typeof spec?.id === 'string' &&
    RESOURCE_ID_PATTERN.test(spec.id) &&
    !spec.id.includes('..') &&
    Number.isSafeInteger(spec.maxBytes) &&
    spec.maxBytes > 0 &&
    spec.maxBytes <= MAX_RESOURCE_BYTES &&
    (spec.sha256 === undefined || isHex64(spec.sha256))
  );
}

export async function loadResource(
  ports: { readonly loader: Loader; readonly sha256: Sha256 },
  spec: ResourceSpec,
  signal?: CancelSignal,
): Promise<Uint8Array> {
  if (!validSpec(spec)) throw new CoreError('RESOURCE_INVALID');
  let bytes: Uint8Array;
  try {
    bytes = await readBounded(await ports.loader.load(spec.id, spec.maxBytes, signal), spec.maxBytes, signal);
  } catch (error) {
    if (error instanceof CoreError && error.code === 'CANCELLED') throw error;
    throw new CoreError('RESOURCE_INVALID');
  }
  if (spec.sha256 !== undefined) {
    let digest: string;
    try {
      digest = await ports.sha256.digestHex(bytes);
    } catch {
      throw new CoreError('RESOURCE_INVALID');
    }
    if (digest !== spec.sha256) throw new CoreError('RESOURCE_INVALID');
  }
  return bytes;
}

export async function loadJsonResource(
  ports: { readonly loader: Loader; readonly sha256: Sha256 },
  spec: ResourceSpec,
  signal?: CancelSignal,
): Promise<unknown> {
  const bytes = await loadResource(ports, spec, signal);
  try {
    return JSON.parse(utf8Decode(bytes)) as unknown;
  } catch {
    throw new CoreError('RESOURCE_INVALID');
  }
}

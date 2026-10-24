/**
 * R5-deep — NDJSON stream buffering (pure, client-safe, no deps).
 *
 * The `/api/competitors` route writes one `JSON.stringify(event) + "\n"` per
 * line, but a single network chunk can split a line in half OR carry several
 * lines at once. `drainNdjson` pulls every COMPLETE (newline-terminated) line
 * out of a growing buffer, parses each, and returns the unparsed remainder to
 * carry into the next chunk — so no event is ever parsed half-formed and none
 * is dropped at a chunk boundary. Isolated here so the stream reader is
 * unit-testable without a real network.
 */
export function drainNdjson(buffer: string): { objects: unknown[]; rest: string } {
  const objects: unknown[] = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf("\n")) >= 0) {
    const line = rest.slice(0, idx).trim();
    rest = rest.slice(idx + 1);
    if (!line) continue;
    try {
      objects.push(JSON.parse(line));
    } catch {
      // A complete line is valid JSON by construction; ignore a stray malformed
      // one rather than aborting the whole stream.
    }
  }
  return { objects, rest };
}

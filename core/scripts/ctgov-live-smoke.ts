// LIVE ClinicalTrials.gov smoke test (opt-in; not part of npm test).
//
// Runs one real search against the public ClinicalTrials.gov API v2 through the core's own client,
// with a generic, fictional-user search ("asthma" in Colorado), then fetches the next page with the
// returned page token. No patient data exists here, and no OpenAI request is made. It prints only
// counts, NCT IDs, retrievedAt, and sourceUrl.
//
// Usage (from core/):  TREATABLE_LIVE_CTGOV=1 npm run smoke:ctgov-live
// Without TREATABLE_LIVE_CTGOV=1 it makes no request and exits 0.
import { createSearchTrialsPipeline } from '../src/ctgov/search.ts';
import { createCancelSource } from '../src/cancel.ts';
import { CoreError } from '../src/errors.ts';
import { SearchTrialsPayloadSchema, SearchTrialsResultSchema } from '../src/protocol.ts';
import { createSession } from '../src/session.ts';
import { getRecordSet } from '../src/pinning/record-set.ts';
import { buildPinnedPreview } from '../src/pinning/preview.ts';
import { createNodePorts } from '../node/ports.node.ts';

if (process.env.TREATABLE_LIVE_CTGOV !== '1') {
  process.stdout.write('LIVE ClinicalTrials.gov smoke skipped (set TREATABLE_LIVE_CTGOV=1 to run it).\n');
  process.exit(0);
}

const ports = createNodePorts();
const session = createSession(ports);
const search = createSearchTrialsPipeline(ports);
const { signal } = createCancelSource();
const line = (text: string) => process.stdout.write(`${text}\n`);

async function main(): Promise<void> {
  line('LIVE ClinicalTrials.gov API v2 smoke (public API; search "asthma", state CO; no patient data; no OpenAI request)');
  const first = SearchTrialsResultSchema.parse(
    await search({ session, signal }, SearchTrialsPayloadSchema.parse({ conditionTerms: ['asthma'], state: 'CO', pageSize: 5 })),
  );
  line(`LIVE page 1: totalCount=${first.totalCount ?? 'n/a'} records=${first.records.length} skipped=${first.skippedRecords} nextPage=${first.nextPageToken ? 'yes' : 'no'} retrievedAt=${first.retrievedAt}`);
  for (const r of first.records) line(`LIVE   ${r.nctId} retrievedAt=${r.retrievedAt} sourceUrl=${r.sourceUrl}`);
  if (first.nextPageToken) {
    const second = SearchTrialsResultSchema.parse(
      await search(
        { session, signal },
        SearchTrialsPayloadSchema.parse({ conditionTerms: ['asthma'], state: 'CO', pageSize: 5, pageToken: first.nextPageToken }),
      ),
    );
    line(`LIVE page 2: records=${second.records.length} skipped=${second.skippedRecords} nextPage=${second.nextPageToken ? 'yes' : 'no'} retrievedAt=${second.retrievedAt}`);
    for (const r of second.records) line(`LIVE   ${r.nctId} retrievedAt=${r.retrievedAt} sourceUrl=${r.sourceUrl}`);
  }
  const set = getRecordSet(session);
  line(`LIVE session record set: ${set?.entries.size ?? 0} records`);
  // Local check only; this step makes no network request: the pinned preview builds from live records.
  const record = first.records.find(r => r.conditions.length > 0);
  if (record) {
    const { preview } = buildPinnedPreview(session, { conditionTerm: record.conditions[0]!, ageBand: '30_44', scoreNctIds: [record.nctId] });
    line(`LIVE local pinned preview: decisionsRequests=${preview.decisionsRequests.length} bytes=${Buffer.byteLength(JSON.stringify(preview))}`);
  }
}

// The Node clock port unrefs its timers (a host keeps itself alive, for example through its stdio
// pipe), so this script holds the event loop open while it waits between paced requests.
const keepAlive = setInterval(() => {}, 1000);
main().then(
  () => {
    clearInterval(keepAlive);
    process.exit(0);
  },
  (error: unknown) => {
    line(`LIVE smoke failed: ${error instanceof CoreError ? error.code : 'unexpected error'}`);
    process.exit(1);
  },
);

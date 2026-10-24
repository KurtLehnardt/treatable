# Record-set pinning (task A2 contract change, for the A2r re-review)

Status: stage 1 of task A2 on `feature/core-a2-fcc`. This changes the reviewed consent contract of the extension and needs the independent A2r security re-review before advisor checkpoint CP2. The dispatcher wiring is provisional: a parallel fix of the A1a critic findings moves these checks into a dispatcher-owned record index (section 6).

Code: `core/src/pinning/` (`record-set.ts`, `model-study.ts`, `preview.ts`, `bounds.ts`). Tests: `core/tests/pinning.test.ts` (mocked).

## 1. What changed

The reviewed extension (`extension/native/real.mjs` and `extension/shared/public-catalog.mjs` at `48c569e`) pinned every real-data preview to a fixed, bundled 2,000-study catalog whose hash was checked at load, and the consent digest covered the catalog metadata. The apps search ClinicalTrials.gov live, so there is no fixed catalog. The pin is now the set of records fetched by live searches in the current session:

- the consent subject digest is the digest of that record set;
- every study in a preview must be a record of that set, projected by one deterministic function;
- the condition term must be public vocabulary on a record of that set.

Everything else in the consent contract is unchanged: notice, acknowledgment, exact preview, separate confirmation, pinned payloads, SHA-256 digests, five-minute one-use tokens, and invalidation on mutation.

## 2. Digests

- Record digest: SHA-256 (through the `Sha256` port) over the RFC 8785 canonical JSON of the record exactly as returned to the host (`recordDigest`).
- Record-set digest: SHA-256 over the canonical JSON of `{ "format": "treatable.record-set.v1", "records": [[nctId, recordDigest], ...] }`, sorted by NCT ID (`recordSetDigest`). It does not depend on insertion order, and it changes when any byte of any held record changes, including `retrievedAt`, so a re-fetched record is a new version.
- The consent digest (unchanged code, `consent/store.ts`) is SHA-256 over the canonical JSON of `{ operations, policyVersion, preview, subjectDigest }`, with `subjectDigest` set to the record-set digest. `executeReal` requires the session's current subject digest to equal the pinned one.

Tests recompute both digests independently with `node:crypto` and a separate canonicalizer.

## 3. The session record set

- Records enter only through a completed `searchTrials`. Each is validated against `StudyRecordSchema`, deep-copied, frozen, and hashed (`pinRecords`).
- A search merges its records into the set; a newer version of a held record replaces it. At most 250 records are held; the oldest are evicted first (`mergeRecordSet`).
- Hashing happens first; `commit()` then installs the set and the subject digest together, synchronously. A commit prepared against a set that changed in the meantime, or into an ended session, fails with `CANCELLED` (`prepareRecordMerge`).
- Any change of the set changes the subject digest, which clears prepared consent at once (`Session.mutate`) and aborts running real-data work. A failed, cancelled, or empty search changes nothing.
- `endSession` wipes the set with the session.

## 4. Checks at prepareReal

`resolvePinnedStudies(packet, lookup)` runs these checks over a `RecordLookup` (any read-only record store):

1. R4 bounds: 1 to 10 unique Decisions studies and 1 to 2 unique Agents studies (`assertR4Packet`); otherwise `INVALID_REQUEST`.
2. Membership: every NCT ID in the packet is a held record; otherwise `RECORD_NOT_IN_SESSION`. NCT IDs that appear only inside record text never become records.
3. Condition term: the term equals one entry of `conditions` or `meshTerms` of any held record, compared as exact strings (no trimming, case folding, or Unicode normalization), and is at most 200 UTF-8 bytes; otherwise `CONDITION_TERM_NOT_IN_SESSION`. A term the user typed matches only if it is literally public vocabulary on a held record.
4. Projection: each study object is `toModelStudy(record)`, a pure function that keeps only the allowlisted public fields (`id`, `title`, `conditions`, `status`, `summary`, `criteria`, `criteriaTruncated`, `minimumAge`, `maximumAge`, `sex`, `sourceUrl`, `retrievedAt`, `lastUpdatePostDate`) and fits them to 5,120 bytes by cutting the criteria, then the summary, then dropping trailing conditions. Contacts, officials, sponsor, locations, ZIP codes, and coordinates are not fields of the result.

`buildPreviewFromRecords` builds the exact preview from those studies with the contract builders in `preview.ts`. `verifyPreviewAgainstRecords` re-derives the preview and requires exact equality, so a builder cannot change study text, add a field, use another record version, or reorder anything. The session adapters `buildPinnedPreview` and `verifyPinnedPreview` additionally require the session subject digest to equal the record-set digest (`INTERNAL_ERROR` otherwise). On this branch the dispatcher runs `verifyPinnedPreview` on every built preview, whichever builder produced it.

## 5. Payload rule and R4 at send time

Model-bound payloads contain only: the profile (`conditionTerm` from section 4, `ageBand`, optional `sex`, optional `state`) and the projected public study objects. The packet schema has no field for free text, ZIP codes, coordinates, exact age, date of birth, names, or contacts. Tests check this with canaries: fictional contact names, phone numbers, emails, site ZIP codes, coordinates, facility, city, and sponsor values that are present in the held records never appear in any preview, and every profile and study object has only the allowed keys.

For the send path, `bounds.ts` provides `decisionsSendPlan` (exactly one pinned Decisions body per scored study, at most ten), `assertAgentsBound` (one to two Agents studies with one tool result each), and `runBounded` (runs one call per item with at most three in flight; a failure or cancellation stops new calls, waits for running ones, and reports a constant error code). Retries of one Decisions request happen inside its call and therefore count toward the limit of three. These helpers are not yet wired into a send path (section 6).

## 6. Not decided here (dispatcher reconciliation, stage 2)

- The A1a critic findings (MAJOR-1 and MAJOR-3) move membership, condition-term, and projection checks into the dispatcher and replace per-branch session stores (`RECORD_SET_SLOT` here, `STUDY_RECORDS` in task A1b) with one dispatcher-owned record index. The functions in sections 2 to 5 take a `RecordLookup` and do not depend on the session, so that index can call them directly.
- Merge or replace: this branch merges searches into one capped set, so a user can compare studies from several pages or searches. The A1a fix branch replaces the set on each search. Either policy keeps the pin sound, because every change of the set clears consent; the reconciliation must pick one.
- Projection: the A1a fix branch has its own `projectModelStudy`, which drops trailing conditions before cutting the criteria. Exactly one projection must remain, and the dispatcher must use it for both building and verifying.
- The send capability must send exactly the pinned bodies, follow `decisionsSendPlan`, and run Decisions requests through `runBounded` with a limit of three.

## 7. Known limits

- The pin covers the records as fetched in this session; it says nothing about whether ClinicalTrials.gov changed a record afterwards. Each study object carries `retrievedAt` and `sourceUrl`.
- Records from earlier searches stay eligible until they are evicted or the session ends.
- Re-running a search changes `retrievedAt` and therefore clears prepared consent, even when the study text is the same.

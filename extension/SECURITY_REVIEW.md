# Security review — reviewed source 29f126b

Fresh independent review passed for the source and automated security boundaries at commit `29f126b1e30bdb14b9172d83d030f3038308f343`. This report records that checkpoint; it is not a certification or proof of security against every attacker.

## Verified evidence

- 49 extension tests and 21 native tests passed, alongside typecheck and both A/B builds.
- Actual native stdio through intercepted HTTPS serialization produced six test API requests containing exactly the consented preview bodies and public tool evidence. RPC IDs, preparation tokens, digests, private canaries, operator identity and privacy contact were absent from provider traffic.
- Invalid, stale, expired, revoked and reused consent receipts fail before HTTP requests.
- UI and native catalogs contain the same 2,000 public study records and 3,514 public condition labels; source bytes and hashes match. Labels require explicit selection and are not normalized diagnoses.
- Session-only state, deletion-only legacy cleanup, scroll/checkbox acknowledgment, separate exact-payload confirmation, one-use operations, cancellation and lifecycle clearing are covered by automated tests.
- Earlier review findings were fixed and regression-tested: delayed bootstrap reactivation after End/hide; fatal SSE errors followed by an apparent completion; active-session cancellation before bounded DELETE and strict deletion acknowledgment validation.

## Limits and unverified behavior

The HTTPS traffic was intercepted test traffic with fake credentials, not a live OpenAI run. Actual account/model permissions, live API execution, real Chrome installation/rendering/native handshake, Chrome hide/close timing and autofill behavior remain unverified. Native installation tests use isolated homes, not the user's Chrome registration. The Keychain helper compiled; no user credential was accessed or configured.

Provider retention and asynchronous physical deletion cannot be independently proven by these tests. Deletion may fail or remain unconfirmed. Minimized health information is not anonymous. No HIPAA/legal certification, OS-malware resistance or forensic browser/OS memory erasure is claimed.

Current source notice: `src/privacy-notice.tsx`. Operator: Kurt Lehnardt - Developer of Treatable. Privacy contact: privacy.6vpc5@mailer.me. These are notice-only values, not model inputs; contact ownership was not independently verified.

This documentation-only report does not change the reviewed executable source or current build artifacts. Setup and privacy boundaries are described in [README.md](README.md).

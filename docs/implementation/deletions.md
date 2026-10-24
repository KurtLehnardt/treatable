# Targeted phase-one removals

- Competitor routes, analysis modules, contracts and tests: explicitly DELETE in source spec; no clinical analogue.
- Funding strategy and readiness modules/routes/tests: explicitly DELETE; replaced by study contacts and care-team summary.
- Analytics implementation and contract/tests: explicitly DELETE; patient app has no telemetry. Existing no-server-retention guard retained, with its analytics-contract section replaced by checks that capture surfaces are absent and matching does not import persistence. Logging scanner also covers patient-specific fields.
- Mock-auth module/test and account UI: explicitly DELETE; no accounts.
- Grants/runs/company-description stores, company graph/similar-company aggregation, grant alerts and welcome preferences: exclusively reached by removed funding/account UI. They persist funding-era state and have no phase-one clinical use; associated tests removed with those modules.
- Funding-specific UI and its snapshot tests replaced by patient intake/model settings/results/map tests. Reusable local search status, layout utility, provider/security/retrieval tests are retained.

Remaining adaptation work is not declared deleted: legacy funding contracts/scoring adapters remain for retained shared algorithms; state-source scripts/data and old corpus/interview/log API paths need final integration review. Deferred installer source remains untouched.

# Execution workflow

The attached source spec explicitly requests quick mode through Q3, skipping Opus review and fix phases. Available model names differ from its Claude-specific examples. Use the user-authorized manager/worker delegation workflow and deterministic verification; do not claim unavailable model-specific gate compliance.

1. Foundation: clean tracked-source snapshot, inventory, scope checklist and baseline checks.
2. Domain/data: Study/Patient contracts, CT.gov ingestion with live field verification, shipped US records, vectors, eligibility/retrieval and synthetic fixtures.
3. Application: one-screen intake, OpenAI/local matching, consent/privacy, SSE, cards, map, contact scripts and clinician summary.
4. Platform/validation: macOS install/menu-bar/launcher/uninstall, demos/evals, docs and integration checks.

All implementation occurs in .Codex/worktrees on codex/* feature branches. Exclusive ownership is assigned by the manager; package/lock/config wiring gets a single writer. Root working tree remains a clean baseline. Original installer/ is deferred.

Existing scaffold commands: npm test; npm run typecheck; npm run build; npm run check:prompts; npm run eval:quality; npm run eval:builtin. Existing dependency versions are preserved unless an unmet requirement needs a new dependency.

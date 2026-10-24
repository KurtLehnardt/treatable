# Version B

Version B uses the linked [make-interfaces-feel-better skill](https://github.com/jakubkrehel/make-interfaces-feel-better/tree/main/skills/make-interfaces-feel-better) with existing React/plain CSS: readable cards, roomier controls, visible focus, restrained property-specific transitions and reduced motion.

The current A and B both use the new panel-memory privacy policy. B's navigation is **Profile → Local search → API demo**. There is no Saved/Remember capability. The original A ZIP is an archived PRE-PRIVACY BASELINE — NOT CURRENT artifact.

Build from `extension/` with `npm run build:all`. A writes `dist`; B writes `dist-b`. Both share the extension ID, site permissions, native helper, corpus and security contracts. Follow [README.md](README.md) and [native/API_SETUP.md](native/API_SETUP.md). No Chrome installation or A/B switching was performed; do not uninstall an existing variant as an implicit data-migration step.

Actual Chrome layout/keyboard/10%-speed motion checks remain unverified. The older visual-source review is preserved for provenance in VERSION_B_REVIEW.md; it is not a combined security approval.

# Treatable Chrome extension — Version B

Version B applies [make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better/blob/main/skills/make-interfaces-feel-better/SKILL.md) to the patient study panel. It uses the same React, plain CSS, font family, clinical controller, screening rules, local native helper, storage, extension identity, ClinicalTrials.gov allowlist, and 2,000-study snapshot as Version A.

The B presentation has Profile / Search / Saved navigation, larger labelled controls, readable study cards, a persistent truthful local-model status, and a Stop control available from every section during generation. Model availability is checked only when requested.

## Build and artifacts

From `extension/`:

```sh
npm ci
npm run build:all
npm test
npm run typecheck
node --test native/test/*.test.mjs
```

The native transport tests need permission to use loopback sockets. A sandboxed run may fail the local transport fixture even though the unchanged transport passes with loopback access.

- `dist/`: current Version A build. Its view/copy/CSS remain the original A presentation; state and results rendering now use shared modules.
- `dist-b/`: Version B, named **Treatable · Version B** in Chrome.
- `treatable-extension-a.zip`: original A package preserved byte-for-byte from baseline commit `b5da612`.
- `treatable-extension-b.zip`: packaged B build.
- `VERSION_A_BASELINE.sha256`: original package checksum. ZIPs and build folders are local generated artifacts, not committed source.

Both manifests have the same public key and extension ID, `lmgmjeabbalehlcakdbolielnfgchojf`. Chrome can use one presentation at a time; both use `com.treatable.local`. No native registration or user Chrome settings were changed during this work.

## Try B

For a first unpacked install, follow [README.md](README.md) and [NATIVE_SETUP.md](NATIVE_SETUP.md), selecting `extension/dist-b` as the unpacked folder. Native setup can use the B manifest:

```sh
node extension/native/install.mjs --manifest extension/dist-b/manifest.json
```

For an existing unpacked extension loaded from `extension/dist`, use that same loaded folder and Chrome's **Reload** control instead of uninstalling the extension:

```sh
cd extension
npm run build:b
cp -R dist-b/. dist/
```

Return the same folder to A with `npm run build`, then use Chrome's **Reload** control. Do not uninstall to switch presentations. Storage keys are unchanged; actual Chrome switching and persistence were **not verified**, so this is a manual comparison workflow, not a promise about Chrome's installation behavior. Clear patient data only with the existing explicit control when desired.

## Verification boundaries

The source, React state transitions, SSR markup, packed permissions, worker, dataset/provenance parity, native tests, typecheck, and A/B builds were verified. Actual Chrome loading/rendering, the native handshake from Chrome, keyboard/hover/focus appearance, small-width layout geometry, and motion at 10% speed were **not verified** because the available browser controls could not attach to Chrome. No browser-automation fallback bypass was used.

The local corpus remains a snapshot. Studies outside it can provide page excerpts and questions, while structured eligibility stays unknown. Local model drafts are unverified research information; this UI change does not clinically validate a model or establish eligibility.

See [VERSION_B_REVIEW.md](VERSION_B_REVIEW.md) for the skill-based change evidence and rejected candidates.

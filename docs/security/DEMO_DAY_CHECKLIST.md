# Demo-day security checklist

For the operator (Kurt Lehnardt - Developer of Treatable) on 2026-10-24, demo at 3:00 PM Mountain Time. Background: [threat model](THREAT_MODEL.md), [security policy](../../SECURITY.md), [API setup](../../extension/native/API_SETUP.md).

## Before (by 2:00 PM)

- [ ] **Dedicated OpenAI project** used only for this demo (US data residency; the Agents API supports only US).
- [ ] **Dedicated key with only what the app needs**: Decisions access plus `api.agents.read`, `api.agents.write`, `api.responses.write` ([Agents API beta FAQ](https://help.openai.com/fr-fr/articles/20001551-agents-api-beta-faq)). Everything else off.
- [ ] **Low project budget** (for example USD 10–20) and a usage alert.
- [ ] Release commit has a green [`extension-security`](../../.github/workflows/extension-security.yml) run, or locally: `cd extension && npm ci && npm run typecheck && npm run build:all && npx tsx --test tests/*.test.ts && node --test native/test/*.test.mjs`.
- [ ] Install the helper: `node extension/native/install.mjs --manifest extension/dist-b/manifest.json`.
- [ ] **Enter the key only at the terminal Keychain prompt**: `node extension/native/credentials-setup.mjs configure`. Never in Chrome, chat, slides, a command argument, an environment variable or a file. Copy something harmless afterwards to clear the clipboard.
- [ ] If the first run says the key was rejected and the key is longer than 128 characters, the pre-fix `getpass` prompt may have truncated it (fix In progress on `security/native-hardening`).
- [ ] Load `extension/dist-b` unpacked in a **dedicated Chrome profile** with no other extensions. In that profile turn off Enhanced Spell Check (it sends typed text to Google) and address/payment autofill.
- [ ] **One consented fictional run**: Decisions score, then the Agents task. Confirm tool calls appear and cleanup shows **deleted**. If cleanup shows failed, note the session ID and delete it after the demo.
- [ ] Screen: Do Not Disturb on; close the OpenAI dashboard, terminals with history, and other tabs.

## On stage

- [ ] **Fictional fixture only.** Never type real health information, names or contact details, and never use a volunteer's data.
- [ ] If asked about failure handling, show it after the main flow: `node extension/native/install.mjs --uninstall`, run an operation, show the honest failure state (`NATIVE_HOST_MISSING` once `security/panel-hardening` lands; a generic `OPERATION_FAILED` before that), then reinstall with the install command. Uninstall keeps the Keychain item. Rehearse this once: reinstalling recompiles the helper and macOS may ask again to allow Keychain access.
- [ ] Press **End session** when done and close the panel.

## After (same day)

- [ ] **Revoke or rotate the key** in the OpenAI dashboard; archive the project if it is no longer needed.
- [ ] `node extension/native/credentials-setup.mjs remove` to delete the Keychain item; optionally `node extension/native/install.mjs --uninstall`.
- [ ] Check project usage for unexpected requests and delete any Agents session whose cleanup failed.

## One-line answers

- **"What if someone types a prompt injection?"** On the API path the user can only pick enums and catalog IDs, so free text never leaves the panel, and model output is reduced to IDs and numbers rendered through fixed templates.
- **"Where is the API key?"** In a dedicated macOS Keychain item, read by a Swift helper into native memory only; the browser never sees it and its CSP blocks any network call except to itself.
- **"Is this HIPAA compliant?"** No. It is not a HIPAA-covered product and there is no BAA with OpenAI, so we minimize what is sent, and minimized data is still not anonymous.
- **"Does OpenAI keep the data?"** The Agents API keeps session state until deleted and is not ZDR; we delete after every run and show the result, and default abuse-monitoring logs may keep content up to 30 days.
- **"What about a poisoned trial record?"** The snapshot is hash-pinned, record text is labelled untrusted, the only tool takes a selected public NCT ID, and the worst case is a wrong relevance index or question choice, never free text or another action.
- **"What can another app on this Mac do?"** Likely read the key through the helper; that is a documented accepted risk, limited by a restricted key, a low budget and rotation today.

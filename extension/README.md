# Treatable Chrome extension

Treatable helps you understand a public clinical study and prepare to contact its study team. Its toolbar button opens an overlay on **ClinicalTrials.gov only**. You open a study, read **Understand this study**, and can then press **Generate study brief**. The result is a brief in which every fact is quoted from the official record with a link back to it, three questions to start with, the study's listed contacts, and editable drafts of an email, a phone call script and a follow-up message.

Treatable provides research information, not medical advice. It cannot tell you whether you are eligible for a study or whether a treatment will help you. Your care team and the study team must decide that. Treatable never sends an email or places a call for you.

[How Treatable uses OpenAI](#how-treatable-uses-openai) · [Privacy policy](https://kurtlehnardt.github.io/treatable/privacy.html) · [Native helper setup](native/API_SETUP.md)

The standalone prototype on localhost:5556 and the native/mobile app work are separate projects. This extension does not include application submission, researcher profiles, literature search or early-results synthesis.

## How it works

1. **Search or open a study.** Use the overlay's search form or ClinicalTrials.gov's own controls, then open a study page. On a results page, the overlay lists the studies loaded there and lets you choose up to two.
2. **Understand this study.** The overlay downloads the official record from ClinicalTrials.gov and shows excerpts of the study's purpose, participation details, design and recruitment status, plus "Important unknowns" (things the record does not say, such as a missing visit schedule or no listed contact). Registry milestone dates are kept apart from your visit schedule. Nothing in this step is sent to OpenAI.
3. **Generate study brief.** Pressing this button, which only your own click or key press can do, starts the OpenAI steps described in [How Treatable uses OpenAI](#how-treatable-uses-openai): an Agent selects exact record excerpts and standard questions, then the Decisions API sorts each question by who can answer it. The overlay then shows:
   - **What participation could involve**: claims that are word-for-word copies of record excerpts, each with a **Read the supporting record text** link to the official record.
   - **Three questions to start with**: the first three questions that Decisions routes to **Ask the study team**.
   - **How this was generated**: what was sent, what came back and what was checked.
4. **Who to contact.** Treatable picks the nearest site that is recruiting when you give a US ZIP code, or lets you choose a site. It lists that site's contact, falling back to the study's central contact, with backups and the principal investigator's name. Warnings appear when, for example, the record is old, the study is close to completion, a site is not recruiting yet, or contact details look inconsistent.
5. **Personalize your email** (optional, on your device only). Type a name, phone, reply email, best times, a ZIP code and any background you choose to share. Nothing typed here is sent to OpenAI.
6. **Your email draft.** Treatable writes an editable draft addressed to a listed contact, with up to three questions. **Open draft in my email app** hands it to your own mail program. **Copy message** and **Copy full email** put it on your clipboard. You read it and press Send yourself.
7. **Call script and follow-up.** Each phone contact from the record gets a **Call** (`tel:`) link and **Copy number** when the number checks out. Treatable also writes a call script, a follow-up message, a follow-up date five business days away, and a calendar reminder file you can download. The reminder holds public study and contact information only.

If you have not generated a brief, steps 2 and 4 to 7 still work, using standard questions. Pressing **End and clear my details** clears the drafts, scripts and everything you typed, including Settings → Your details. When the five-minute session expires, the drafts, scripts and details typed in that section are cleared and Treatable asks you to reopen it; Settings → Your details stay until you clear them or the Treatable session ends.

## How Treatable uses OpenAI

**Generate study brief** is the only action that contacts OpenAI. It makes two calls, in this order, through a small local native helper on your Mac:

| Step | OpenAI API | Model | Job |
|---|---|---|---|
| 1 | Agents API | `gpt-6-astra` | Read the selected studies' record excerpts through one restricted tool. Choose which excerpts to quote and which standard questions, pre-screening topics and warnings apply. |
| 2 | Decisions API | `gpt-6-luna` | For every selected question, decide whether the record answers it, the patient must answer it, or the study team should be asked. |

You use your own OpenAI API key. The helper keeps it in the macOS Keychain, and requests count against your OpenAI account. The helper also needs your account to have access to both APIs and the models above (see [native setup](native/API_SETUP.md)).

The browser side of the extension cannot choose the OpenAI address, model, prompt or tools, and it cannot add text. It sends the helper only one or two public NCT IDs and, later, a one-use receipt. When you press the button, the helper downloads the official records from ClinicalTrials.gov itself, builds the exact OpenAI requests, pins them, and runs only those pinned requests when the extension returns a one-use receipt. It validates every reply before the extension shows anything.

Only **public study IDs and public record text** are sent to OpenAI. Record text is cleaned of invisible and control characters and labelled in the requests as untrusted third-party text whose instructions must be ignored. That reduces, but cannot eliminate, the chance that text in a record influences a model, which is why the outputs below are tightly restricted. Your name, contact details, ZIP code, typed answers, notes and drafts are never part of any request: the messages from the overlay to the helper accept only NCT IDs and one-use receipts. Automated tests also plant recognizable fake values in the details fields (name, reason for reaching out and notes) and check that they appear in your local drafts but in no message to the helper, no OpenAI request and no log.

### Agents API

**What it does.** The Agent reads the official-record excerpts of the one or two selected studies and picks the ones most useful for understanding participation, such as the schedule, procedures, sham or control groups, possible crossover and criteria. It also picks which standard questions, pre-screening topics and warnings fit each study. It writes no free text of its own.

**What is sent.** One streamed request to `POST https://api.openai.com/v1/agents/sessions` (with the `OpenAI-Beta: agents=v1` header) using model `gpt-6-astra` at low reasoning effort. The session has no environment, so the Agent has no browser, files or shell. The request holds:
- instructions that say the Agent has no patient information and must call the tool once for each selected study (at most two calls);
- the NCT IDs of the selected studies;
- the fixed lists of questions, pre-screening topics and warnings the Agent may choose from;
- one function tool, `get_public_selected_study`, which accepts exactly one selected NCT ID; and
- a JSON schema for the answer.

The tool returns only excerpts that the helper already downloaded from the official record and pinned: up to 36 per study, covering the purpose, description, design, groups, key dates, age and sex limits, the first eight eligibility criteria and the recruitment status, plus the list of gaps in the record.

**What comes back.** For each study: up to eight claims, each an exact copy of one record excerpt with its evidence ID; 3 to 8 question IDs, 2 to 8 pre-screening IDs and up to 4 warning IDs from the fixed lists; and, for each chosen question, the IDs of the excerpts (up to three) that directly answer it.

**How the output is checked.** The helper accepts the answer only if all of these hold:
- the Agent called the tool for every selected study;
- the answer matches the schema exactly, with no extra fields and IDs only from the fixed lists;
- the text, category and quote of every claim are identical to the excerpt it cites; and
- every evidence ID refers to an excerpt that exists.

If any claim differs from the record, the whole Agent answer is discarded. A tool call with anything other than exactly one selected NCT ID gets a fixed error and no study text, and the helper stops the run after more than six tool calls. Patient-facing wording for questions, pre-screening topics and warnings comes from built-in templates in Treatable, not from the model. If a detailed record yields more claims than fit the size limit, the first claims that fit are kept.

**If it fails.** Treatable falls back to defaults: no quoted claims, three standard questions (still enrolling, visits, next steps) and two standard pre-screening topics. The Decisions step still runs on those. The status line reads "Agents: review unavailable" and names the failure code.

**Cleanup.** The helper deletes the Agents session when the run ends. If the run did not finish, it first asks the Agent to cancel. It makes up to two delete attempts within about 5.5 seconds and counts the session as deleted only when OpenAI returns the expected deletion acknowledgment. Until then it keeps the opaque session ID, with no health data or prompts, in a small local file. If the helper is stopped mid-run, a detached cleanup process and later helper runs retry any unconfirmed session. "How this was generated" shows either "Provider session deletion acknowledged" or "Provider session deletion could not be confirmed". See [Retention and deletion](#retention-and-deletion).

### Decisions API

**What it does.** For each selected question, Decisions chooses one of three routes:
- **Answered in the record** (`answered_by_record`): the cited public text directly answers the entire question.
- **Your input may help** (`ask_patient`): only the patient can supply the answer.
- **Ask the study team** (`ask_coordinator`): the record does not fully answer it, is unclear, or needs the team to confirm. Missing costs, visit length, eligibility or timing always stay here.

Decisions is told not to assess eligibility, benefit or safety.

**What is sent.** One `POST https://api.openai.com/v1/decisions` request using model `gpt-6-luna`. It holds the same public excerpts (labelled as untrusted text), the IDs of the excerpts the Agent linked to each question, and one multiple-choice question per selected question, up to eight per study. Each question names the public study and carries the question's built-in wording.

**What comes back.** For each question: the chosen route, a confidence between 0 and 1, and a probability for each of the three routes.

**How the output is checked.** The helper requires exactly one answer for each question, no unknown names, one of the three routes, a confidence between 0 and 1, and one probability per route that are each between 0 and 1 and add up to 1. Anything else discards the whole Decisions answer. An **Answered in the record** choice that has no cited excerpt is downgraded to **Ask the study team**.

**How it is used.** The first three questions routed to **Ask the study team** become **Three questions to start with**, and they feed the email draft and call script. Questions that the record answers, or that only you can answer, are left out of those three; every question's route and probabilities are listed under **How this was generated**. If no question needs the study team, the first three questions are shown with their routes.

**If it fails.** Every question is shown as **Ask the study team** and the first three of the Agent's questions are used. The status line reads "Decisions: classification unavailable" and names the failure code.

### If a step cannot run

The status line under the Generate button names each stage that failed, using plain wording and a failure code. If the helper is not installed, the key is missing or rejected, the account lacks access, a rate limit is reached or OpenAI cannot be reached, Treatable shows that message and the rest of the overlay keeps working. Failures in the Agent or Decisions are never replaced by invented results.

### How this was generated

The **How this was generated** section under the Generate button shows:
- the study IDs and source excerpt IDs that were used;
- display copies of the exact Agents and Decisions request bodies, formatted for reading, which you can copy (each copy is capped at 64 KiB; the request itself is never shortened, and a cut copy says so);
- each tool call the Agent made and what the tool returned;
- for every question, the Decisions route, confidence and the probability of each route, including a note where a missing citation downgraded the route; and
- whether the Agents session deletion was acknowledged.

Headers, credentials and OpenAI session IDs are never shown. A result produced by a mocked adapter in automated tests is labelled as a test run and is never presented as a live OpenAI result.

### What Treatable does without a model

These parts are ordinary local code, not model output: downloading and cleaning the official record, choosing excerpts, listing important unknowns, warnings (near completion, site and overall status mismatch, inconsistent contacts, no direct site contact, an old record, not yet recruiting, few listed sites and age limits), which local code can raise from the record on its own and which the Agent may also select from the same fixed list, choosing a site and its approximate distance, choosing contacts, writing the email, call script and follow-up message, the follow-up date, and the calendar reminder.

### What stays on your device

- Everything you type under Personalize your email and in Settings → Your details: name, phone, reply email, best times, ZIP code, background answers, your reason for reaching out, and any other note.
- Your edited email draft, call script and follow-up message.
- Your ZIP code and the distance calculation. Approximate ZIP-area centers are bundled in the extension and no geocoding service is called.
- Your OpenAI API key, which lives only in the macOS Keychain and in the helper's memory while a request runs. It is never in Chrome, command-line arguments, environment variables, files or logs.
- Your search terms and filters. These go to ClinicalTrials.gov, as on its own website, and may appear in your browser history. They are not sent to OpenAI.

Opening or copying an email moves its text out of the extension, into your mail program or clipboard. That is your choice, and Treatable has not sent anything.

### Retention and deletion

The Agents API keeps session state until the session is deleted, and Agents sessions are not eligible for zero data retention. Treatable requests deletion and shows whether OpenAI acknowledged it. It makes no promise of instant or complete physical erasure, and a failed or unconfirmed deletion is shown as such. According to OpenAI's [data controls guide](https://developers.openai.com/api/docs/guides/your-data), default abuse monitoring may retain content for up to 30 days, subject to exceptions, and API data is not used for training by default. Check that guide for current terms, because they are OpenAI's and can change. Only public study data is in these requests, but closing the overlay cannot retract data already sent. See the [privacy policy](https://kurtlehnardt.github.io/treatable/privacy.html) for the project's own practices.

### Older paths kept in the repository

The earlier profile-based matching path (**Find my matches**, a separate confirmation window and percentage badges that reorder a results page) is no longer shown in the toolbar overlay. Its code, helper operations and tests remain in the repository. The retained legacy panel (`panel.html`, built in every folder below) holds local screening against a bundled snapshot of 2,000 ClinicalTrials.gov studies, fictional API examples (a built-in fictional profile and two fixed public studies) and an optional analysis of up to two snapshot studies. The toolbar button does not open it, and native Chrome side panels stay disabled. Its entry address is `chrome-extension://lmgmjeabbalehlcakdbolielnfgchojf/panel.html`; actual Chrome access to it has not been verified. The legacy panel's own notice describes what its optional analysis sends.

## Build and install

Requires Chrome **142+**, a working Node **20+** runtime, macOS and Xcode command-line tools for the native Keychain helper. Search and public records do not require an API key. Generating a study brief requires the installed native helper and an OpenAI API key that you configure yourself. Everything else works without them.

```sh
cd extension
npm ci
npm run build:all
npm run typecheck
node --import tsx --test tests/*.test.ts
node --test native/test/*.test.mjs
```

The build folders are:

| Folder | Interface |
|---|---|
| `extension/dist` | Current Version B; default build |
| `extension/dist-b` | Identical Version B compatibility build |
| `extension/dist-a` | Preserved Version A reference |

All three share the same toolbar overlay and differ only in the retained legacy panel and the manifest name. Chrome → Extensions → Developer mode → Load unpacked → choose **`extension/dist`**. After an update, Reload the extension and refresh the ClinicalTrials.gov tab. All variants share a pinned extension ID; use only one in a Chrome profile at a time. The current B archive is `extension/artifacts/treatable-version-b-current.zip`, with the manifest at its root. Extract into a dedicated folder before loading unpacked. Earlier A archives marked **PRE-PRIVACY BASELINE — NOT CURRENT** are historical artifacts.

From the repository root, install the native helper before configuring its credential:

```sh
node extension/native/install.mjs --manifest extension/dist/manifest.json
node extension/native/credentials-setup.mjs configure
node extension/native/credentials-setup.mjs status
```

The installer pins the Node executable used to run it. Use a functioning runtime; rerun the installer after moving or replacing that runtime. Credential setup prompts with terminal echo disabled and saves only the dedicated macOS Keychain item. Never put the key in Chrome, arguments, environment variables, configuration files, chat or logs. `status` checks metadata; it does not verify account authorization. See [native setup and runtime recovery](native/API_SETUP.md).

## Search the website

1. Open `https://clinicaltrials.gov` or `https://www.clinicaltrials.gov` and click Treatable in Chrome's toolbar. Other hosts and HTTP pages are unsupported; there is no globally enabled Treatable side panel.
2. Enter condition/disease, other terms, intervention/treatment or location. More filters starts collapsed and contains all 28 logical fields: status, eligibility and age ranges, phase/type, results/documents, funder, six date ranges and additional search fields.
3. Search navigates to the registry's own results URL. Search terms and website filters go to ClinicalTrials.gov and may appear in browser history. This action makes **no OpenAI request**.
4. The overlay reopens compact after the search. Expand it to choose up to two studies from the results, or open a study page, and use Understand this study. Treatable opens in the **Popup** display by default: a centered window, with the page behind it inert until the window is collapsed. The top-right settings gear offers Popup, Overlay (a bounded card that leaves the rest of the page interactive, with no dimming or opacity control) or in-page Sidebar, plus System, Light or Dark themes. A saved choice always wins over the default; native Chrome side panels stay disabled.

US ZIP codes in the search form resolve from approximate offline postal centers, with a default 50-mile distance. Editing location text discards prior coordinates. Other addresses, cities, states or countries require the website's own location controls; collapse/close Treatable to use them, then reopen it on the resulting search. Treatable refuses an unresolved location rather than pretending the filter was applied. Table/map views and unknown card layouts remain read-only.

The accepting-only filter defaults to recruiting and available expanded-access studies; optional checkboxes include opening soon or invitation-only studies. Fresh public status also filters already loaded cards. Unknown or unavailable status stays visible and labeled unverified. Turn accepting-only off to use other study-status selections; this does not load studies absent from the current website results.

## Guided walkthroughs

Both walkthroughs use [SweetAlert2](https://sweetalert2.github.io/) 11.26.25, bundled into the extension (no CDN, no remote code). Its dialogs are mounted in the extension's own shadow root and carry their own stylesheet, so ClinicalTrials.gov styles do not reach them and theirs do not reach the site. A guide only highlights: it never ticks, types into, submits or clicks anything for you, and it removes its highlight and dialog when it ends or is skipped.

- **Show me how to search** (Treatable panel, search pages only) walks through two website filters. It collapses the panel, highlights **Recruiting** under Study Status and waits for you to tick it, then does the same for **Interventional** under Study Type, explaining that interventional studies test a treatment and observational studies do not assign one. Ticking only stages the filters on ClinicalTrials.gov, so once both are ticked it highlights the site's own **Apply Filters** button and waits for you to press it. If the filters are hidden (the Hide/Show panel on a wide screen, or the Focus Your Search drawer on a narrow one) it highlights the button that opens them. If a box cannot be found it shows plain instructions instead.
- **Intro tour** starts by itself the first time Treatable is opened, and **Replay intro** (panel footer) runs it again. Steps: welcome, how to change the look of Treatable (Popup, Overlay, Sidebar, theme), starting on ClinicalTrials.gov search, where to type your condition and location, optional filter help (the walkthrough above), opening a study, then Treatable's study tools: Understand this study, Generate study brief, Personalize your email, the editable draft, and Copy full email / Open draft in my email app. The tour only highlights these controls. It never presses Generate study brief, and Treatable never sends the email; you do.

The tour keeps two values, nothing else, and never anything you type, any search term or any study ID: `treatable.onboardingVersion` (the number 1, in extension-local storage, set when the tour is finished or skipped) and `treatable.onboardingStep` (a bare step number in session storage, so the tour can resume after the page navigates; removed when the tour ends). All access lives in `src/guide-state.ts`, uses the existing `storage` permission, and the deletion-only legacy patient-data cleanup removes only its own key. No network request, new permission or host change is involved. sweetalert2 releases after 11.4.9 on some lines shipped locale- and domain-gated "protestware"; the pinned 11.26.25 has none, and a test fails if a vendor update adds any.

## Privacy and session lifetime

Generating a brief sends OpenAI public study data only (see [How Treatable uses OpenAI](#how-treatable-uses-openai)). The study and search session of the overlay lasts 30 minutes and slides forward whenever you type or click in the overlay. To avoid flooding the extension, a renewal message goes to its background worker at most once every 20 seconds. In the last five minutes the study section shows a small countdown, and in the last minute it also shows a **Keep working** button, announced through the section's status line, that renews the session for another 30 minutes. If you have not typed or clicked for 30 minutes, the session expires.

Switching to another tab or hiding the window does not end the session. The overlay keeps checking the page while hidden so the background worker stays connected, and the 30-minute deadline keeps running, so a tab left hidden still ends at its deadline. Chrome can throttle a hidden tab or stop the background worker; if the connection is lost, the session ends and clears like any other ended session. Closing or reloading the page (Chrome's `pagehide`), pressing **Close** and pressing **End and clear my details** end the session at once. Moving to a different study ends the study section's session and clears its drafts; the new study starts a fresh session, and drafts are not carried from one study to another. When the session ends or expires, Treatable clears the drafts, call scripts, follow-up messages and details typed there and asks you to reopen it. The session deadline, countdown and renewals live only in memory: nothing about them is written to extension storage, web storage or IndexedDB.

Prepared OpenAI requests are separate. They keep their own five-minute, one-use receipts, and a longer session does not extend them.

Settings → **Your details** holds an optional name, a description of the illness, condition, symptoms or reason for seeking treatment, and an "anything else" note. These values only fill the patient's own local email draft, call script and follow-up message, which stay editable. They live in the overlay frame's memory, are never written to extension storage, web storage, IndexedDB, files or cookies, and are never sent to OpenAI, the native helper, ClinicalTrials.gov, traces or logs; only the patient-started mailto handoff or copy carries them out. Clear my details, End and clear my details, closing Treatable and any ended session wipe them. The call script and follow-up list each phone contact from the official record with a **Call** (`tel:`) link and **Copy number**; links are built only from structured contact fields as E.164 numbers with an optional `;ext=`, and numbers that do not check out show as text without buttons.

There is no Save/Remember control or patient-history feature. The `storage` permission removes known legacy patient keys from extension local/session storage without reading their contents or writing a migration flag. The only value it writes is one non-health preference record, `treatable.uiPrefs` in `chrome.storage.local`, holding the display mode (`overlay`, `popup` or `sidebar`) and theme (`system`, `light` or `dark`) and nothing else. The intro tour adds exactly two more non-health values, described under Guided walkthroughs: a done flag and a step number. Ending the session clears patient data but keeps these display preferences.

The stdio-only native helper has no localhost HTTP inference listener. Credentials stay in the dedicated Keychain item and transient native memory. Browser OpenAI requests, arbitrary model/tool/URL proxies, cookies and telemetry are absent. The helper talks only to `api.openai.com` and `clinicaltrials.gov` over TLS with certificate verification and no redirects. Model output is bounded to validated IDs, exact record excerpts and built-in templates; this reduces authority but cannot promise that untrusted text never influences a permitted choice.

Application clearing is not forensic memory erasure. A compromised browser/OS, same-user malware, administrator access, swap/crash data and arbitrary debugging remain outside these guarantees. No anonymity, HIPAA certification or legal sufficiency is claimed. See [HHS de-identification guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html) and the project's [privacy policy](https://kurtlehnardt.github.io/treatable/privacy.html). The operator is **Kurt Lehnardt - Developer of Treatable**, **privacy.6vpc5@mailer.me**.

## Testing and known limits

Run the commands under Build and install. The automated tests cover the request and reply contracts, validation of Agent claims and Decisions answers, the study-brief pipeline against a scripted fake OpenAI service (both in-process and through the installed helper over stdio), Agents session cleanup, canary checks that typed personal details never reach the helper or an OpenAI request, the email, call script and follow-up drafts, and the overlay in simulated pages. These tests use fake OpenAI transports; they are not live acceptance of the OpenAI APIs.

These still need manual verification on your machine: how the overlay mounts and is placed on the live ClinicalTrials.gov site, keyboard use, the Chrome-to-helper connection, whether your account can use both OpenAI APIs and models, and deletion of Agents sessions, which can fail or stay unconfirmed. ClinicalTrials.gov records and recruitment change, so check the official record before you act. `BUILD_REPORT.md`, `SECURITY_REVIEW.md` and `VERSION_B_REVIEW.md` apply to the builds and commits they name, and are not runtime verification of the current flow.

Recruitment-query encoding: the current official [filter definitions](https://clinicaltrials.gov/chunk-N3WLMKWZ.js) map `rec` to Recruiting and `ava` to Available in the expanded-access group; their native `not rec` preset uses space-separated statuses. The official [query serializer](https://clinicaltrials.gov/chunk-N5W3TRDQ.js) writes sorted `key:value` entries into `aggFilters`. This verifies encoding, while actual browser filter-chip behavior remains a separate check.

[Native setup](native/API_SETUP.md) · [Security review](SECURITY_REVIEW.md) · [Version B design evidence](VERSION_B_REVIEW.md) · [Privacy policy](https://kurtlehnardt.github.io/treatable/privacy.html)

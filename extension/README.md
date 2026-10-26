# Treatable Chrome extension

Treatable helps you find the public clinical studies most worth contacting and prepare to contact their study teams. Its toolbar button opens an overlay on **ClinicalTrials.gov only**. On a results page, **AI-matched results** (on by default) puts the studies that best match your search first, shows a match percentage on each card and moves studies that clearly do not fit to the end. You open a study, read **Understand this study**, and can then press **Generate study brief**. The result is a brief in which every fact is quoted from the official record with a link back to it, three questions to start with, the study's listed contacts, and editable drafts of an email, a phone call script and a follow-up message.

Treatable provides research information, not medical advice. It cannot tell you whether you are eligible for a study or whether a treatment will help you. Your care team and the study team must decide that. Treatable never sends an email or places a call for you.

[How Treatable uses OpenAI](#how-treatable-uses-openai) · [Local model option](#local-model-option-ollama-on-this-device) · [Privacy policy](https://kurtlehnardt.github.io/treatable/privacy.html) · [Native helper setup](native/API_SETUP.md)

The standalone prototype on localhost:5556 and the native/mobile app work are separate projects. This extension does not include application submission, researcher profiles, literature search or early-results synthesis.

## How it works

1. **Search or open a study.** Use the overlay's search form or ClinicalTrials.gov's own controls, then open a study page. On a results page, AI-matched results reorders the cards (see [Decisions ranking](#decisions-ranking-ai-matched-results)), and the overlay lists the studies loaded there and lets you choose up to two for a brief.
2. **Understand this study.** The overlay downloads the official record from ClinicalTrials.gov and shows excerpts of the study's purpose, participation details, design and recruitment status, plus "Important unknowns" (things the record does not say, such as a missing visit schedule or no listed contact). Registry milestone dates are kept apart from your visit schedule. Nothing in this step is sent to OpenAI.
3. **Generate study brief.** Pressing this button, which only your own click or key press can do, starts the OpenAI steps described in [How Treatable uses OpenAI](#how-treatable-uses-openai): an Agent selects exact record excerpts and standard questions, then the Decisions API sorts each question by who can answer it. The overlay then shows:
   - **What participation could involve**: claims that are word-for-word copies of record excerpts, each with a **Read the supporting record text** link to the official record.
   - **Three questions to start with**: the first three questions that Decisions routes to **Ask the study team**.
   - **How this was generated**: what was sent, what came back and what was checked.
4. **Who to contact.** Treatable picks the nearest site that is recruiting when you give a US ZIP code, or lets you choose a site. It lists that site's contact, falling back to the study's central contact, with backups and the principal investigator's name. Warnings appear when, for example, the record is old, the study is close to completion, a site is not recruiting yet, or contact details look inconsistent.
5. **Personalize your email** (optional, on your device only). Type a name, phone, reply email, best times, a ZIP code and any background you choose to share. Nothing typed here is sent to OpenAI.
6. **Your email draft.** Treatable writes an editable draft addressed to a listed contact, with up to three questions. **Open draft in my email app** hands it to your own mail program. **Copy message** and **Copy full email** put it on your clipboard. You read it and press Send yourself.
7. **Call script and follow-up.** Each phone contact from the record gets a **Call** (`tel:`) link and **Copy number** when the number checks out. Treatable also writes a call script, a follow-up message, a follow-up date five business days away, and a calendar reminder file you can download. The reminder holds public study and contact information only.

If you have not generated a brief, steps 2 and 4 to 7 still work, using standard questions. Pressing **End and clear my details** clears the drafts, scripts and everything you typed, including Settings → Your details. When the 30-minute session expires (it is extended whenever you type or click in the overlay), the drafts, scripts and details typed in that section are cleared and Treatable asks you to reopen it; Settings → Your details stay until you clear them or the Treatable session ends.

## How Treatable uses OpenAI

Two features contact OpenAI, both through a small local native helper on your Mac: **AI-matched results** on results pages makes one Decisions call per ranked page (see [Decisions ranking](#decisions-ranking-ai-matched-results)), and **Generate study brief** makes two calls, in this order:

| Step | OpenAI API | Model | Job |
|---|---|---|---|
| 1 | Agents API | `gpt-6-astra` | Read the selected studies' record excerpts through one restricted tool. Choose which excerpts to quote and which standard questions, pre-screening topics and warnings apply. |
| 2 | Decisions API | `gpt-6-luna` | For every selected question, decide whether the record answers it, the patient must answer it, or the study team should be asked. |

You use your own OpenAI API key. The helper keeps it in the macOS Keychain, and requests count against your OpenAI account. The helper also needs your account to have access to both APIs and the models above (see [native setup](native/API_SETUP.md)).

The browser side of the extension cannot choose the OpenAI address, model, prompt or tools, and it cannot add text. For a brief it sends the helper only one or two public NCT IDs and, later, a one-use receipt. When you press the button, the helper downloads the official records from ClinicalTrials.gov itself, builds the exact OpenAI requests, pins them, and runs only those pinned requests when the extension returns a one-use receipt. It validates every reply before the extension shows anything.

For a brief, only **public study IDs and public record text** are sent to OpenAI. Record text is cleaned of invisible and control characters and labelled in the requests as untrusted third-party text whose instructions must be ignored. That reduces, but cannot eliminate, the chance that text in a record influences a model, which is why the outputs below are tightly restricted. Your name, contact details, ZIP code, typed answers, notes and drafts are never part of any request: the messages from the overlay to the helper accept only NCT IDs and one-use receipts. Automated tests also plant recognizable fake values in the details fields (name, reason for reaching out and notes) and check that they appear in your local drafts but in no message to the helper, no OpenAI request and no log.

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

**If it fails.** Every question is shown as **Ask the study team** and the first three of the Agent's questions are used. The status line reads "Question sorting unavailable" and shows the reason for the failure.

### Decisions ranking (AI-matched results)

**What it does.** On a ClinicalTrials.gov results page with up to 10 visible cards, Treatable sorts the cards so the studies most worth contacting come first. Each card gets a small match-percentage ring in its upper-right corner; hovering or focusing it shows a short reason such as "Strong match for your condition", "Possible match", "Not recruiting" or "Outside the listed age range". The ranking runs by itself after the intro tour, again when the page's cards or your details change, and is switched off with the **AI-matched results** switch under the overlay header (the choice is remembered on this device). Off means the website keeps its own order and no rings are shown.

**Two parts.**
- *Record checks, on your device.* From the public records, which the extension fetches from ClinicalTrials.gov itself, Treatable checks the recruiting status, the listed age range against your age band and the listed sex. A study that clearly does not fit moves to the end with that reason and a low percentage (10% at most). Missing data is unknown, never a mismatch, and nothing is hidden unless you choose a website filter yourself.
- *Relevance, from Decisions.* For everything else, the order follows a 0-100 relevance score from the OpenAI Decisions API.

**What is sent.** One `POST https://api.openai.com/v1/decisions` request using model `gpt-6-luna` with one score question per visible study ("rate only the topical relevance of this public record to the profile's condition terms", four levels: Unrelated, Unclear, Related, Strongly related). The profile holds only condition terms: the condition you searched for on ClinicalTrials.gov and, if you filled in a condition under Settings → Your details, short terms taken from it (at most six terms in all). Your age band and sex, if entered, are used only on your device for the record checks. Terms with a standalone number or an age-and-sex token ("45 female", "52M"), a date, three or more digits in a row, an age phrase, a titled name ("Dr Smith"), sentence, family or care-place words, or any word of your name are dropped; numbers inside a condition name ("COVID-19", "Type 2 diabetes") are kept. These filters are rules, not understanding, so the terms that will be used are shown under the condition field and again in the confirmation. Your name, age band, exact age, sex, ZIP code, location, contact details, notes and drafts are never sent. With the profile go the public records of the visible studies, fetched and cleaned by the helper itself and labelled as untrusted text. The helper validates the profile again, pins the exact request behind a one-use receipt that expires after five minutes, and sends only that pinned request.

**Your confirmation.** The first OpenAI ranking in a browser session opens a separate Treatable window with the privacy notice, a summary of what this ranking sends, the exact request behind **See what is sent**, and one choice: **Allow for this browser session** or **Not now**. Nothing is scored before you allow it. After that, results pages are ranked automatically, each with its own pinned request, until you close the browser or switch AI-matched results off (which also forgets the confirmation). The record of your choice is one fixed marker, `treatable.rankingConsent`, in `chrome.storage.session`, which Chrome keeps in memory and clears when the browser closes. **Not now** keeps the record checks and does not ask again on that tab until you press **Review and allow AI ranking**.

**What comes back.** For each study, a score from 0 to 3 with a probability for each of the four levels. The helper requires exactly one answer per study, the four known levels, probabilities between 0 and 1 that add up to 1 and agree with the score; anything else discards the whole answer. The score becomes a 0-100 percentage and a short reason (75 and up: strong match; 50 and up: possible match; 25 and up: relevance unclear; below: not about your condition).

**What the percentages mean.** Match percentages show how relevant a study looks to your search and details. They are not a medical opinion and do not decide eligibility; only the study team can. This statement appears once, in the notice shown before the first ranking, rather than on every card.

**If it fails.** If the helper is missing or older than the extension, the key is missing or rejected, a rate limit is reached, or the Decisions answer fails validation, the record checks still order the page: studies that clearly do not fit move to the end and the rest keep the website's order. The overlay says what failed, with the failure code, and offers **Try AI ranking again**. **Restore original order** puts the website's order back at any time. The ranked order (study IDs, percentages and reason ids only) stays in extension memory for the Treatable session, up to 30 minutes, so the page can be re-ranked without a new request; hiding the tab puts the website's order back until you apply the ranking again.

**How this was ranked.** Under the ranking, this section shows whether the result is a live OpenAI result or a test run, what was sent for scoring, a display copy of the exact Decisions request body, and each study's score with the probability of each level. Headers, credentials and receipts are never shown.

**Local model.** The helper operation is provider-neutral: condition terms plus public records in, one 0-100 score and a short reason per study out. When Settings → Model provider is set to the local model, the installed Ollama model on your Mac scores each study instead of Decisions, nothing leaves the device, and no confirmation is needed. A local model gives no level probabilities, and a study it cannot score stays unscored. Its reasons come from its own fixed list (for example "About your condition" or "Mainly a different condition").

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
- Your search filters and location. These go to ClinicalTrials.gov, as on its own website, and may appear in your browser history. They are not sent to OpenAI. The condition you searched for is the exception: AI-matched results sends it as a condition term, after your confirmation.

Opening or copying an email moves its text out of the extension, into your mail program or clipboard. That is your choice, and Treatable has not sent anything.

### Retention and deletion

The Agents API keeps session state until the session is deleted, and Agents sessions are not eligible for zero data retention. Treatable requests deletion and shows whether OpenAI acknowledged it. It makes no promise of instant or complete physical erasure, and a failed or unconfirmed deletion is shown as such. According to OpenAI's [data controls guide](https://developers.openai.com/api/docs/guides/your-data), default abuse monitoring may retain content for up to 30 days, subject to exceptions, and API data is not used for training by default. Check that guide for current terms, because they are OpenAI's and can change. Only public study data is in these requests, but closing the overlay cannot retract data already sent. See the [privacy policy](https://kurtlehnardt.github.io/treatable/privacy.html) for the project's own practices.

### Older paths kept in the repository

The earlier profile-based matching form (**Find my matches**, with its own age band, state and condition-label form, agent questions and distance filter) is not shown in the toolbar overlay; AI-matched results replaced it on results pages. Its code, helper operations and tests remain in the repository. The retained legacy panel (`panel.html`, built in every folder below) holds local screening against a bundled snapshot of 2,000 ClinicalTrials.gov studies, fictional API examples (a built-in fictional profile and two fixed public studies) and an optional analysis of up to two snapshot studies. The toolbar button does not open it, and native Chrome side panels stay disabled. Its entry address is `chrome-extension://lmgmjeabbalehlcakdbolielnfgchojf/panel.html`; actual Chrome access to it has not been verified. The legacy panel's own notice describes what its optional analysis sends.

## Local model option (Ollama on this device)

OpenAI is the default and stays the default. In Settings → **Study brief model**, you can switch **Model provider** to **Local model (Ollama on this device)**. Generate study brief then runs on your own computer through [Ollama](https://ollama.com/download), and nothing is sent to OpenAI: no API key is read and no OpenAI request is made.

- **Privacy.** The local model gets the same public study excerpts and question topics the OpenAI steps get, and nothing else. Your name, contact details, typed answers and drafts are never part of it. Nothing leaves the device.
- **Quality and speed depend on your machine and model.** A local model is smaller than the OpenAI models, so its excerpt choices and question routes can be weaker, and a brief can take from about half a minute to a few minutes. If a step is too slow (step 1 stops after 150 seconds, step 2 after 75, and both must finish within the study session) or its output fails validation, the brief falls back to the same defaults as the OpenAI path and says why. With less than a minute of the session left, Treatable asks you to reopen it before starting a local brief.
- **Choosing a model.** Settings checks this device (memory, processor, Apple Silicon unified memory, free disk) and lists the installed models that can write text, with one marked **Recommended**: the model that fits comfortably in memory (at most about half of it for the model and its working memory, never more than 60%) and is good at structured output. If no installed model fits, Settings suggests one and shows the exact `ollama pull` command to run in Terminal. Treatable never downloads a model. If Ollama is not installed, Settings links to <https://ollama.com/download>.
- **The same checks as OpenAI.** Step 1 (the local equivalent of the Agents step) asks for the same JSON, using Ollama structured outputs: exact-quote claims and IDs from the fixed question, pre-screening and warning lists. The same validators check it. Step 2 (the local equivalent of Decisions) routes each question with the same downgrade and top-three rules. If the model reports a confidence for a route, it is shown and labelled model-reported, not calibrated; Treatable never turns it into a probability.
- **How it runs.** The helper starts its own private `ollama serve` on a random `127.0.0.1` port with cloud features disabled, a minimal environment and an empty private home folder, and reads the models already in `~/.ollama/models`. It never connects to the Ollama app or daemon you may already be running, opens no listener reachable from the network, and stops the runtime, including any model runner it started, when it is idle or when the helper exits. Each open Treatable study session has its own runtime, so generating in two tabs at once loads the model twice. **How this was generated** names the model and shows each local request body and output.

Setup: install Ollama, pull a model (for example `ollama pull qwen3.5:9b`), then reinstall the native helper with the command under Build and install so it has the local model code.

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

The installer pins the Node executable used to run it. Use a functioning runtime; rerun the installer after moving or replacing that runtime. Credential setup prompts with terminal echo disabled and saves only the dedicated macOS Keychain item. Never put the key in Chrome, arguments, environment variables, configuration files, chat or logs. `status` checks metadata; it does not verify account authorization. If you configured a key with an earlier version, reinstall the native helper and run `node extension/native/credentials-setup.mjs migrate` once: the Keychain item was renamed, and macOS may ask once to allow access while the key moves. See [native setup and runtime recovery](native/API_SETUP.md).

## Search the website

1. Open `https://clinicaltrials.gov` or `https://www.clinicaltrials.gov` and click Treatable in Chrome's toolbar. Other hosts and HTTP pages are unsupported; there is no globally enabled Treatable side panel.
2. Enter condition/disease, other terms, intervention/treatment or location. More filters starts collapsed and contains all 28 logical fields: status, eligibility and age ranges, phase/type, results/documents, funder, six date ranges and additional search fields.
3. Search navigates to the registry's own results URL. Search terms and website filters go to ClinicalTrials.gov and may appear in browser history. The search itself makes **no OpenAI request**; on the results page, AI-matched results may then rank the cards as described under [Decisions ranking](#decisions-ranking-ai-matched-results).
4. The overlay reopens compact after the search. Expand it to choose up to two studies from the results, or open a study page, and use Understand this study. Treatable opens in the **Popup** display by default: a centered window, with the page behind it inert until the window is collapsed. Clicking the page outside the popup closes it at once when there is nothing to lose. When details or drafts have been typed (the same work the Close button asks about; text in the search boxes alone does not count), the same click only hides the popup, without asking and without clearing anything, and the toolbar button shows it again exactly as it was (if its 30-minute session ran out in the meantime, the toolbar button opens a fresh one instead). The Close button and Escape still ask before clearing typed work. The top-right settings gear offers Popup or in-page **Sidebar**, plus System, Light or Dark themes. The Sidebar docks along the right edge and the page narrows to make room for it, so nothing of the website sits underneath; fixed website controls on the right edge, such as Back to top, move left of the Sidebar, and the page gets its full width back when the Sidebar is collapsed, switched or closed. Clicking the page does not close the Sidebar. The corner card display of earlier versions was removed; a saved choice of it opens as the Popup. A saved choice always wins over the default; native Chrome side panels stay disabled.

US ZIP codes in the search form resolve from approximate offline postal centers, with a default 50-mile distance. Editing location text discards prior coordinates. Other addresses, cities, states or countries require the website's own location controls; collapse/close Treatable to use them, then reopen it on the resulting search. Treatable refuses an unresolved location rather than pretending the filter was applied. Table/map views and unknown card layouts remain read-only.

The accepting-only filter defaults to recruiting and available expanded-access studies; optional checkboxes include opening soon or invitation-only studies. Fresh public status also filters already loaded cards. Unknown or unavailable status stays visible and labeled unverified. Turn accepting-only off to use other study-status selections; this does not load studies absent from the current website results.

## Guided walkthroughs

Both walkthroughs use [SweetAlert2](https://sweetalert2.github.io/) 11.26.25, bundled into the extension (no CDN, no remote code). Its dialogs are mounted in the extension's own shadow root and carry their own stylesheet, so ClinicalTrials.gov styles do not reach them and theirs do not reach the site. A guide only highlights: it never ticks, types into, submits or clicks anything for you, and it removes its highlight and dialog when it ends or is skipped.

- **Show me how to search** (Treatable panel, search pages only) walks through two website filters. It collapses the panel, highlights **Recruiting** under Study Status and waits for you to tick it, then does the same for **Interventional** under Study Type, explaining that interventional studies test a treatment and observational studies do not assign one. Ticking only stages the filters on ClinicalTrials.gov, so once both are ticked it highlights the site's own **Apply Filters** button and waits for you to press it. If the filters are hidden (the Hide/Show panel on a wide screen, or the Focus Your Search drawer on a narrow one) it highlights the button that opens them. If a box cannot be found it shows plain instructions instead.
- **Intro tour** starts by itself the first time Treatable is opened, and **Replay intro** (panel footer) runs it again. Steps: welcome, how to change the look of Treatable (Popup, Sidebar, theme), the AI-matched results switch (on by default; it reorders results with a match percentage, and you can switch it off to keep the website's order), starting on ClinicalTrials.gov search, where to type your condition and location, optional filter help (the walkthrough above), opening a study, then Treatable's study tools: Understand this study, Generate study brief, Personalize your email, the editable draft, and Copy full email / Open draft in my email app. The tour only highlights these controls. It never presses Generate study brief, and Treatable never sends the email; you do.

The tour keeps two values, nothing else, and never anything you type, any search term or any study ID: `treatable.onboardingVersion` (the number 2, in extension-local storage, set when the tour is finished or skipped; the AI-matched results step raised it from 1, so the tour shows once more after this update) and `treatable.onboardingStep` (a bare step number in session storage, so the tour can resume after the page navigates; removed when the tour ends). All access lives in `src/guide-state.ts`, uses the existing `storage` permission, and the deletion-only legacy patient-data cleanup removes only its own key. No network request, new permission or host change is involved. sweetalert2 releases after 11.4.9 on some lines shipped locale- and domain-gated "protestware"; the pinned 11.26.25 has none, and a test fails if a vendor update adds any.

## Privacy and session lifetime

Generating a brief sends OpenAI public study data only (see [How Treatable uses OpenAI](#how-treatable-uses-openai)). AI-matched results sends the minimized ranking profile described under [Decisions ranking](#decisions-ranking-ai-matched-results), and only after your confirmation for the browser session. The study and search session of the overlay lasts 30 minutes and slides forward whenever you type or click in the overlay. To avoid flooding the extension, a renewal message goes to its background worker at most once every 20 seconds. In the last five minutes the study section shows a small countdown, and in the last minute it also shows a **Keep working** button, announced through the section's status line, that renews the session for another 30 minutes. If you have not typed or clicked for 30 minutes, the session expires.

Switching to another tab or hiding the window does not end the session. The overlay keeps checking the page while hidden so the background worker stays connected, and the 30-minute deadline keeps running, so a tab left hidden still ends at its deadline. Chrome can throttle a hidden tab or stop the background worker; if the connection is lost, the session ends and clears like any other ended session. Closing or reloading the page (Chrome's `pagehide`), pressing **Close** and pressing **End and clear my details** end the session at once. Moving to a different study ends the study section's session and clears its drafts; the new study starts a fresh session, and drafts are not carried from one study to another. When the session ends or expires, Treatable clears the drafts, call scripts, follow-up messages and details typed there and asks you to reopen it. A popup hidden by a click outside it is still open: what you typed stays in the memory of Treatable's hidden extension frame until you reopen it from the toolbar and close it, the page is closed, reloaded or left, or the session deadline passes. The website cannot read that frame, because it belongs to the extension's own origin. The session deadline, countdown and renewals live only in memory: nothing about them is written to extension storage, web storage or IndexedDB.

Prepared OpenAI requests are separate. They keep their own five-minute, one-use receipts, and a longer session does not extend them.

Settings → **Your details** holds an optional name, a description of the illness, condition, symptoms or reason for seeking treatment, an "anything else" note, and an optional age band and sex. The text values fill the patient's own local email draft, call script and follow-up message, which stay editable. When AI-matched results is on, the age band and sex feed the record checks on this device only, and short condition terms derived from the condition text (shown under the field) go into the ranking profile, after the browser-session confirmation when OpenAI ranks. The name and the "anything else" note are never used for ranking. All of these live in the overlay frame's memory, are never written to extension storage, web storage, IndexedDB, files or cookies, and are never sent to ClinicalTrials.gov, traces or logs; apart from the ranking profile, only the patient-started mailto handoff or copy carries them out. Clear my details, End and clear my details, closing Treatable and any ended session wipe them. The call script and follow-up list each phone contact from the official record with a **Call** (`tel:`) link and **Copy number**; links are built only from structured contact fields as E.164 numbers with an optional `;ext=`, and numbers that do not check out show as text without buttons.

There is no Save/Remember control or patient-history feature. The `storage` permission removes known legacy patient keys from extension local/session storage without reading their contents or writing a migration flag. The only value it writes is one non-health preference record, `treatable.uiPrefs` in `chrome.storage.local`, holding the display mode (`popup` or `sidebar`; a saved `overlay` from an earlier version reads as `popup`), the theme (`system`, `light` or `dark`), the model provider (`openai` or `local`), the chosen local model name (an Ollama model name such as `qwen3.5:9b`, or none) and AI-matched results (`on` or `off`), and nothing else. The intro tour adds exactly two more non-health values, described under Guided walkthroughs: a done flag and a step number. AI-matched results adds one fixed marker in `chrome.storage.session` once you allow it for the browser session. Ending the session clears patient data but keeps these display preferences.

The stdio-only native helper has no HTTP listener of its own. Only when you choose the Local model does it start a private Ollama runtime on a random `127.0.0.1` port for its own requests, and it stops that runtime when it exits. Credentials stay in the dedicated Keychain item and transient native memory. Browser OpenAI requests, arbitrary model/tool/URL proxies, cookies and telemetry are absent. The helper talks only to `api.openai.com` and `clinicaltrials.gov` over TLS with certificate verification and no redirects, plus its own loopback Ollama runtime when you choose the Local model. Model output is bounded to validated IDs, exact record excerpts and built-in templates; this reduces authority but cannot promise that untrusted text never influences a permitted choice.

Application clearing is not forensic memory erasure. A compromised browser/OS, same-user malware, administrator access, swap/crash data and arbitrary debugging remain outside these guarantees. No anonymity, HIPAA certification or legal sufficiency is claimed. See [HHS de-identification guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html) and the project's [privacy policy](https://kurtlehnardt.github.io/treatable/privacy.html). The operator is **Kurt Lehnardt - Developer of Treatable**, **privacy.6vpc5@mailer.me**.

## Testing and known limits

Run the commands under Build and install. The automated tests cover the request and reply contracts, validation of Agent claims and Decisions answers, the study-brief pipeline against a scripted fake OpenAI service (both in-process and through the installed helper over stdio), Agents session cleanup, canary checks that typed personal details never reach the helper or an OpenAI request, the email, call script and follow-up drafts, and the overlay in simulated pages. These tests use fake OpenAI transports; they are not live acceptance of the OpenAI APIs.

These still need manual verification on your machine: how the overlay mounts and is placed on the live ClinicalTrials.gov site, keyboard use, the Chrome-to-helper connection, whether your account can use both OpenAI APIs and models, and deletion of Agents sessions, which can fail or stay unconfirmed. ClinicalTrials.gov records and recruitment change, so check the official record before you act. `BUILD_REPORT.md`, `SECURITY_REVIEW.md` and `VERSION_B_REVIEW.md` apply to the builds and commits they name, and are not runtime verification of the current flow.

Recruitment-query encoding: the current official [filter definitions](https://clinicaltrials.gov/chunk-N3WLMKWZ.js) map `rec` to Recruiting and `ava` to Available in the expanded-access group; their native `not rec` preset uses space-separated statuses. The official [query serializer](https://clinicaltrials.gov/chunk-N5W3TRDQ.js) writes sorted `key:value` entries into `aggFilters`. This verifies encoding, while actual browser filter-chip behavior remains a separate check.

[Native setup](native/API_SETUP.md) · [Security review](SECURITY_REVIEW.md) · [Version B design evidence](VERSION_B_REVIEW.md) · [Privacy policy](https://kurtlehnardt.github.io/treatable/privacy.html)

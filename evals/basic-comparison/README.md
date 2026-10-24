# Basic versus OpenAI: bounded exploratory comparison

**No measured ranking advantage on the two strictly input-matched profiles. This is an evidence-overlap proxy, not clinical-quality, clinical-usefulness, eligibility, or AI-superiority evidence.** No human clinical gold labels were available, and no model judged the results.

The initial test set, deterministic labels, metrics, and public-record hashes were committed in **4a31b36** before any ranker output or authenticated request. The independently built Basic algorithm was frozen at **8be03247d708852c64e280320379e7c151904f84**, `basic-keyword-v1`, before its outputs were examined. Its implementation worker did not receive benchmark outcomes before that freeze. This evaluation changed no product code.

## Results

Metrics use exact case-insensitive overlap between selected public condition labels and structured study conditions. This intentionally narrow lexical proxy favors literal matching, does not credit related terms, and cannot establish medical relevance. Each list applies the same deterministic structured guard tier before descending score, with NCT ID as the predeclared tie-breaker. The latter is an evaluation tie-breaker; the product Basic ranker preserves page order for ties.

| Invented profile | Strict input parity | Basic P@5 / R@5 / RR | OpenAI P@5 / R@5 / RR | Basic compute ms | OpenAI native score ms |
| --- | --- | --- | --- | --- | --- |
| Fibromyalgia, 30–44, female | **No: OpenAI additionally received state ID** | 0.20 / 0.50 / 1.00 | 0.20 / 0.50 / 1.00 | 2.38 | 948.95 |
| Migraine, 30–44 | Yes | 0.20 / 1.00 / 0.50 | 0.20 / 1.00 / 0.50 | 0.97 | 245.42 |
| Diabetes, 60–74, male | Yes | 0.20 / 1.00 / 1.00 | 0.20 / 1.00 / 1.00 | 0.57 | 264.55 |

Exclude the Fibromyalgia row from strict paired claims: the original predeclared profile included an allowed optional state, but the frozen Basic API rejects that field. The mismatch was identified before Basic execution; the saved cloud request was not changed or rerun. Thus only **two** of the three profiles meet strict field parity. Both rankers otherwise saw the same frozen six public records and the same allowed age/sex/condition information.

P@5 is labeled hits divided by five; recall is labeled hits divided by all labeled positives; RR is inverse rank of the first positive. There are only 1–2 positive labels per profile. Exact overlap does not label “Episodic Migraine” positive for the selected “Migraine” label, despite its evident topical relationship; this illustrates why these numbers are not clinical usefulness. Shared safety tiers can also place a topically matched study below structurally compatible studies.

Times are single observations, with different work boundaries: Basic compute on already-loaded data versus native authenticated scoring, including Keychain/provider overhead but excluding catalog fetch and preparation. Warmup, caches, network conditions and repeated-run variance were not controlled. **Actual OpenAI cost is unavailable** because the production native result omits usage and invoice information. No cost estimate was invented.

## Synthetic checks, separate from public ranking

- **22/23 evaluated assertions passed.** The single failure is the predeclared synonym recall probe: “heart attack” does not text-match “myocardial infarction.” Basic is English keyword matching with limited one-character typo tolerance, not semantic matching.
- Known age and sex conflicts were identified. The one-character typo probe passed. Missing age/sex and missing-distance checks preserved unknowns (**3/3**).
- **0 false exclusions** across the four predeclared no-exclusion probes; **0 positive eligibility buckets** across eight synthetic rows. This checks structured result fields only, not clinical false-eligibility rates or rendered UI language. OpenAI returns scores only; its schema cannot independently assert eligibility, and the same deterministic guard rows were reused.
- **One original site assertion is invalid, not a product pass or failure:** the frozen nearby-terminated fixture omitted country. The US distance helper intentionally will not choose an unknown-country location. Its other assertion, no eligibility claim, remains evaluated.
- A separate US-country correction was declared in `supplemental-site-predeclared.json`, committed in **11089a8 before any Basic or site-helper execution**. That supplemental probe passed: the farther recruiting facility was selected instead of the nearby terminated facility. It is not counted in the 22/23 original assertions.
- Frozen public NCT07254806 independently contains **31 facilities, 31 coordinate pairs, 30 recruiting and 1 terminated**. This is a record observation, not proof of current recruitment or an entire Chrome workflow.

## Evidence and privacy boundary

Six exact-NCT public records were fetched through the existing Gov transport: NCT07254806, NCT06567886, NCT05067998, NCT06229834, NCT06473597 and NCT02846571. Their raw records, `fetchedAt`, normalized projection and SHA-256 hashes are in `public-records.json`; the full artifact SHA is `fa07934ef9979953a67a8e33fb8f51b2e796523809ad244323206a09a53d554b`. The native catalog fetched on 2026-10-24 matched every frozen normalized field except the expected new fetch timestamp before scoring. Public network requests contained NCT IDs only, no condition queries, ZIP or origin.

Basic used precisely the native normalized title/conditions/summary/criteria and structured facts that OpenAI received. These include the production 180-byte title, 600-byte summary and 1600-byte criteria limits plus truncation/missing-field flags; neither ranking received longer raw descriptions or omitted interventions. Basic ignores countries and some metadata that remain in the standard OpenAI public-study projection. Raw public locations were used only for local site checks. This evaluates the frozen native projection, not every field the browser's Basic fetch could expose.

The three API profiles are invented, not patient data. Only age band, optional sex/state, and selected public condition labels were sent. No symptoms, history, medications, notes, exact age, ZIP or local coordinates were transmitted. The unmodified production protocol labels its live packet `fictional:false` and its instructions say REAL; those fixed metadata do not describe the actual invented provenance of these evaluation values.

There were **3 authenticated Decisions requests completed, 6 studies each, 0 Agents calls and 0 retries**, using the existing installed native host, dedicated Keychain credential, policy receipt, exact previews, digest-bound one-use receipts and validated source/result bindings. No credential values, opaque consent tokens, raw provider responses, headers or provider error bodies were saved. `fictional-*-request.json` are the exact safe outbound preview bodies containing public records and the invented minimized profiles; `live-results.json` contains only sanitized structured scores, timings and counters. The result protocol exposes neither actual usage nor a model revision beyond the requested `gpt-6-luna` name.

The [official Decisions API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create) was consulted for the existing scoring contract. No SDK, prompt, model, native code, credential configuration or provider endpoint was changed.

## Offline reproduction

After the Basic implementation and evaluation commits are present, with the repository's existing extension/scaffold dependencies available:

```sh
node evals/basic-comparison/verify.mjs
node extension/node_modules/tsx/dist/cli.mjs evals/basic-comparison/analyze.mts
```

The analysis only reads frozen records and saved OpenAI scores; it makes **no network requests** and accesses no credentials. It verifies the Basic source against the frozen commit and writes ignored `replay-results.json`, preserving the originally observed `results.json`. Basic compute times may differ on replay. For the isolated worktrees used here, the run set `BASIC_MODULE` to the frozen implementation worktree's `extension/src/basic-matching.ts`; this only selects local source, not an alternate model or provider.

`run-live.mjs` is a separate, explicit live-only provenance runner. Do not run it for offline reproduction. It refuses to overwrite the existing live run and requires `--execute-authorized`; rerunning authenticated requests requires renewed explicit authorization and a new evaluation declaration. `freeze.mjs` documents initial NCT-only collection; do not rerun it over these frozen artifacts.

This small purposive cohort, two strict pairs, one execution per profile, synthetic safety cases and lexical proxy do **not** prove general ranking quality, clinical appropriateness, AI superiority, Chrome installation, page interaction, network absence in the rendered Basic workflow, or UI completeness. Browser/product testing is separate.

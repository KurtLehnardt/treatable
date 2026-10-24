> Historical UI-only review at `9e909cb`. This is not approval of the later privacy/API implementation. The current MVP removes saved profiles and adds a fictional OpenAI demo; a new combined security review is required. Original A artifacts are PRE-PRIVACY BASELINE — NOT CURRENT.

# Version B interface review

**Mode:** full. **Scope:** Chrome extension panel B, its shared controller/results extraction, and A/B build delivery. **Framework/style:** existing React 18 + plain CSS + existing Inter/system and Georgia type families. No UI framework, motion dependency, remote font, asset, provider, native-host, screening, or site-access change. Matching/source/storage/native modules are unchanged.

Skill: [make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better/blob/main/skills/make-interfaces-feel-better/SKILL.md), including its typography, surfaces, animations, icons, and performance references.

## Coverage

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | `src/panel-b.css:1`, `src/panel-b-view.tsx:30-48`, SSR markup; existing font stack retained, smoothing/wrapping and updating numeric styles declared | Source reviewed; actual rendering **Not verified** |
| Surfaces | `src/panel-b.css:1-3`, field/card/nav markup, React profile/result/saved states | Larger controls, nested radii and focus borders declared; pixel geometry/hover appearance **Not verified** |
| Animations | Explicit CSS transitions, press feedback only on primary action, reduced-motion rules | Source reviewed; 10%-speed replay and interrupted visual states **Not verified** |
| Icons | `src/panel-b-view.tsx:8-18`; single decorative currentColor SVG set with consistent stroke | Source reviewed; optical alignment **Not verified** |
| Performance | No animation library, list staggering, broad transition, remote font or speculative will-change; A/B worker/data hash parity | Build and source reviewed; browser frame profiling **Not verified** |

## Addressed findings and changes

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `src/panel-b-view.tsx:32-46` | Profile, model setup and results shared a long dense screen | Distinct Profile / Search / Saved sections with static selected state | Clear hierarchy reduces scanning while keeping the same actions and facts |
| MEDIUM | `src/panel-b-view.tsx:34-40`, `src/panel-b.css:1-3` | Small controls and compressed optional fields | Labelled, roomier fields and control target declarations; optional/storage choices stay explicit | Hit area and form hierarchy make the primary path easier to operate |
| MEDIUM | `src/panel-b-view.tsx:28-31` | Local-model status lived below intake | Persistent truthful unchecked/checking/available/setup/reading status | Routing privacy and actual model availability remain distinct |
| MEDIUM | `src/panel-b-view.tsx:31`, `tests/version-b.test.ts` | B navigation could hide Stop while generation continued | Global Stop remains reachable after section changes, preserving result IDs and discarding late output | Interaction must remain interruptible; React behavior regression passes |
| MEDIUM | `src/panel-b-view.tsx:25,33-34`, `tests/version-b.test.ts` | Invalid profile errors from Search left the relevant fields in another section | Error includes Edit profile, returning to and focusing its heading | Clear recovery path for both local-search and current-page validation |
| LOW | `src/panel-b.css:1-3`, `src/panel-results.tsx` | Dense divided result list | Roomier card treatment, readable titles/facts, structural separators and preserved source/unknown/contact details | Surfaces and spacing improve scanability without changing clinical claims |
| LOW | `src/panel-b.css:1-3` | No root smoothing, balanced headings or numeric stabilization | Existing fonts with smoothing, short-heading wrapping and tabular updating counts/distances | Typography rendering and stable counts |
| LOW | `src/panel-b-view.tsx:8-18`, `src/panel-b.css:1-3` | Limited text-symbol feedback | Consistent currentColor SVG navigation/status icons and named CSS transitions | Consistent icon weight/state, restrained interruptible feedback |
| LOW | `scripts/build.mjs:6-21`, `src/use-panel-controller.ts:7-24`, `src/panel.tsx:8-22` | One presentation/build; state embedded in A | Explicit shared state/results, original A view/CSS, separate B build/package and baseline A ZIP | Compare presentations while preserving one behavioral implementation and native identity |

## Considered but rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| `scripts/build.mjs` | Extract A controller with a build-time virtual module/source rewrite | Brittle compiler logic for a presentation change; explicit shared hook is easier to verify |
| Results list | Stagger card entrances or animate routine navigation | Repeated motion would consume attention during frequent study scanning; results stay static |
| Manifest/native host | Give B a different extension ID for simultaneous installation | Would change native-host allowlisting and expand the security scope; same-ID one-at-a-time comparison retained |

## Verification

- `npm run typecheck`: pass.
- `npm test`: 26 extension tests pass; includes the original 20 plus A/B manifest/identity/worker/data parity, actual React hook search/save/remember/clear, late generation/page cancellation, truthful SSR/status, global Stop across navigation, and validation recovery/focus-ref behavior.
- `npm run build:all` (also pretest): A and B pass; each ships the same 2,000 real records and ZIP data.
- `node --test native/test/*.test.mjs` with loopback access: 9 pass. Initial sandbox-only run could not complete one loopback transport fixture; the correctly permitted run passed unchanged code.
- Original A ZIP SHA-256: `69b2173ccb2d68f4ec403303e5b3e4fd2f349fcb13465b86940010d1fd4b4041` (5,017,659 bytes).
- B ZIP SHA-256: `fddab202eb4104f14be1657b786e7ffce6d28a211b2c346a775f202e9ac1b500` (4,962,256 bytes).
- React render tests verify static state/handler behavior and ref focus invocation. They do not verify CSS pixels or browser focus/keyboard behavior.
- Actual Chrome install, A/B switch, native handshake, rendered empty/loading/hover/focus/active geometry and 10%-speed motion: **Not verified**. Available browser controls could not attach; no substitute browser automation was used.

**Verdict: Approve for source/state-test scope; visual/browser checks above remain Not verified.** Independent review is recorded separately by the orchestrator. No claim of visually verified polish or clinical validation is made.

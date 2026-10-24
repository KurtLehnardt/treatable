# Module reuse inventory

One row per tracked module/test in scaffold/lib, components, app, and scripts. KEEP preserves implementation where feasible; associated domain contract changes may require typed adapters. DELETE removes funding-specific modules and their tests. DEFER is outside active app scope.

| Module | Decision | Reason |
|---|---|---|
| `scaffold/app/__tests__/previewReducer.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/app/uninstall/__tests__/handler.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/app/uninstall/handler.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/app/uninstall/route.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/app/update/__tests__/handler.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/app/update/handler.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/app/update/route.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/competitors/route.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/app/api/corpus/__tests__/route.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/corpus/handler.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/corpus/refresh/__tests__/handler.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/corpus/refresh/handler.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/corpus/refresh/route.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/corpus/refresh/stop/__tests__/handler.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/corpus/refresh/stop/handler.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/corpus/refresh/stop/route.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/corpus/route.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/interview/__tests__/route.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/interview/route.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/llm/__tests__/route.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/config/__tests__/handler.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/config/handler.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/config/route.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/embeddings/__tests__/handler.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/embeddings/handler.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/embeddings/route.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/models/__tests__/handler.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/models/handler.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/models/route.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/ollama/__tests__/handler.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/ollama/handler.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/ollama/route.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/route.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/test-key/__tests__/handler.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/test-key/handler.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/llm/test-key/route.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/app/api/logs/__tests__/handler.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/logs/handler.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/logs/route.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/match/__tests__/cached.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/match/__tests__/errorLog.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/match/__tests__/localModel.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/match/__tests__/route.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/match/handler.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/match/route.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/api/readiness-lead/__tests__/route.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/app/api/readiness-lead/route.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/app/apple-icon.png` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/error.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/global-error.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/globals.css` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/icon.png` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/layout.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/login/page.tsx` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/app/page.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/readiness/page.tsx` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/app/welcome/WelcomeNav.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/welcome/__tests__/welcome.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/welcome/content.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/app/welcome/page.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/AgencyMap.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/AnalyticsProvider.tsx` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/AppAutoUpdate.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/AppMenu.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/AppSidebar.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/AppUpdateSection.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/ApplicationChecklist.tsx` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/AuthProvider.tsx` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/CompetitorAnalysisModal.tsx` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/CompetitorResults.tsx` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/CorpusAutoUpdate.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/CrashNotice.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/DescriptionStrength.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/EligibilityBuckets.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/ErrorReporter.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/FundingStrategy.tsx` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/HowToApplyModal.tsx` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/IntakeForm.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/LocalModelPanel.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/LocalSearchStatus.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/ModelSection.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/OperationModeSection.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/OpportunityAlerts.tsx` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/OpportunityCard.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/OpportunityFilters.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/OpportunityGraph.tsx` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/OpportunityGroups.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/OpportunityMap.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/PreSearchInterview.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/ProblemsSection.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/ProfileQuestionnaire.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/ReportProblemLink.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/ScrollFadeContainer.tsx` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/components/SearchDraftProvider.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/SearchProgress.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/SettingsForm.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/SettingsPanel.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/SidebarProvider.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/SimilarCompanies.tsx` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/StateSourcesSection.tsx` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/UninstallSection.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/UserMenu.tsx` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/WeakerMatches.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/WelcomeGuide.tsx` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/AgencyMap.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/AppUpdateSection.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/ApplicationChecklist.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/__tests__/CompetitorResults.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/__tests__/IntakeForm.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/LocalModelPanel.report.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/LocalSearchStatus.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/ModelSection.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/OperationModeSection.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/OpportunityAlerts.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/__tests__/OpportunityFilters.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/OpportunityMap.filters.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/OpportunityMap.searchNotice.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/OpportunityMap.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/ProblemsSection.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/ProfileQuestionnaire.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/ProvisionalCard.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/ScrollFadeContainer.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/components/__tests__/SettingsForm.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/StateSourcesSection.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/components/__tests__/UninstallSection.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/WeakerMatches.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/__tests__/searchProgress.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/useAppUpdate.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/components/useDialogA11y.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/components/useMediaQuery.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/__tests__/awardsProvenance.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/claude.freeTierBatching.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/claude.serverOwnedFinal.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/claude.skippedBatchLog.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/claude.twoPassHosted.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/claude.twoPassLocal.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/claude.twoPassProgress.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/claude.twoPassRetryCap.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/claude.usageAttribution.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/descriptionStrength.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/embed.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/location.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/match.calibration.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/match.earlyEligibilityFilter.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/match.embeddingTarget.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/match.enrichment.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/match.instantCards.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/match.integration.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/match.keywordFallback.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/match.localBareObject.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/match.progressAndLocalFlag.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/match.provisionalResolution.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/match.quota.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/match.retrievalQuality.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/match.twoPass.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/mockAuth.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/__tests__/noServerRetention.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/providerNotCapturedAtImport.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/recommend.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/__tests__/searchSettings.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/alerts/__tests__/diff.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/alerts/__tests__/profileKey.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/alerts/__tests__/store.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/alerts/diff.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/alerts/profileKey.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/alerts/store.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/alerts/types.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/analytics/__tests__/track.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/analytics/track.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/appUpdate/__tests__/appUpdate.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/appUpdate/install.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/appUpdate/releases.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/brand.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/claude.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/competitors/__tests__/grounding.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/competitors/__tests__/ndjson.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/competitors/__tests__/proposalPrompt.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/competitors/__tests__/tuning.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/competitors/analyze.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/competitors/ndjson.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/competitors/proposalPrompt.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/competitors/retrieve.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/competitors/web.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/contracts/__tests__/analyticsEvent.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/__tests__/companyProfile.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/__tests__/companyProfileMeta.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/__tests__/competitorAnalysis.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/__tests__/contracts.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/__tests__/opportunityMap.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/__tests__/progressEvent.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/analyticsEvent.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/companyProfile.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/competitorAnalysis.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/eligibilityDetermination.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/index.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/modelRouting.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/opportunity.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/opportunityMap.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/primitives.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/contracts/progressEvent.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/__tests__/autoUpdate.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/__tests__/expiry.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/__tests__/loopback.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/__tests__/meta.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/__tests__/pastAwards.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/__tests__/precomputedCache.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/__tests__/refresh.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/__tests__/refreshProgress.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/__tests__/refreshStatus.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/__tests__/selection.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/__tests__/store.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/autoUpdate.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/expiry.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/loopback.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/meta.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/pastAwards.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/refresh.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/refreshProgress.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/refreshStatus.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/selection.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/store.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/corpus/useCorpusAsOf.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/descriptionStrength.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/descriptions/descriptionsStore.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/design/tokens.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/eligibility/CanonOpportunity.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/eligibility/__tests__/bridge.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/eligibility/__tests__/closedSolicitation.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/eligibility/__tests__/freshness.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/eligibility/__tests__/narrativeReconciliation.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/eligibility/__tests__/newTypes.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/eligibility/__tests__/screen.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/eligibility/__tests__/universalRules.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/eligibility/bridge.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/eligibility/freshness.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/eligibility/screen.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/eligibility/universalRules.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/embed.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/embeddings/__tests__/backfill.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/embeddings/__tests__/builtin.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/embeddings/__tests__/builtinModel.integration.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/embeddings/__tests__/legacyCleanup.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/embeddings/__tests__/spaces.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/embeddings/backfill.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/embeddings/builtin.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/embeddings/legacyCleanup.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/embeddings/searchStatus.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/embeddings/spaces.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/__tests__/client.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/__tests__/issueUrl.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/__tests__/psMirror.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/__tests__/sanitize.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/__tests__/server.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/__tests__/store.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/__tests__/withErrorLogging.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/client.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/context.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/errorId.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/issueUrl.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/sanitize-rules.json` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/sanitize.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/server.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/store.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/errorLog/withErrorLogging.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/flags/__tests__/accessor.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/flags/__tests__/registry.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/flags/accessor.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/flags/env.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/flags/index.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/flags/registry.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/fs/__tests__/pidLock.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/fs/atomicFile.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/fs/pidLock.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/grants/grantsStore.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/graph/__tests__/buildOpportunityGraph.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/graph/buildOpportunityGraph.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/interview/__tests__/gapDetection.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/interview/__tests__/generateQuestions.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/interview/__tests__/mergeAnswers.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/interview/generateQuestions.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/interview/mergeAnswers.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/llm/__tests__/baseUrl.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/batchSize.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/client.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/cloudClient.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/cloudModels.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/config.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/keySource.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/localPreflight.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/mockOllama.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/ollamaInfo.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/ollamaJobsErrorLog.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/ollamaModels.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/providers.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/rateLimit.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/searchErrors.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/__tests__/validateCloudConfig.test.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/baseUrl.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/client.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/cloudModels.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/config.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/errors.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/keySource.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/localDefault.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/localPreflight.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/modelContext.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/ollamaInfo.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/ollamaJobs.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/ollamaLocate.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/ollamaModels.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/ollamaStatus.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/providers.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/rateLimit.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/searchErrors.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/types.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/llm/validateCloudConfig.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/localStore.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/location.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/match.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/metering/__tests__/meter.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/metering/__tests__/pricing.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/metering/meter.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/metering/pricing.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/mockAuth.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/opportunities/__tests__/filterSort.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/opportunities/__tests__/group.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/opportunities/__tests__/truncateForPrompt.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/opportunities/filterSort.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/opportunities/group.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/opportunities/truncateForPrompt.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/prompts/hash.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/prompts/index.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/prompts/loader.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/prompts/registry.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/prompts/types.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/readiness/__tests__/score.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/readiness/score.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/recommend.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/redirects/__tests__/utahSbaPrograms.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/redirects/utahSbaPrograms.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/retrieval/__tests__/bm25.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/retrieval/__tests__/enrich.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/retrieval/bm25.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/retrieval/enrich.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/runs/__tests__/runsStore.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/runs/runsStore.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/scoring/__tests__/dbsfScorer.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/scoring/__tests__/twoPass.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/scoring/compositeScore.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/scoring/dbsfScorer.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/scoring/hybridMerge.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/scoring/twoPass.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/searchSettings.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/security/rateLimit.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/security/untrustedInput.ts` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/lib/sidebar/__tests__/sidebarPrefs.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/sidebar/sidebarPrefs.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/similar/__tests__/aggregate.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/similar/aggregate.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/strategy/__tests__/fundingStrategy.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/strategy/fundingStrategy.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/lib/summary.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/testCases.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/types.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/ui/__tests__/opportunitySummary.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/ui/__tests__/welcomeGuidePrefs.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/ui/confirmSwal.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/ui/opportunitySummary.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/ui/previewReducer.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/ui/printElement.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/lib/ui/welcomeGuidePrefs.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/1-fetch-ca-grants.mjs` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/scripts/1-fetch-il-grants.mjs` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/scripts/1-fetch-nc-grants.mjs` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/scripts/1-fetch-sam-assistance.mjs` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/scripts/1-fetch-ut-grants.mjs` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/scripts/1-fetch.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/2-normalize.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/3-embed.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/4-precompute.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/5-competitors.mjs` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/scripts/__tests__/builtinCorpusCoverage.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/__tests__/check-prompt-registry.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/__tests__/corpus-breadth.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/__tests__/embed-target.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/__tests__/scriptsParse.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/__tests__/setupLocal.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/_loadEnvLocal.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/_scrubProviderEnvForTests.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/assemble-mvp-corpus.mjs` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/scripts/banned-phrases.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/check-prompt-registry.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/cost-measure.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/design/check-hex.mjs` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/scripts/design/contrast-check.mjs` | KEEP | Reuse infrastructure; provider exposure narrowed by integration |
| `scaffold/scripts/eval-builtin-space.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/eval-precomputed.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/eval-run.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/fetch-model.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/__tests__/builtinModel.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/__tests__/embedCorpus.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/__tests__/normalizeNewSources.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/scripts/lib/__tests__/refreshScope.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/__tests__/setupKeys.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/__tests__/spaceVectors.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/__tests__/utManualAdditions.test.ts` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/scripts/lib/__tests__/vectorFile.test.ts` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/builtinModel.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/embedCorpus.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/modelTiers.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/normalizeGrants.mjs` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/scripts/lib/normalizeNewSources.mjs` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/scripts/lib/ollamaSetup.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/refreshScope.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/setupKeys.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/spaceVectors.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/spaces.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/lib/utManualAdditions.mjs` | DELETE | Funding-only, accounts, telemetry, or competitor functionality |
| `scaffold/scripts/lib/vectorFile.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/macos/applications-launcher.sh` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/macos/granted-tray.sh` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/macos/menubar/Package.swift` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/macos/menubar/Sources/GrantedMenuBar/main.swift` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/macos/open-granted.sh` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/macos/uninstall.sh` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/macos/update.sh` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/refresh-corpus.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/setup-local.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/setup.mjs` | ADAPT | Clinical-study contracts, copy, routing, privacy, or Treatable paths |
| `scaffold/scripts/windows/granted-tray.ps1` | DEFER | Future operating-system installers |
| `scaffold/scripts/windows/granted.ico` | DEFER | Future operating-system installers |
| `scaffold/scripts/windows/open-granted.ps1` | DEFER | Future operating-system installers |
| `scaffold/scripts/windows/report-problem.ps1` | DEFER | Future operating-system installers |
| `scaffold/scripts/windows/shortcuts.ps1` | DEFER | Future operating-system installers |
| `scaffold/scripts/windows/uninstall.ps1` | DEFER | Future operating-system installers |
| `scaffold/scripts/windows/update.ps1` | DEFER | Future operating-system installers |

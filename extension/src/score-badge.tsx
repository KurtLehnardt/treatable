import './zod-jitless';
import React from'react';import{createRoot}from'react-dom/client';import{captureSiteActivations}from'./overlay-port';import{ScoreBadgeClient}from'./score-badge-client';import{loadUiPrefs,uiPrefsArea}from'./ui-prefs';import'./score-badge.css';
captureSiteActivations(window);const root=createRoot(document.getElementById('root')!);
/* The saved theme loads before the first render so the badge never flashes the default. */
void loadUiPrefs(uiPrefsArea()).then(prefs=>root.render(<ScoreBadgeClient initialTheme={prefs.theme}/>));

import './zod-jitless';
import React from 'react';
import {createRoot} from 'react-dom/client';
import{OverlayAssistant}from'./overlay-app';
import './overlay.css';
import './private-match.css';
import './apply.css';
import {captureSiteActivations} from './overlay-port';
import {loadUiPrefs,uiPrefsArea} from './ui-prefs';
captureSiteActivations(window);
const root=createRoot(document.getElementById('root')!);
/* Saved display preferences load before the first render, so the saved theme and layout never flash the defaults. */
void loadUiPrefs(uiPrefsArea()).then(initialPrefs=>root.render(<OverlayAssistant initialPrefs={initialPrefs}/>));

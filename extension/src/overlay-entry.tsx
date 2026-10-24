import './zod-jitless';
import React from 'react';
import {createRoot} from 'react-dom/client';
import{OverlayAssistant}from'./overlay-app';
import './overlay.css';
import './private-match.css';
import {captureSiteActivations} from './overlay-port';
captureSiteActivations(window);
createRoot(document.getElementById('root')!).render(<OverlayAssistant/>);

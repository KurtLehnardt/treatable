import './zod-jitless';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {OverlayView} from './overlay-view';
import {useSiteController} from './use-site-controller';
import './overlay.css';
import {captureSiteActivations} from './overlay-port';
captureSiteActivations(window);
function Overlay(){const vm=useSiteController();return <OverlayView vm={vm}/>}
createRoot(document.getElementById('root')!).render(<Overlay/>);

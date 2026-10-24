import './zod-jitless';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {usePanelController} from './use-panel-controller';
import {PanelB} from './panel-b-view';
import './panel-b.css';
function AppB(){return <PanelB controller={usePanelController()}/>}
createRoot(document.getElementById('root')!).render(<AppB/>);

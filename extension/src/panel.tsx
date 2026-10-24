import React from 'react';
import {createRoot} from 'react-dom/client';
import {usePanelController} from './use-panel-controller';
import {PanelB} from './panel-b-view';
import './panel-b.css';
import './panel.css';
function App(){return <PanelB variant="a" controller={usePanelController()}/>}
createRoot(document.getElementById('root')!).render(<App/>);

import React from 'react';
import {createRoot} from 'react-dom/client';
import {OverlayView} from './overlay-view';
import {useSiteController} from './use-site-controller';
import './overlay.css';
import './private-match.css';
import{PrivateMatchingView}from'./private-match-view';
import{usePrivateMatching}from'./use-private-matching';
import {captureSiteActivations} from './overlay-port';
captureSiteActivations(window);
function InlineMatching({close}:{close:()=>void}){const vm=usePrivateMatching(undefined,close);return <PrivateMatchingView vm={vm} inline/>}
function Overlay(){const vm=useSiteController();return <OverlayView vm={vm} inlineMatching={vm.matchingOpen?<InlineMatching key={vm.snapshot?.generation} close={()=>vm.closePrivate?.()}/>:undefined}/>}
createRoot(document.getElementById('root')!).render(<Overlay/>);

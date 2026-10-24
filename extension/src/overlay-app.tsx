import React from'react';import{OverlayView}from'./overlay-view';import{useSiteController}from'./use-site-controller';import{PrivateMatchingView}from'./private-match-view';import{usePrivateMatching}from'./use-private-matching';import type{OverlayRestoreState}from'./overlay-types';
function InlineMatching({close,restored}:{close:()=>void;restored?:OverlayRestoreState}){const vm=usePrivateMatching(undefined,close,restored);return <PrivateMatchingView vm={vm} inline/>}
/** The matching child identity follows the explicit open session, never a display-only card generation. */
export function OverlayAssistant(){const vm=useSiteController();return <OverlayView vm={vm} inlineMatching={vm.matchingOpen?<InlineMatching close={()=>vm.closePrivate?.()} restored={vm.restoreState}/>:undefined}/>}

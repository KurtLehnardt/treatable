import React from'react';import{OverlayView}from'./overlay-view';import{useSiteController}from'./use-site-controller';import{PrivateMatchingView}from'./private-match-view';import{usePrivateMatching}from'./use-private-matching';import type{OverlayRestoreState}from'./overlay-types';import{ApplyView}from'./apply-view';import{useApply}from'./use-apply';
/** Keyed by study ID: a different study page always starts a blank plan. */
function ApplySection({nctId}:{nctId:string}){const vm=useApply(nctId);return <ApplyView vm={vm}/>}
function InlineMatching({close,restored}:{close:()=>void;restored?:OverlayRestoreState}){const vm=usePrivateMatching(undefined,close,restored);return <PrivateMatchingView vm={vm} inline/>}
/** The matching child identity follows the explicit open session, never a display-only card generation. */
export function OverlayAssistant(){const vm=useSiteController();return <OverlayView vm={vm} apply={vm.connected&&vm.study?<ApplySection key={vm.study.nctId} nctId={vm.study.nctId}/>:undefined} inlineMatching={vm.matchingOpen?<InlineMatching close={()=>vm.closePrivate?.()} restored={vm.restoreState}/>:undefined}/>}

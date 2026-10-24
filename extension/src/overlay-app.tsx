import React,{useEffect,useState} from 'react';
import {OverlayView} from './overlay-view';
import {useSiteController} from './use-site-controller';
import {PrivateMatchingView} from './private-match-view';
import {usePrivateMatching} from './use-private-matching';
import type {OverlayRestoreState} from './overlay-types';
import {ApplyView} from './apply-view';
import {useApply} from './use-apply';
import {DetailsContext,sessionDetailsStore} from './your-details';
import {YourDetailsSettings} from './your-details-view';
function ApplySection({nctId}:{nctId?:string}){const vm=useApply(nctId);return <ApplyView vm={vm}/>}
function InlineMatching({close,restored}:{close:()=>void;restored?:OverlayRestoreState}){const vm=usePrivateMatching(undefined,close,restored);return <PrivateMatchingView vm={vm} inline/>}
/** Reference entry retains the original private-matching security regression coverage. */
export function LegacyOverlayAssistant(){const vm=useSiteController();return <OverlayView vm={vm} inlineMatching={vm.matchingOpen?<InlineMatching close={()=>vm.closePrivate?.()} restored={vm.restoreState}/>:undefined}/>}
/** The primary flow is public-study analysis plus local drafting. It never mounts the legacy health-sharing flow.
 * "Your details" live in a session-only store owned by this frame; ending the session or closing the frame clears them. */
export function OverlayAssistant(){const vm=useSiteController();const[details]=useState(sessionDetailsStore);
 useEffect(()=>{if(vm.ended)details.clear()},[vm.ended,details]);useEffect(()=>()=>details.clear(),[details]);
 const identity=vm.study?.nctId??vm.snapshot?.generation??'empty';
 return <DetailsContext.Provider value={details}><OverlayView vm={vm} settings={<YourDetailsSettings ended={vm.ended}/>} apply={vm.connected?<ApplySection key={identity} nctId={vm.study?.nctId}/>:undefined}/></DetailsContext.Provider>}

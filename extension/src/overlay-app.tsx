import React,{useEffect,useRef,useState,type MutableRefObject} from 'react';
import {OverlayView} from './overlay-view';
import {useSiteController} from './use-site-controller';
import {PrivateMatchingView} from './private-match-view';
import {usePrivateMatching} from './use-private-matching';
import type {OverlayRestoreState} from './overlay-types';
import {ApplyView} from './apply-view';
import {useApply,type BriefEngineChoice} from './use-apply';
import {LocalModelsContext,LocalModelsStore} from './local-models';
import {ModelProviderSettings} from './model-settings';
import {DetailsContext,hasDetails,sessionDetailsStore} from './your-details';
import {YourDetailsSettings} from './your-details-view';
import type {UiPrefs} from './ui-prefs';
import {useGuide} from './use-guide';
import {RankingSection} from './ranking-view';
import {useAiRanking} from './use-ai-ranking';
/** Reports whether this study section holds typed work to the frame, which asks before closing over it. */
function ApplySection({nctId,dirtyRef,engine}:{nctId?:string;dirtyRef:MutableRefObject<boolean>;engine:BriefEngineChoice}){const vm=useApply(nctId,undefined,undefined,engine);useEffect(()=>{dirtyRef.current=vm.dirty},[vm.dirty]);useEffect(()=>()=>{dirtyRef.current=false},[]);return <ApplyView vm={vm}/>}
function InlineMatching({close,restored}:{close:()=>void;restored?:OverlayRestoreState}){const vm=usePrivateMatching(undefined,close,restored);return <PrivateMatchingView vm={vm} inline/>}
/** Reference entry retains the original private-matching security regression coverage. */
export function LegacyOverlayAssistant({initialPrefs}:{initialPrefs?:UiPrefs}){const vm=useSiteController(initialPrefs);return <OverlayView vm={vm} inlineMatching={vm.matchingOpen?<InlineMatching close={()=>vm.closePrivate?.()} restored={vm.restoreState}/>:undefined}/>}
/** AI-matched results for a results page. Ranking starts on its own once the intro tour is out of the way; see use-ai-ranking.ts. It pauses
 * while the popup is hidden, so nothing is ranked or sent while Treatable looks closed, and resumes for the page then shown when it is back. */
function Ranking({vm,guide}:{vm:ReturnType<typeof useSiteController>;guide:ReturnType<typeof useGuide>}){
 const enabled=vm.connected&&!vm.ended&&!vm.hidden&&!vm.study&&vm.aiRanking==='on'&&!!guide.settled&&!guide.active&&!!vm.snapshot?.supported&&!vm.availability?.loading;
 const{again}=useAiRanking({enabled,url:vm.snapshot?.url,nctIds:vm.snapshot?.nctIds,rank:vm.rankPage});
 const waiting=enabled?undefined:!guide.settled||guide.active?'intro':!vm.snapshot?.supported||!vm.snapshot.nctIds.length?'page':undefined;
 return <RankingSection vm={{aiRanking:vm.aiRanking,ranking:vm.ranking,waiting,connected:vm.connected,busy:vm.busy,setAiRanking:vm.setAiRanking,restore:vm.restore,again}}/>;
}
/** The primary flow: AI-matched results on results pages, the public-study brief and local drafting. It never mounts the legacy
 * health-sharing form. "Your details" live in a session-only store owned by this frame; ending the session or closing the frame clears them. */
export function OverlayAssistant({initialPrefs}:{initialPrefs?:UiPrefs}){const vm=useSiteController(initialPrefs);const guide=useGuide(vm.guideHost);const[details]=useState(sessionDetailsStore);const dirty=useRef(false);const[localModels]=useState(()=>new LocalModelsStore());
 useEffect(()=>{if(vm.ended){details.clear();localModels.clear()}},[vm.ended,details,localModels]);useEffect(()=>()=>details.clear(),[details]);
 /* A study section's drafts belong to its page: when the website moves to another study or results page, even while the popup is hidden, the section starts over. Your details are kept. */
 const identity=vm.study?.nctId??vm.snapshot?.generation??'empty',provider=vm.provider??'openai',localModel=vm.localModel??null;
 const settings=<><ModelProviderSettings provider={provider} localModel={localModel} setProvider={value=>vm.setProvider?.(value)} setLocalModel={value=>vm.setLocalModel?.(value)} ended={vm.ended}/><YourDetailsSettings ended={vm.ended}/></>;
 return <DetailsContext.Provider value={details}><LocalModelsContext.Provider value={localModels}><OverlayView vm={{...vm,guide,hasUnsavedWork:()=>dirty.current||hasDetails(details.get())}} settings={settings} ranking={vm.study?undefined:<Ranking vm={vm} guide={guide}/>} apply={vm.connected?<ApplySection key={identity} nctId={vm.study?.nctId} dirtyRef={dirty} engine={{provider,localModel}}/>:undefined}/></LocalModelsContext.Provider></DetailsContext.Provider>}

import React,{useContext,useEffect,useRef,useState,type MutableRefObject} from 'react';
import {OpenSettingsContext} from './settings-context';
import {OverlayView} from './overlay-view';
import {useSiteController} from './use-site-controller';
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
import {RankingNotice} from './ranking-notice';
import {useYourDetails} from './your-details';
import {detailConditionTerms} from './rank-merge';
/** Reports whether this study section holds typed work to the frame, which asks before closing over it. */
function ApplySection({nctId,dirtyRef,engine}:{nctId?:string;dirtyRef:MutableRefObject<boolean>;engine:BriefEngineChoice}){const vm=useApply(nctId,undefined,undefined,engine);useEffect(()=>{dirtyRef.current=vm.dirty},[vm.dirty]);useEffect(()=>()=>{dirtyRef.current=false},[]);return <ApplyView vm={vm}/>}
/** AI-matched results for a results page. Ranking starts on its own once the intro tour is out of the way; see use-ai-ranking.ts. It pauses
 * while the popup is hidden, so nothing is ranked or sent while Treatable looks closed, and resumes for the page then shown when it is back. */
function Ranking({vm,guide}:{vm:ReturnType<typeof useSiteController>;guide:ReturnType<typeof useGuide>}){
 const enabled=vm.connected&&!vm.ended&&!vm.hidden&&!vm.study&&vm.aiRanking==='on'&&!!guide.settled&&!guide.active&&!!vm.snapshot?.supported;
 const openSettings=useContext(OpenSettingsContext),{details}=useYourDetails(),sharpen=openSettings&&(!detailConditionTerms(details.condition,details.name).length||!details.ageBand)?openSettings:undefined;
 /* A percentage on a card is only as current as the page it was placed on: any new snapshot generation drops the badged claim, and the list comes back. */
 const generation=vm.snapshot?.generation,stamp=useRef<{state?:typeof vm.ranking;generation?:string}>({});
 if(stamp.current.state!==vm.ranking)stamp.current={state:vm.ranking,generation};
 const ranking=vm.ranking&&stamp.current.generation!==generation?{...vm.ranking,badged:undefined}:vm.ranking;
 const{again}=useAiRanking({enabled,url:vm.snapshot?.url,nctIds:vm.snapshot?.nctIds,rank:vm.rankPage});
 const waiting=enabled?undefined:!guide.settled||guide.active?'intro':!vm.snapshot?.supported||!vm.snapshot.nctIds.length?'page':undefined;
 return <RankingSection vm={{aiRanking:vm.aiRanking,ranking,waiting,connected:vm.connected,busy:vm.busy,restore:vm.restore,again,sharpen,searchHelp:guide.canSearchHelp?guide.startSearchHelp:undefined}}/>;
}
/** The overlay: AI-matched results on results pages, the public-study brief and local drafting. It has no health-sharing form. "Your details" live in a session-only store owned by this frame; ending the session or closing the frame clears them. */
export function OverlayAssistant({initialPrefs}:{initialPrefs?:UiPrefs}){const vm=useSiteController(initialPrefs);const guide=useGuide(vm.guideHost);const[details]=useState(sessionDetailsStore);const dirty=useRef(false);const[localModels]=useState(()=>new LocalModelsStore());
 useEffect(()=>{if(vm.ended){details.clear();localModels.clear()}},[vm.ended,details,localModels]);useEffect(()=>()=>details.clear(),[details]);
 /* A study section's drafts belong to its page: when the website moves to another study or results page, even while the popup is hidden, the section starts over. Your details are kept. */
 const identity=vm.study?.nctId??vm.snapshot?.generation??'empty',provider=vm.provider??'openai',localModel=vm.localModel??null;
 const settings=<><ModelProviderSettings provider={provider} localModel={localModel} setProvider={value=>vm.setProvider?.(value)} setLocalModel={value=>vm.setLocalModel?.(value)} ended={vm.ended}/><YourDetailsSettings ended={vm.ended}/><RankingNotice/></>;
 return <DetailsContext.Provider value={details}><LocalModelsContext.Provider value={localModels}><OverlayView vm={{...vm,guide,hasUnsavedWork:()=>dirty.current||hasDetails(details.get())}} settings={settings} ranking={vm.study?undefined:<Ranking vm={vm} guide={guide}/>} apply={vm.connected&&vm.study?<ApplySection key={identity} nctId={vm.study?.nctId} dirtyRef={dirty} engine={{provider,localModel}}/>:undefined}/></LocalModelsContext.Provider></DetailsContext.Provider>}

import {useEffect,useMemo,useRef} from 'react';
import {useYourDetails,type YourDetails} from './your-details';
import {detailConditionTerms} from './rank-merge';
import type {RankDetails} from './rank-background';
/** A short pause so typing in Your details or a page that is still settling starts one ranking, not several. */
export const RANK_DEBOUNCE_MS=900;
/** The only Your details values ranking may use: age band, sex and short condition terms. Never the name or "anything else". */
export function rankDetailsFrom(d:YourDetails):RankDetails{const terms=detailConditionTerms(d.condition,d.name);return{...(d.ageBand?{ageBand:d.ageBand}:{}),...(d.sex?{sex:d.sex}:{}),...(terms.length?{terms}:{})}}
/** Starts AI-matched results automatically whenever ranking is allowed and the page's cards or the ranking details change. */
export function useAiRanking({enabled,url,nctIds,rank}:{enabled:boolean;url?:string;nctIds?:readonly string[];rank:(details:RankDetails,force?:boolean)=>void}){
 const {details}=useYourDetails();
 const payload=useMemo(()=>rankDetailsFrom(details),[details.condition,details.name,details.ageBand,details.sex]);
 const key=enabled&&url&&nctIds?.length?JSON.stringify([url,nctIds,payload]):undefined;
 const latest=useRef({payload,rank});latest.current={payload,rank};
 useEffect(()=>{if(!key)return;const timer=setTimeout(()=>latest.current.rank(latest.current.payload),RANK_DEBOUNCE_MS);return()=>clearTimeout(timer)},[key]);
 return{again:(force:boolean)=>latest.current.rank(latest.current.payload,force)};
}

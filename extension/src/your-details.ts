/** "Your details": an optional name, a description of the patient's illness, condition, symptoms or reason for seeking
 * treatment, anything else they want included, and an optional age band and sex. The text values fill the patient's own
 * local drafts (email, call script and follow-up message), which stay editable before use.
 *
 * AI-matched results uses the age band and sex on this device only, for record checks, and sends short condition terms derived from
 * the condition text (rank-merge.ts detailConditionTerms: short phrases only, never the name, digit groups or narrative) to the ranking
 * provider; with OpenAI only after the browser-session confirmation. The name and "anything else" are never used for ranking.
 *
 * Storage is session only. The values live in this extension frame's memory and are cleared by the Clear button,
 * "End and clear my details", and when the Treatable session ends or the frame closes. They are never written to
 * extension storage, web storage, IndexedDB, files or cookies, and they are never part of any ClinicalTrials.gov, trace, log or
 * URL payload, apart from the mailto/tel handoff the patient starts and the AI-matched results fields described above.
 *
 * Every reader and writer goes through DetailsStore. A later "Remember on this device" option would add another
 * DetailsStore implementation with a different `persistence` value; it is deliberately not implemented here. */
import {createContext,useContext,useSyncExternalStore} from 'react';
import {AGE_BANDS,type AgeBand} from '../shared/real-contract.mjs';
export interface YourDetails{name:string;condition:string;extra:string;ageBand?:''|AgeBand;sex?:''|'female'|'male'}
type TextField='name'|'condition'|'extra';
export const YOUR_DETAILS_LIMITS:Readonly<Record<TextField,number>>=Object.freeze({name:120,condition:1000,extra:1000});
export const BLANK_DETAILS:YourDetails=Object.freeze({name:'',condition:'',extra:'',ageBand:'',sex:''});
/** Only 'session' exists today. */
export type DetailsPersistence='session';
export interface DetailsStore{
 readonly persistence:DetailsPersistence;
 get():YourDetails;
 set(patch:Partial<YourDetails>):void;
 clear():void;
 subscribe(listener:()=>void):()=>void;
}
const FIELDS=Object.keys(YOUR_DETAILS_LIMITS) as TextField[];
export const hasDetails=(d:YourDetails)=>FIELDS.some(key=>d[key].trim()!=='')||!!d.ageBand||!!d.sex;
/** In-memory store for the current session. Nothing is read from or written to any browser or helper storage. */
export function sessionDetailsStore():DetailsStore{
 let value=BLANK_DETAILS;const listeners=new Set<()=>void>();
 const emit=()=>{for(const listener of [...listeners])listener()};
 return{
  persistence:'session',
  get:()=>value,
  set(patch){const next={...value};for(const key of FIELDS){const v=patch[key];if(typeof v==='string')next[key]=v.slice(0,YOUR_DETAILS_LIMITS[key])}if(patch.ageBand===''||AGE_BANDS.includes(patch.ageBand as AgeBand))next.ageBand=patch.ageBand as YourDetails['ageBand'];if(patch.sex===''||patch.sex==='female'||patch.sex==='male')next.sex=patch.sex;value=Object.freeze(next);emit()},
  clear(){if(value===BLANK_DETAILS)return;value=BLANK_DETAILS;emit()},
  subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener)}}
 };
}
export const DetailsContext=createContext<DetailsStore|undefined>(undefined);
const none=()=>()=>{},blank=()=>BLANK_DETAILS;
/** Current details and their store. Without a provider (for example the reference panel) the details are blank. */
export function useYourDetails():{details:YourDetails;store?:DetailsStore}{
 const store=useContext(DetailsContext);
 const details=useSyncExternalStore(store?store.subscribe:none,store?store.get:blank,store?store.get:blank);
 return{details,store};
}

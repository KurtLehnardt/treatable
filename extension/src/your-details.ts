/** "Your details": an optional name, a description of the patient's illness, condition, symptoms or reason for seeking
 * treatment, and anything else they want included. These values only fill the patient's own local drafts (email, call
 * script and follow-up message), which stay editable before use.
 *
 * Storage is session only. The values live in this extension frame's memory and are cleared by the Clear button,
 * "End and clear my details", and when the Treatable session ends or the frame closes. They are never written to
 * extension storage, web storage, IndexedDB, files or cookies, and they are never part of any OpenAI, native helper,
 * ClinicalTrials.gov, trace, log or URL payload, apart from the mailto/tel handoff the patient starts.
 *
 * Every reader and writer goes through DetailsStore. A later "Remember on this device" option would add another
 * DetailsStore implementation with a different `persistence` value; it is deliberately not implemented here. */
import {createContext,useContext,useSyncExternalStore} from 'react';
export interface YourDetails{name:string;condition:string;extra:string}
export const YOUR_DETAILS_LIMITS:Readonly<Record<keyof YourDetails,number>>=Object.freeze({name:120,condition:1000,extra:1000});
export const BLANK_DETAILS:YourDetails=Object.freeze({name:'',condition:'',extra:''});
/** Only 'session' exists today. */
export type DetailsPersistence='session';
export interface DetailsStore{
 readonly persistence:DetailsPersistence;
 get():YourDetails;
 set(patch:Partial<YourDetails>):void;
 clear():void;
 subscribe(listener:()=>void):()=>void;
}
const FIELDS=Object.keys(YOUR_DETAILS_LIMITS) as (keyof YourDetails)[];
export const hasDetails=(d:YourDetails)=>FIELDS.some(key=>d[key].trim()!=='');
/** In-memory store for the current session. Nothing is read from or written to any browser or helper storage. */
export function sessionDetailsStore():DetailsStore{
 let value=BLANK_DETAILS;const listeners=new Set<()=>void>();
 const emit=()=>{for(const listener of [...listeners])listener()};
 return{
  persistence:'session',
  get:()=>value,
  set(patch){const next={...value};for(const key of FIELDS){const v=patch[key];if(typeof v==='string')next[key]=v.slice(0,YOUR_DETAILS_LIMITS[key])}value=Object.freeze(next);emit()},
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

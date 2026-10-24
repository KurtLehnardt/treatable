import{isSupportedSite}from'./sites';
/** Public study ID of a ClinicalTrials.gov study page, read only from a validated tab URL (never from page DOM). */
export function studyPageNctId(value:unknown):string|undefined{
 if(typeof value!=='string'||!isSupportedSite(value))return;
 try{const u=new URL(value);if(u.protocol!=='https:'||u.port||u.username||u.password)return;return /^\/study\/(NCT[0-9]{8})\/?$/.exec(u.pathname)?.[1]}catch{return}
}

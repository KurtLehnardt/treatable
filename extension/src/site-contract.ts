import{isSupportedSite}from'./sites';
export type SitePurpose='overlay'|'badge';
export type SiteDateRange={from?:string;to?:string};
export type SiteAgeRange={from?:string;to?:string;fromUnit?:'y'|'M'|'w'|'d'|'H'|'m';toUnit?:'y'|'M'|'w'|'d'|'H'|'m'};
export type SiteLocation={text:string;lat?:number;lng?:number;distance?:number;country?:string;state?:string;city?:string};
export interface SiteSearchFilters{cond?:string;term?:string;intr?:string;titles?:string;outc?:string;spons?:string;lead?:string;id?:string;locn?:string;loc?:SiteLocation;status?:string[];sex?:string;ages?:string[];manualAge?:SiteAgeRange;healthy?:boolean;phase?:string[];studyType?:string[];results?:string[];docs?:string[];funderType?:string[];start?:SiteDateRange;primComp?:SiteDateRange;firstPost?:SiteDateRange;resFirstPost?:SiteDateRange;lastUpdPost?:SiteDateRange;studyComp?:SiteDateRange;violation?:boolean;ressub?:string}
export interface SiteSnapshot{generation:string;url:string;nctIds:string[];diagnostic:string;supported:boolean;totalCards?:number;hiddenCards?:number;unverifiedCards?:number;allNctIds?:string[]}
export interface SiteScore{nctId:string;score:number}
export interface LiveSiteStudy{id:string;title:string;status:string;conditions:string[];criteria:string;minimumAge:string|null;maximumAge:string|null;sex:string|null;healthyVolunteers:boolean|null;hasResults:boolean;sourceUrl:string;fetchedAt:string;lastUpdatePostDate:string|null}
export type SiteRequestType='site.search'|'site.snapshot'|'site.layout'|'site.restore'|'site.close'|'site.fetch'|'site.rank'|'site.openPrivate'|'site.diagnostics'|'site.endMatching'|'site.ping'|'site.availability';
export interface SiteRequest{id:string;type:SiteRequestType;payload:Record<string,unknown>}
export const SITE_OVERLAY_PORT='treatable.site.overlay.v1',SITE_BADGE_PORT='treatable.site.badge.v1';
export const SITE_PRIVATE_MATCHING_READY=true;
export const SITE_MAX_MESSAGE_BYTES=128*1024;
export function siteBytes(value:unknown){try{return new TextEncoder().encode(JSON.stringify(value)).byteLength}catch{return Infinity}}
export function siteRecord(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v)}
export function exactSiteKeys(v:unknown,keys:readonly string[]):v is Record<string,unknown>{return siteRecord(v)&&Object.keys(v).every(k=>keys.includes(k))}
export function isNctId(v:unknown):v is string{return typeof v==='string'&&/^NCT[0-9]{8}$/.test(v)}
export function siteNctIds(v:unknown,max=100):string[]{if(!Array.isArray(v)||v.length>max||v.some(x=>!isNctId(x))||new Set(v).size!==v.length)throw Error('Invalid public study identifiers');return [...v]}
export function parseSiteRequest(v:unknown):SiteRequest{if(!exactSiteKeys(v,['id','type','payload'])||typeof v.id!=='string'||! /^[A-Za-z0-9_.:-]{1,80}$/.test(v.id)||!['site.search','site.snapshot','site.layout','site.restore','site.close','site.fetch','site.rank','site.openPrivate','site.diagnostics','site.endMatching','site.ping','site.availability'].includes(String(v.type))||!siteRecord(v.payload)||siteBytes(v)>SITE_MAX_MESSAGE_BYTES)throw Error('Invalid site operation');return v as unknown as SiteRequest}
export function sitePageUrl(value:unknown){if(typeof value!=='string'||!isSupportedSite(value))throw Error('Unsupported site');const u=new URL(value);if(u.port)throw Error('Unsupported site');return u}
export function emptySiteSnapshot(url:string,diagnostic='Waiting for result cards.'):SiteSnapshot{return{generation:'0',url,nctIds:[],diagnostic,supported:false}}

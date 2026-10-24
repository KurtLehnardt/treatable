import {resolveZip, type ZipData} from './core';
import {haversineMiles} from '../../scaffold/lib/eligibility/hardFilters';
import {sanitizeUntrustedText} from '../shared/untrusted-text.mjs';

/** Public facility metadata remains local. Never spread it into a model packet. */
export interface SitePoint {facility:string;city?:string;state?:string;country?:string;status?:string;lat?:number;lon?:number}
export interface LocalOrigin {lat:number;lon:number}
export type SiteLocationStatus='accepting'|'unverified'|'opening_soon'|'invitation'|'not_accepting';
export interface SiteDistance {
 distanceStatus:'known'|'unknown'|'no_origin'|'no_eligible_site';distanceMiles?:number;nearestSiteLabel?:string;siteStatus?:SiteLocationStatus;
 outsideRadius:boolean;radiusStatus:'not_set'|'within'|'outside'|'unknown';missingCoordinates:number;eligibleSites:number;unverifiedSites:number;coverage:'complete'|'partial'|'none';originKind?:'search'|'zip';nearestUnverifiedMiles?:number;nearestUnverifiedLabel?:string;
}
export interface LocalDistanceOptions {radiusMiles?:number;onlyAccepting?:boolean;includeSoon?:boolean;includeInvitation?:boolean;originKind?:'search'|'zip'}
const closed=new Set(['ACTIVE_NOT_RECRUITING','COMPLETED','TERMINATED','WITHDRAWN','SUSPENDED','NO_LONGER_AVAILABLE','TEMPORARILY_NOT_AVAILABLE','APPROVED_FOR_MARKETING']);
const text=(value:unknown,max:number)=>typeof value==='string'?sanitizeUntrustedText(value).replace(/\s+/gu,' ').trim().slice(0,max):'';
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function validLocalOrigin(value:unknown):value is LocalOrigin {return record(value)&&typeof value.lat==='number'&&Number.isFinite(value.lat)&&Math.abs(value.lat)<=90&&typeof value.lon==='number'&&Number.isFinite(value.lon)&&Math.abs(value.lon)<=180}
export function parseStudySites(value:unknown):SitePoint[] {
 if(!Array.isArray(value))return[];
 if(value.length>5000)throw Error('Public location record exceeds the local limit.');
 return value.map(item=>{
  const raw=record(item)?item:{},point=record(raw.geoPoint)?raw.geoPoint:{};
  const out:SitePoint={facility:text(raw.facility,200)};
  for(const key of ['city','state','country','status'] as const){const item=text(raw[key],key==='city'?120:80);if(item)out[key]=item}
  if(validLocalOrigin(point)){out.lat=point.lat;out.lon=point.lon}
  return out;
 });
}
export function resolveLocalZip(rawZip:string,data:ZipData):LocalOrigin {const origin=resolveZip(rawZip,data);return{lat:origin.lat,lon:origin.lon}}
export function siteLocationStatus(raw?:string):SiteLocationStatus {
 const value=(raw||'').trim().toUpperCase().replace(/[\s-]+/gu,'_');
 if(value==='RECRUITING'||value==='AVAILABLE')return'accepting';
 if(value==='NOT_YET_RECRUITING')return'opening_soon';
 if(value==='ENROLLING_BY_INVITATION')return'invitation';
 return closed.has(value)?'not_accepting':'unverified';
}
const isUs=(value?:string)=>['united states','united states of america','us','usa'].includes((value||'').trim().toLowerCase());
const unknownCountry=(value?:string)=>!value||['unknown','not provided','n/a','na'].includes(value.trim().toLowerCase());
const label=(site:SitePoint)=>[site.facility,site.city,site.state].filter(Boolean).join(' · ').slice(0,400)||'Location details unavailable';
export function nearestStudySite(sites:readonly SitePoint[],origin?:LocalOrigin,options:LocalDistanceOptions={}):SiteDistance {
 const allowed=(site:SitePoint)=>{const status=siteLocationStatus(site.status);return options.onlyAccepting===false||status==='accepting'||status==='unverified'||status==='opening_soon'&&options.includeSoon===true||status==='invitation'&&options.includeInvitation===true};
 const potential=sites.filter(site=>isUs(site.country)&&allowed(site)),uncertainCountry=sites.filter(site=>unknownCountry(site.country)&&allowed(site)).length;
 const missing=potential.filter(site=>!validLocalOrigin(site)).length+uncertainCountry;
 const unverified=potential.filter(site=>siteLocationStatus(site.status)==='unverified').length+uncertainCountry;
 const radius=typeof options.radiusMiles==='number'&&Number.isFinite(options.radiusMiles)&&options.radiusMiles>0&&options.radiusMiles<=500?options.radiusMiles:undefined;
 const base:SiteDistance={distanceStatus:potential.length||uncertainCountry?'unknown':'no_eligible_site',outsideRadius:false,radiusStatus:radius?'unknown':'not_set',missingCoordinates:missing,eligibleSites:potential.length,unverifiedSites:unverified,coverage:potential.length?missing?'partial':'complete':'none',...(options.originKind?{originKind:options.originKind}:{})};
 if(!validLocalOrigin(origin))return{...base,distanceStatus:'no_origin'};
 const measured=potential.flatMap(site=>validLocalOrigin(site)?[{site,status:siteLocationStatus(site.status),miles:haversineMiles(origin,{lat:site.lat!,lon:site.lon!})}]:[]).sort((a,b)=>a.miles-b.miles);
 const known=measured.find(item=>item.status!=='unverified'),unknown=measured.find(item=>item.status==='unverified'),selected=known||unknown;
 if(!selected)return base;
 let radiusStatus:SiteDistance['radiusStatus']='not_set';
 if(radius){
  if(known&&known.miles<=radius)radiusStatus='within';
  else if(missing===0&&measured.length===potential.length&&measured.every(item=>item.miles>radius))radiusStatus='outside';
  else radiusStatus='unknown';
 }
 return{...base,distanceStatus:'known',distanceMiles:selected.miles,nearestSiteLabel:label(selected.site),siteStatus:selected.status,radiusStatus,outsideRadius:radiusStatus==='outside',...(unknown?{nearestUnverifiedMiles:unknown.miles,nearestUnverifiedLabel:label(unknown.site)}:{})};
}
/** Narrow only derived display data, never source coordinates or the private ZIP. */
export function parseBadgeDistance(value:unknown):SiteDistance|undefined {
 if(!record(value))return;
 const keys=['distanceStatus','distanceMiles','nearestSiteLabel','siteStatus','outsideRadius','radiusStatus','missingCoordinates','eligibleSites','unverifiedSites','coverage','originKind','nearestUnverifiedMiles','nearestUnverifiedLabel'];
 if(Object.keys(value).some(key=>!keys.includes(key))||!['known','unknown','no_origin','no_eligible_site'].includes(String(value.distanceStatus))||!['not_set','within','outside','unknown'].includes(String(value.radiusStatus))||!['complete','partial','none'].includes(String(value.coverage))||typeof value.outsideRadius!=='boolean'||value.outsideRadius!==(value.radiusStatus==='outside'))return;
 for(const key of ['missingCoordinates','eligibleSites','unverifiedSites'])if(!Number.isInteger(value[key])||Number(value[key])<0||Number(value[key])>5000)return;
 for(const key of ['distanceMiles','nearestUnverifiedMiles'])if(value[key]!==undefined&&(typeof value[key]!=='number'||!Number.isFinite(value[key])||Number(value[key])<0||Number(value[key])>12500))return;
 for(const key of ['nearestSiteLabel','nearestUnverifiedLabel'])if(value[key]!==undefined&&(typeof value[key]!=='string'||String(value[key]).length>400||text(value[key],400)!==value[key]))return;
 if(value.distanceStatus==='known'&&(value.distanceMiles===undefined||typeof value.nearestSiteLabel!=='string'))return;
 if(value.siteStatus!==undefined&&!['accepting','unverified','opening_soon','invitation','not_accepting'].includes(String(value.siteStatus)))return;
 if(value.originKind!==undefined&&!['search','zip'].includes(String(value.originKind)))return;
 return value as unknown as SiteDistance;
}

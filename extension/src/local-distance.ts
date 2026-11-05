import {resolveZip, type ZipData} from './core';
import {sanitizeUntrustedText} from '../shared/untrusted-text.mjs';

/** Public facility metadata remains local. Never spread it into a model packet. Status and coordinates feed the study page's site list (apply-plan.ts). */
export interface SitePoint {facility:string;city?:string;state?:string;country?:string;status?:string;lat?:number;lon?:number}
export interface LocalOrigin {lat:number;lon:number}
export type SiteLocationStatus='accepting'|'unverified'|'opening_soon'|'invitation'|'not_accepting';
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

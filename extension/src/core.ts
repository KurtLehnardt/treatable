import {boundedText} from './validation';
import {isSupportedSite} from './sites';
export interface ZipData {zips:Record<string,{city:string;state:string;lat:number;lon:number}>;attribution?:string;precision?:string}
/** HTTPS-only, credential-free absolute URL, or undefined. */
export function safeWebUrl(value:string):string|undefined{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:undefined}catch{return undefined}}
/** Link target for study records: HTTPS on the exact trusted ClinicalTrials.gov origins only. */
export function trialUrl(value:string):string|undefined{const url=safeWebUrl(value);return url&&isSupportedSite(url)?url:undefined}
export function resolveZip(raw:string,zips:ZipData):{zip:string;city:string;state:string;lat:number;lon:number}{
 const value=boundedText(raw,'ZIP code',10);if(!/^\d{5}(?:-\d{4})?$/.test(value))throw new Error('Enter a five-digit US ZIP code, optionally ZIP+4.');const zip=value.slice(0,5),entry=zips?.zips?.[zip];
 if(!entry)throw new Error('ZIP not in the offline directory. Check it or search without location.');
 if(!Number.isFinite(entry.lat)||entry.lat< -90||entry.lat>90||!Number.isFinite(entry.lon)||entry.lon< -180||entry.lon>180||typeof entry.state!=='string'||!/^[A-Z]{2}$/.test(entry.state))throw new Error('Offline location data is unavailable. Search without location.');
 return{zip,city:boundedText(entry.city,'Offline city',200,{empty:false}),state:entry.state,lat:entry.lat,lon:entry.lon};
}

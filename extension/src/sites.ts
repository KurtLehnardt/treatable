import sites from '../sites.json';
export const TRIAL_ORIGINS:readonly string[]=sites.origins;
export function isSupportedSite(value:string):boolean{try{const u=new URL(value);return !u.username&&!u.password&&TRIAL_ORIGINS.includes(u.origin)}catch{return false}}

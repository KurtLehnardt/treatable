import React from 'react';
import type {SiteDistance} from './local-distance';
export function ScoreBadge({score,label,distance,mode,resultState,theme='system'}:{score?:number;label?:string;distance?:SiteDistance;mode?:'basic'|'openai';resultState?:'scored'|'unavailable';theme?:'system'|'light'|'dark'}) {
 const valid=typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=100;
 const known=distance?.distanceStatus==='known'&&typeof distance.distanceMiles==='number'&&Number.isFinite(distance.distanceMiles);
 const uncertainNearby=known&&typeof distance.nearestUnverifiedMiles==='number'&&distance.nearestUnverifiedMiles<distance.distanceMiles!&&distance.siteStatus!=='unverified';
 const clinical=resultState==='unavailable'?'Public record or text unavailable':label==='unlikely'?'Known criteria mismatch':label==='unknown'?'Eligibility unknown':label==='structured_compatible'?'Listed checks fit; eligibility unknown':label?.slice(0,100);
 return <div className="score-badge" data-theme={theme}>
  <div className="badge-heading"><strong>{valid?`${Math.round(score)}%`:'—'}</strong><span>{valid?(mode==='basic'?'keyword match':'match'):resultState==='unavailable'?'Unavailable':'Not scored'}</span></div>
  {clinical&&<small className="badge-clinical">{clinical}</small>}
  <span className="badge-site" title={known?distance.nearestSiteLabel:undefined}>{known?`Nearest known: ${distance.nearestSiteLabel}`:'Distance unavailable'}</span>
  <span className="badge-distance">{known?`~${Math.round(distance.distanceMiles!)} mi · straight-line`:'Use a search location or local ZIP'}</span>
  <small className="badge-location-note" title={uncertainNearby?distance?.nearestUnverifiedLabel:undefined}>{uncertainNearby?`Unverified site ~${Math.round(distance!.nearestUnverifiedMiles!)} mi`:distance?.coverage==='partial'?'Some location data is missing':distance?.siteStatus==='unverified'?'Recruitment at this site is unverified':distance?.siteStatus==='not_accepting'?'This site is not accepting participants':distance?.originKind==='zip'?'Approximate ZIP-center distance':distance?.originKind==='search'?'Distance from your search location':''}</small>
  <small className="badge-disclaimer">{mode==='basic'?'Basic · local keyword relevance; not eligibility odds.':mode==='openai'?'OpenAI relevance, not eligibility odds.':'No current match result.'}</small>
 </div>;
}

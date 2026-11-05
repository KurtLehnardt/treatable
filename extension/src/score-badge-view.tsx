import React,{useEffect,useState} from 'react';
import {CHECK_REASONS,REASON_TEXT,isReasonId,type CheckReason} from './rank-labels';
/** Reason text for a badge label: an AI-matched results reason id. */
export function badgeReason(label?:string){return isReasonId(label)?REASON_TEXT[label]:undefined}
const tone=(score:number|undefined,mismatch:boolean)=>mismatch?'low':score===undefined?'none':score>=75?'high':score>=50?'mid':score>=25?'some':'low';
/** A small match-percentage ring for one result card. Hovering or focusing it shows the short reason; onExpand lets the page frame grow
 * so the reason fits, and shrink again afterwards. A badge with nothing to show renders empty, and the page frame hides it. */
export const badgeVisible=(score?:number,label?:string)=>typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=100||!!badgeReason(label);
export function ScoreBadge({score,label,theme='system',onExpand}:{score?:number;label?:string;theme?:'system'|'light'|'dark';onExpand?:(open:boolean)=>void}) {
 const[open,setOpen]=useState(false);
 const valid=typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=100,percent=valid?Math.round(score):undefined;
 const reason=badgeReason(label),mismatch=CHECK_REASONS.includes(label as CheckReason);
 const shown=percent!==undefined||!!reason;
 /* The frame size follows the open state and whether there is anything to show, including when data arrives during a hover. */
 useEffect(()=>{if(!shown)setOpen(false)},[shown]);
 useEffect(()=>{onExpand?.(open&&shown)},[open,shown,onExpand]);
 if(!shown)return <div className="score-badge" data-empty="true" data-theme={theme}/>;
 const headline=percent===undefined?'Not scored':`${percent}% match`,spoken=[headline,reason].filter(Boolean).join('. ');
 const show=(value:boolean)=>setOpen(value);
 return <div className="score-badge" data-open={open?'true':undefined} data-theme={theme} data-tone={tone(percent,mismatch)}>
  {/* Hover is tracked on the ring and its tip only, so the frame shrinks as soon as the pointer moves onto the card again. */}
  <div className="badge-hit" onMouseEnter={()=>show(true)} onMouseLeave={()=>show(false)}>
   <div className="badge-ring" tabIndex={0} role="img" aria-label={spoken} onFocus={()=>show(true)} onBlur={()=>show(false)}>
    <svg viewBox="0 0 40 40" aria-hidden="true"><circle className="ring-track" cx="20" cy="20" r="18"/>{percent!==undefined&&<circle className="ring-fill" cx="20" cy="20" r="18" pathLength={100} strokeDasharray={`${Math.max(percent,1)} 100`} transform="rotate(-90 20 20)"/>}</svg>
    <strong aria-hidden="true" className={percent===100?'full':undefined}>{percent===undefined?'–':`${percent}%`}</strong>
   </div>
   {open&&<div className="badge-tip" aria-hidden="true"><strong>{headline}</strong>{reason&&<span>{reason}</span>}</div>}
  </div>
 </div>;
}

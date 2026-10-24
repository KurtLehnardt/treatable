import React from 'react';
export function ScoreBadge({score,label}:{score?:number;label?:string}){const valid=typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=100;return <div className="score-badge"><span>{valid?'Relevance':'Treatable'}</span><strong>{valid?`${Math.round(score)} / 100`:'Not scored'}</strong>{label&&<small>{label.slice(0,100)}</small>}</div>}

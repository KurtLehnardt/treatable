import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SiteClient,readActivation} from './overlay-port';
import './score-badge.css';
import {ScoreBadge} from './score-badge-view';

function Badge(){const[data,setData]=useState<{score?:number;label?:string}>({});useEffect(()=>{let client:SiteClient|undefined;let alive=true;const activate=async(e:MessageEvent)=>{const auth=readActivation(e,window.parent,'badge');if(!auth||client)return;client=new SiteClient(chrome.runtime,'badge');client.onEvent(v=>{if(alive&&v.type==='site.badge'){const score=typeof v.score==='number'&&Number.isFinite(v.score)&&v.score>=0&&v.score<=100?v.score:undefined;setData({score,label:typeof v.label==='string'?v.label.slice(0,100):undefined})}});try{await client.authenticate(auth.capability)}catch{client?.disconnect();client=undefined}};const end=()=>{alive=false;client?.disconnect();setData({})};window.addEventListener('message',activate);window.addEventListener('pagehide',end);return()=>{alive=false;client?.disconnect();window.removeEventListener('message',activate);window.removeEventListener('pagehide',end)}},[]);return <ScoreBadge {...data}/>}
createRoot(document.getElementById('root')!).render(<Badge/>);

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import TestRenderer from 'react-test-renderer';
import {readFileSync} from 'node:fs';
import {RankingSection} from '../src/ranking-view';
import {OverlayView} from '../src/overlay-view';
import {collapsedStatus,parseRankingState} from '../src/rank-state';

const study=(i:number,percent:number|null,checks:string[]=[])=>({nctId:`NCT0000000${i}`,title:`Study ${i}`,percent,reasonId:checks[0]??'strong_match',checks,score:percent??0});
const done=(extra:any={})=>({phase:'done',total:2,applied:true,provider:'openai',mode:'live',studies:[study(1,91),study(2,4,['not_recruiting'])],request:{text:'{"model":"m"}',bytes:13,truncated:false},profile:{conditions:['Asthma']},...extra});
const model=(ranking:any,extra:any={})=>({aiRanking:'on',connected:true,busy:false,setAiRanking(){},restore(){},again(){},ranking,...extra}) as any;
const html=(ranking:any,extra:any={})=>renderToStaticMarkup(React.createElement(RankingSection,{vm:model(ranking,extra)}));

test('badges placed: one status line, no list, and the restore row; reasons for moved studies stay one hover away',()=>{
 const h=html(done({badged:true}),{searchHelp:()=>{}});
 assert.match(h,/Ranked 2 studies, best matches first\. Match % is on each card\./);
 assert.match(h,/1 was moved to the end by record checks; hover its % to see why\./);
 assert.doesNotMatch(h,/class="ranking-list"|rank-percent|Study 1/,'no duplicate list');
 const labels=[...h.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(m=>m[1]);
 assert.deepEqual(labels,['Restore site order','Show me the website’s filters']);
});
test('badges not placed or not known: the full ranked list is shown',()=>{
 for(const badged of [false,undefined]){
  const h=html(done(badged===undefined?{}:{badged}));
  assert.match(h,/class="ranking-list"/);assert.match(h,/Study 1/);assert.match(h,/Not recruiting/);assert.doesNotMatch(h,/Match % is on each card/);
 }
});
test('one Technical details disclosure holds the code, request body and probabilities',()=>{
 const h=html(done({badged:true,failure:'RATE_LIMITED',studies:[{...study(1,91),probabilities:[0,0,.27,.73]},study(2,4,['not_recruiting'])]}));
 assert.equal((h.match(/<details/g)||[]).length,1,'exactly one disclosure');
 assert.match(h,/<details[^>]*><summary>Technical details<\/summary>/);
 const inside=h.slice(h.indexOf('<details'));
 assert.match(inside,/<code>RATE_LIMITED<\/code>/);assert.match(inside,/Ranking request body/);assert.match(inside,/73\.0%/);
 assert.doesNotMatch(h.slice(0,h.indexOf('<details')),/RATE_LIMITED|73\.0%/,'nothing technical outside it');
 assert.doesNotMatch(h,/How this was ranked/);
});
test('the website-filters help stays reachable when AI-matched results are off',()=>{
 const h=html(undefined,{aiRanking:'off',searchHelp:()=>{}});
 assert.match(h,/Turn on AI-matched results/);assert.match(h,/Show me the website’s filters/);
 assert.doesNotMatch(html(undefined,{aiRanking:'off'}),/website’s filters/,'only when the guide can run');
});
test('sharpen link shows only when offered, and opens Your details',()=>{
 let opened=0;
 const r=TestRenderer.create(React.createElement(RankingSection,{vm:model(done({badged:true}),{sharpen:()=>opened++})}));
 const b=r.root.findAllByType('button').find(x=>x.children.join('')==='Add your condition and age to sharpen matching ›')!;
 b.props.onClick();assert.equal(opened,1);r.unmount();
 assert.doesNotMatch(html(done({badged:true})),/sharpen matching/);
});
test('collapsed status text',()=>{
 assert.equal(collapsedStatus(done({badged:true}) as any),'Ranked 2 · top match 91%');
 assert.equal(collapsedStatus({phase:'scoring'}),'Ranking…');
 assert.equal(collapsedStatus(done({provider:'none',failure:'KEY_MISSING'}) as any),'Ranked 2 · record checks only');
 assert.equal(collapsedStatus(done({applied:false}) as any),undefined);
 assert.equal(collapsedStatus(undefined),undefined);
 const vm:any={connected:true,ended:false,collapsed:true,aiRanking:'on',setCollapsed(){},close(){},ranking:done({badged:true}),setAiRanking(){}};
 const collapsed=renderToStaticMarkup(React.createElement(OverlayView,{vm}));
 assert.match(collapsed,/<p role="status" class="collapsed-status">Ranked 2 · top match 91%<\/p>/);
 assert.doesNotMatch(renderToStaticMarkup(React.createElement(OverlayView,{vm:{...vm,collapsed:false}})),/collapsed-status/,'only in the collapsed frame');
});
test('badged is validated on arrival',()=>{
 assert.equal(parseRankingState({phase:'done',badged:true})?.badged,true);
 assert.equal(parseRankingState({phase:'done',badged:'yes'}),undefined);
});
test('badge font sizes: 12px below 100, 11px for 100%, and the ring stays thin enough to clear the text',()=>{
 const css=readFileSync(new URL('../src/score-badge.css',import.meta.url),'utf8');
 assert.match(css,/\.badge-ring strong\{[^}]*font-size:12px/);
 assert.match(css,/\.badge-ring strong\.full\{font-size:11px/);
 assert.doesNotMatch(css,/stroke-width:3\.5/);
});

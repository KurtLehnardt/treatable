// Study summaries in the results list are read in full: nothing is sliced and no ellipsis stands in for missing text.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {StudySchema,searchStudies,profileFromForm,type Study} from '../src/core';import {StudyResults} from '../src/panel-results';import type {PanelController} from '../src/use-panel-controller';
const studies=JSON.parse(readFileSync(new URL('../../scaffold/data/studies.json',import.meta.url),'utf8')).map((x:unknown)=>StudySchema.parse(x)) as Study[];
const zips=JSON.parse(readFileSync(new URL('../../scaffold/data/us-zip-centroids.json',import.meta.url),'utf8'));
const withSummary=(briefSummary:string,id='NCT12345678'):Study=>({...studies[0],id,sourceUrl:`https://clinicaltrials.gov/study/${id}`,briefSummary});
const sentences=(count:number)=>Array.from({length:count},(_,i)=>`Sentence ${i+1} of the synthetic summary explains what happens in part ${i%5} of the study.`).join(' ');
const render=(rows:{study:Study;screen?:unknown}[],profile?:unknown)=>renderToStaticMarkup(React.createElement(StudyResults,{controller:{profile,rows} as unknown as PanelController}));

test('a 6,000+ character summary is rendered whole in a keyboard-reachable scroll region with no ellipsis',()=>{
  const summary=sentences(75);assert.ok(summary.length>6000);
  const page=render([{study:withSummary(summary)}]);
  assert.ok(page.includes(summary),'every character of the summary is on the page');
  assert.ok(!page.includes('…'));assert.ok(!page.includes('...'));
  assert.match(page,/<div class="summary summary-scroll" tabindex="0" role="region" aria-label="Full summary of NCT12345678">/);
});

test('the longest summary in the offline snapshot is complete on the page',()=>{
  const longest=studies.reduce((a,b)=>b.briefSummary.length>a.briefSummary.length?b:a);assert.ok(longest.briefSummary.length>4000);
  const escaped=renderToStaticMarkup(React.createElement('div',null,longest.briefSummary)).slice('<div>'.length,-'</div>'.length);
  const page=render([{study:longest}]);assert.ok(page.includes(escaped));assert.ok(!page.includes('…'));
});

test('a summary of ordinary length stays a plain paragraph, and a missing summary renders an empty one',()=>{
  const page=render([{study:withSummary('A short summary of the study.')},{study:withSummary('','NCT12345679')}]);
  assert.match(page,/<p class="summary">A short summary of the study\.<\/p>/);assert.match(page,/<p class="summary"><\/p>/);assert.doesNotMatch(page,/summary-scroll/);
});

test('summaries stay whole when the study is screened against a profile',()=>{
  const profile=profileFromForm({condition:'fibromyalgia',notes:'',age:'45',sex:'female',zip:'83702',radius:'25'},zips),summary=sentences(60);
  const study:Study={...withSummary(summary),conditions:['fibromyalgia'],keywords:[],briefTitle:'Fibromyalgia study',studyType:'INTERVENTIONAL',overallStatus:'RECRUITING'},rows=searchStudies([study],profile);
  assert.equal(rows.length,1);const page=render(rows,profile);assert.ok(page.includes(summary));assert.ok(!page.includes('…'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {OverlayView} from '../src/overlay-view';
import {FAILURE_COPY,GENERIC_FAILURE_COPY} from '../src/failures';

function overlay(overrides:Record<string,unknown>={}){
  const vm:any={connected:true,ended:false,busy:false,error:'',snapshot:{generation:'g',url:'https://clinicaltrials.gov/search?cond=asthma',nctIds:[],diagnostic:'',supported:true},records:[],opacity:.9,collapsed:false,setField(){},search(){},refresh(){},fetchRecords(){},setOpacity(){},setCollapsed(){},restore(){},openPrivate(){},close(){},...overrides};
  return renderToStaticMarkup(React.createElement(OverlayView,{vm}));
}

test('before the toolbar button is used, one sentence says what to click instead of a disabled form',()=>{
  const markup=overlay({connected:false});
  assert.match(markup,/<p role="status" class="notice">Click the Treatable button in the toolbar to start\.<\/p>/);
  assert.doesNotMatch(markup,/Waiting for secure toolbar activation/);
  for(const gone of [/<form/,/Search ClinicalTrials\.gov/,/<input/,/Which studies to show/,/ai-switch/])assert.doesNotMatch(markup,gone,`${gone}: nothing disabled is rendered`);
  assert.match(overlay({ended:true}),/Session ended\. Anything you typed here was cleared\. Click the Treatable button in the toolbar to start again\./);
});

test('the header carries no eyebrow or session line, and the footer no developer sentence',()=>{
  /* A guide stub, so a Replay intro button in the footer would render and fail this test. */
  const guide={active:false,canSearchHelp:false,replayIntro(){},startSearchHelp(){}};
  for(const markup of [overlay({connected:true,guide}),overlay({connected:false,guide}),overlay({ended:true,guide})]){
    assert.doesNotMatch(markup,/Your study companion/i);
    assert.doesNotMatch(markup,/session-line|Connected to this ClinicalTrials\.gov tab|Current results page|This study page/);
    assert.doesNotMatch(markup,/Raw profiles stay out of the website/);
    assert.doesNotMatch(markup,/Replay intro/,'Replay intro lives in settings, not in the footer');
  }
});

test('the AI-matched results switch is off by default, shows a one-line helper and always has its disclosure beside it',()=>{
  const on=overlay({setAiRanking(){},aiRanking:'on'}),off=overlay({setAiRanking(){},aiRanking:'off'}),unset=overlay({setAiRanking(){}});
  assert.match(on,/<input type="checkbox" role="switch"[^>]* checked=""/);assert.doesNotMatch(off,/role="switch"[^>]* checked/);assert.doesNotMatch(unset,/role="switch"[^>]* checked/,'no value means off');
  assert.match(on,/<small>Best matches first, with a match % on each card\.<\/small>/);
  assert.match(off,/<small>The website keeps its own order\.<\/small>/);
  /* Each word is checked against what is sent: rank-background.ts sends only condition terms (shared/rank-contract.mjs, at most six of at
   * most 80 characters), native/rank.mjs adds the public records of the studies on the page, and the local model sends nothing to OpenAI. */
  const openai='<p id="ai-switch-disclosure" class="ai-disclosure">Sends short condition words and the page’s public study records to OpenAI to sort results. Off unless you turn it on.</p>';
  for(const markup of [on,off,unset])assert.ok(markup.includes(openai),'the OpenAI disclosure is beside the switch');assert.match(off,/aria-describedby="ai-switch-disclosure"/);
  assert.ok(overlay({setAiRanking(){},provider:'local'}).includes('<p id="ai-switch-disclosure" class="ai-disclosure">Sorts results with the local model on this device. Nothing is sent to OpenAI.</p>'));
  assert.doesNotMatch(overlay({setAiRanking(){},collapsed:true}),/role="switch"|ai-switch-disclosure/,'collapsed, neither the switch nor its disclosure is shown');
});

// Every code in the table before the plain-language rewrite. None may be dropped.
const ALL_CODES=['NATIVE_HOST_MISSING','NATIVE_HOST_FORBIDDEN','NATIVE_HOST_DISCONNECTED','NATIVE_TIMEOUT','INVALID_NATIVE_REPLY','RESULT_MISMATCH','SESSION_ENDED','KEY_MISSING','KEY_REJECTED','API_PERMISSION','RATE_LIMITED','CONFIRMATION_CANCELLED','CANCELLED','API_ERROR','NETWORK_ERROR','INVALID_API_RESPONSE','INVALID_REQUEST','HELPER_VERSION_MISMATCH','BUSY','CONSENT_EXPIRED','INVALID_CONSENT_RECEIPT','PREVIEW_TOO_LARGE','INVALID_FIXTURE_STUDIES','INTERNAL_ERROR','INCOMPLETE_AGENT_TURN','RECORD_UNAVAILABLE','RECORD_MISMATCH','APPLY_EXPIRED','INVALID_APPLY_RECEIPT','NOT_STUDY_PAGE','USER_ACTIVATION_REQUIRED','GOV_NETWORK_ERROR','GOV_HTTP_ERROR','GOV_INVALID_RECORD','GOV_ID_MISMATCH','GOV_RECORD_TOO_LARGE','AGENT_FAILED','INVALID_AGENT_OUTPUT','TOOL_LIMIT','INVALID_TOOL_CALL','DUPLICATE_TOOL_CALL','OUTPUT_TOO_LARGE','INVALID_STREAM','INCOMPLETE_STREAM','CLEANUP_ERROR'];
// The codes whose copy told the person that nothing was sent. The reassurance must survive any rewording.
const NOT_SENT_COPY_CODES=['NATIVE_HOST_MISSING','NATIVE_HOST_FORBIDDEN','KEY_MISSING','CONFIRMATION_CANCELLED','INVALID_REQUEST','HELPER_VERSION_MISMATCH','BUSY','CONSENT_EXPIRED','INVALID_CONSENT_RECEIPT','PREVIEW_TOO_LARGE','INVALID_FIXTURE_STUDIES','APPLY_EXPIRED','INVALID_APPLY_RECEIPT','NOT_STUDY_PAGE','USER_ACTIVATION_REQUIRED','GOV_NETWORK_ERROR','GOV_HTTP_ERROR','GOV_INVALID_RECORD','GOV_ID_MISMATCH','GOV_RECORD_TOO_LARGE'];

test('failure copy keeps every code and no longer mentions the retired panel, fixtures or snapshot',()=>{
  for(const code of ALL_CODES)assert.ok(Object.hasOwn(FAILURE_COPY,code),`${code} is still in the table`);
  const copies:[string,string][]=[...Object.entries(FAILURE_COPY),['GENERIC_FAILURE_COPY',GENERIC_FAILURE_COPY]];
  for(const [code,text] of copies){
    assert.ok(text.length>20,`${code} has real copy`);
    assert.doesNotMatch(text,/fixture/i,`${code}: fixture`);
    assert.doesNotMatch(text,/blank session/i,`${code}: blank session`);
    assert.doesNotMatch(text,/offline study snapshot/i,`${code}: offline study snapshot`);
  }
});

test('every failure that said nothing was sent still says so',()=>{
  for(const code of NOT_SENT_COPY_CODES)assert.match(FAILURE_COPY[code],/nothing (new )?was sent/i,`${code} keeps its "nothing was sent" statement`);
});

/** Returns every font size declared in the stylesheet that resolves below `minimum` px, with the rule it came from. */
function fontSizesBelow(css:string,minimum:number):string[]{
  const KEYWORDS:Record<string,number>={'xx-small':9,'x-small':10,small:13,smaller:Number.NaN};
  const toPx=(amount:number,unit:string)=>unit==='px'?amount:unit==='pt'?amount*4/3:unit==='rem'||unit==='em'?amount*16:unit==='%'?amount*.16:Number.NaN;
  const found:string[]=[];
  const stripped=css.replace(/\/\*[\s\S]*?\*\//g,'');
  // The innermost blocks hold the declarations, including those inside @media.
  for(const block of stripped.matchAll(/([^{}]*)\{([^{}]*)\}/g)){
    const selector=block[1].trim();
    for(const declaration of block[2].split(';')){
      const colon=declaration.indexOf(':');
      if(colon<0)continue;
      const property=declaration.slice(0,colon).trim().toLowerCase();
      const value=declaration.slice(colon+1).replace(/!important/i,'').trim().toLowerCase();
      let px:number|undefined;
      if(property==='font-size'){
        const length=/^(\d*\.?\d+)(px|pt|rem|em|%)$/.exec(value);
        px=length?toPx(Number(length[1]),length[2]):Object.hasOwn(KEYWORDS,value)?KEYWORDS[value]:undefined;
      }else if(property==='font'){
        const length=/(?:^|\s)(\d*\.?\d+)(px|pt|rem|em|%)(?=\/|\s|$)/.exec(value);
        if(length)px=toPx(Number(length[1]),length[2]);
      }
      if(px!==undefined&&!(px>=minimum))found.push(`${selector} { ${property}: ${value} }`);
    }
  }
  return found;
}

test('the font-size check understands px, pt, rem, em, keywords and the font shorthand',()=>{
  assert.equal(fontSizesBelow('a{font-size:11px}b{font:500 9px/1.5 Georgia,serif}c{font-size:.5rem}d{font-size:x-small}@media(max-width:5px){e{font-size:10px!important}}',12).length,5);
  assert.deepEqual(fontSizesBelow('a{font-size:12px}b{font:bold 32px Georgia}c{font:inherit}d{font:12px/1.6 monospace}e{font-size:1rem}f{letter-spacing:.06em}',12),[]);
});

test('no text in the overlay stylesheet is smaller than 12px',()=>{
  const css=readFileSync(new URL('../src/overlay.css',import.meta.url),'utf8');
  assert.match(css,/font-size:\s*12px/,'the stylesheet was read');
  assert.deepEqual(fontSizesBelow(css,12),[]);
});

test('failure copy no longer promises a local search the overlay does not have',()=>{
  for(const [code,text] of [...Object.entries(FAILURE_COPY),['GENERIC_FAILURE_COPY',GENERIC_FAILURE_COPY]]){
    assert.doesNotMatch(text,/local search|local features/i,`${code}: local search`);
  }
  assert.doesNotMatch(FAILURE_COPY.NATIVE_HOST_MISSING,/Your questions/,'the reassurance is added by the study section only, where a draft exists');
});

test('the match percentage on a card badge is at least 12px',()=>{
  const css=readFileSync(new URL('../src/score-badge.css',import.meta.url),'utf8');
  assert.match(css,/\.badge-ring strong\{[^}]*font-size:1[23]px/,'the percentage rule was found');
  assert.deepEqual(fontSizesBelow(css,12),[]);
});

test('Your details says what is sent, when it is asked about, and that age band and sex stay on this device',async()=>{
  const {DetailsContext,sessionDetailsStore}=await import('../src/your-details');
  const {YourDetailsSettings}=await import('../src/your-details-view');
  const html=renderToStaticMarkup(React.createElement(DetailsContext.Provider,{value:sessionDetailsStore()},React.createElement(YourDetailsSettings,{})));
  const text=html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
  /* Turning the AI-matched results switch on is the consent (rank-background.ts checks the background's record before every helper call), so terms typed later go out only while it stays on. */
  assert.match(text,/Short condition words are sent to OpenAI only while AI-matched results is on\./);
  assert.doesNotMatch(text,/browser session|asks once|before the first ranking/i,'nothing about the removed confirmation');
  assert.match(text,/Age band and sex only sort results on this device\./);
  assert.match(text,/Nothing is sent when you use the local model\./);
  assert.match(text,/cleared when the session ends/);
  assert.doesNotMatch(text,/after you confirm/i,'it must not imply a confirmation for every send');
  const paragraph=(/<p>(.*?)<\/p>/.exec(html)?.[1]??'').replace(/<[^>]+>/g,'');
  assert.ok(paragraph.split('.').every(sentence=>sentence.trim().split(/\s+/).length<=20),'short sentences');
});

test('a connection error replaces the idle sentence, and the ended sentence says typed text was cleared',()=>{
  assert.match(overlay({connected:false,error:'This page could not be reached.'}),/<p role="alert" class="notice error">This page could not be reached\.<\/p>/);
  assert.match(overlay({ended:true}),/Anything you typed here was cleared/);
});

test('the tour and README no longer mention the removed Copy full email button, and Replay intro is placed in Settings',()=>{
  const steps=readFileSync(new URL('../src/guide-steps.ts',import.meta.url),'utf8'),readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');
  assert.doesNotMatch(steps,/Copy full email/);assert.doesNotMatch(readme,/Copy full email/);
  assert.match(steps,/Replay intro in Settings/);
  assert.match(steps,/Get my study summary/);
});

test('one name for the output: no patient-facing "brief" label is left on the study page',()=>{
  const view=readFileSync(new URL('../src/apply-view.tsx',import.meta.url),'utf8');
  for(const old of ['Generate study brief','Generating your study brief','Generate the brief again','Study review complete','Your study brief'])assert.ok(!view.includes(old),old);
});

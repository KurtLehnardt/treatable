import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {OverlayView} from '../src/overlay-view';
import {SITE_FILTERS} from '../src/site-filter-catalog';
import {FAILURE_COPY,GENERIC_FAILURE_COPY} from '../src/failures';

function overlay(overrides:Record<string,unknown>={}){
  const vm:any={connected:true,ended:false,busy:false,error:'',fields:{},catalog:SITE_FILTERS,snapshot:{generation:'g',url:'https://clinicaltrials.gov/search?cond=asthma',nctIds:[],diagnostic:'',supported:true},records:[],opacity:.9,collapsed:false,setField(){},search(){},refresh(){},fetchRecords(){},setOpacity(){},setCollapsed(){},restore(){},openPrivate(){},close(){},...overrides};
  return renderToStaticMarkup(React.createElement(OverlayView,{vm}));
}

test('before the toolbar button is used, the status line tells the person what to click',()=>{
  const markup=overlay({connected:false});
  assert.match(markup,/<span role="status">Click the Treatable button in the toolbar to start<\/span>/);
  assert.doesNotMatch(markup,/Waiting for secure toolbar activation/);
  assert.match(overlay({connected:true}),/<span role="status">Connected to this ClinicalTrials\.gov tab<\/span>/);
  assert.match(overlay({ended:true}),/<span role="status">Session ended<\/span>/);
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

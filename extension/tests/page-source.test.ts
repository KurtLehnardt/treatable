import test from 'node:test';import assert from 'node:assert/strict';
import {parsePageSource} from '../src/core';
import {boundedText,sanitizePageText,cutCodePoints} from '../src/validation';
import {readPage} from '../src/pageReader';
import {TRIAL_ORIGINS} from '../src/sites';
// L5 (poc-pagesource.out): harmless page quirks used to make a real study page "could not be safely read".
const url='https://clinicaltrials.gov/study/NCT06567886';
const LONE=/[\uD800-\uDFFF]/u;
const strict=(text:string,max:number,multiline=true)=>boundedText(text,'check',max,{multiline});
test('an emoji split by the 24,000-unit cut is dropped on a code-point boundary instead of refusing the page',()=>{
 const split=('a'.repeat(23999)+'\u{1F600} more text').slice(0,24000);assert.ok(/[\uD800-\uDBFF]$/.test(split));
 const source=parsePageSource({url,title:'Study',text:split});assert.equal(source.text,'a'.repeat(23999));assert.doesNotMatch(source.text,LONE);
 const long=parsePageSource({url,title:'Study',text:'b'.repeat(23999)+'\u{1F600}'+'c'.repeat(9000)});assert.equal(long.text,'b'.repeat(23999));
 const kept=parsePageSource({url,title:'Study',text:'Eligibility \u{1F600} ok'});assert.equal(kept.text,'Eligibility \u{1F600} ok');
 assert.equal(cutCodePoints('x\u{1F600}',2),'x');assert.equal(cutCodePoints('x\u{1F600}',3),'x\u{1F600}');assert.equal(cutCodePoints('',0),'');
});
test('bidi, C1, zero-width, tag and other default-ignorable characters are stripped, genuine Unicode is preserved',()=>{
 const source=parsePageSource({url,title:'Stu​dy ‫Title‬',text:'Investigator: ‫name‬\nPatient\u0085s eligibility​﻿­⁦x⁩\u{E0041}\u{E0042}\r\nSjögren’s syndrome; ألم \u{1F600} end\u0000\u001f\u007f'});
 assert.equal(source.title,'Study Title');
 assert.equal(source.text,'Investigator: name\nPatients eligibilityx\nSjögren’s syndrome; ألم \u{1F600}\nend');
 assert.doesNotThrow(()=>strict(source.text,24000));assert.doesNotThrow(()=>strict(source.title,400,false));
 for(const stray of ['\uD800','\uDC00x','x\uDBFF'])assert.doesNotMatch(parsePageSource({url,title:stray+'T',text:stray+'Study text'}).text,LONE);
});
test('overlong titles are truncated with an ellipsis; line breaks in titles become spaces',()=>{
 const title=parsePageSource({url,title:'T'.repeat(401),text:'Eligibility'}).title;assert.equal(title.length,400);assert.ok(title.endsWith('…'));assert.equal(title,'T'.repeat(399)+'…');
 assert.equal(parsePageSource({url,title:'T'.repeat(400),text:'Eligibility'}).title,'T'.repeat(400));
 const emoji=parsePageSource({url,title:'T'.repeat(398)+'\u{1F600}\u{1F600}',text:'x'}).title;assert.doesNotMatch(emoji,LONE);assert.ok(emoji.length<=400);
 assert.equal(parsePageSource({url,title:'Line one\n\tLine two',text:'x'}).title,'Line one Line two');
 assert.equal(parsePageSource({url,text:'x'}).title,'Current page');
 assert.doesNotThrow(()=>strict(title,400,false));
});
test('wrong origins, non-string fields and structurally invalid results are still refused, without echoing page text',()=>{
 for(const bad of ['https://clinicaltrials.gov.evil.example/study/NCT06567886','http://clinicaltrials.gov/study/NCT06567886','https://example.org/','javascript:alert(1)','https://user:pw@clinicaltrials.gov/'])assert.throws(()=>parsePageSource({url:bad,title:'x',text:'y'}),bad);
 for(const value of [null,undefined,'text',[],[url],new Map([['url',url]]),{url,title:'x',text:'y',extra:'SyntheticPrivateName'}])assert.throws(()=>parsePageSource(value),(error:any)=>!/SyntheticPrivateName/.test(error.message));
 for(const text of [42,{},['a'],new String('SyntheticPrivateName'),null,undefined,'x'.repeat(100001),'​\u0000 '])assert.throws(()=>parsePageSource({url,title:'x',text}),(error:any)=>!/SyntheticPrivateName/.test(error.message));
 for(const title of [42,{},['a'],null,new String('t'),'t'.repeat(100001)])assert.throws(()=>parsePageSource({url,title,text:'Study text'}));
 assert.throws(()=>parsePageSource({url,title:'x',text:'y',nctId:'NCT00000001'}));assert.throws(()=>parsePageSource({url,title:'x',text:'y',kind:'other'}));
 assert.throws(()=>sanitizePageText({toString:()=>'x'},'x',10));
});
test('getters are read exactly once, so a field cannot pass the type check and then change type',()=>{
 let reads=0;const value={url,title:'Study',get text(){reads++;return reads===1?'Study text':{length:1,slice:()=>'SyntheticPrivateName'}}};
 assert.equal(parsePageSource(value).text,'Study text');assert.equal(reads,1);
 let titleReads=0;const flip={url,get title(){titleReads++;return titleReads===1?{}:'ok'},text:'Study text'};assert.throws(()=>parsePageSource(flip));
});
function runReader(text:string,selection=''){const keys=['window','document','location','NodeFilter','getComputedStyle'];const previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));const article={nodeType:1,closest:()=>null};let index=0;const nodes=[{parentElement:article,textContent:text}];const values:any={window:{getSelection:()=>selection?{rangeCount:1,toString:()=>selection,anchorNode:{nodeType:3,parentElement:article},focusNode:{nodeType:3,parentElement:article},getRangeAt:()=>({intersectsNode:()=>false})}:null},document:{title:'Study',body:{},activeElement:article,querySelectorAll:()=>[],createTreeWalker:()=>({nextNode:()=>nodes[index++]})},location:{origin:TRIAL_ORIGINS[0],href:TRIAL_ORIGINS[0]+'/study/NCT06567886'},NodeFilter:{SHOW_TEXT:4},getComputedStyle:()=>({display:'block',visibility:'visible'})};try{for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:values[key]});return readPage([...TRIAL_ORIGINS])}finally{keys.forEach((key,i)=>{const old=previous[i];if(old)Object.defineProperty(globalThis,key,old);else Reflect.deleteProperty(globalThis,key)})}}
test('the injected page reader cuts DOM and selection text on a code-point boundary',()=>{
 const dom=runReader('a'.repeat(23999)+'\u{1F600}tail');assert.equal(dom.text,'a'.repeat(23999));assert.doesNotMatch(dom.text,LONE);assert.equal(parsePageSource(dom).text,'a'.repeat(23999));
 const picked=runReader('unused','s'.repeat(23999)+'\u{1F600}tail');assert.equal(picked.text,'s'.repeat(23999));
 assert.equal(runReader('Visible \u{1F600} study').text,'Visible \u{1F600} study\n');
});

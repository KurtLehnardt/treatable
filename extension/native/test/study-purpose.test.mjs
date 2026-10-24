// The study purpose (brief summary) must reach the patient and the review whole: long text is split into consecutive exact excerpts, never cut short.
import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeStudyBrief,splitExcerpt,studyPurposeText,PURPOSE_MAX_EXCERPTS} from '../../shared/apply-record.mjs';
import {parsePublicStudyBrief,STUDY_BRIEF_MAX_BYTES} from '../../shared/apply-contract.mjs';
import {parseBriefAgentOutput,buildBriefDecisionsRequest,PreparedStudyBriefStore} from '../study-brief.mjs';
import {utf8Bytes} from '../../shared/demo-contract.mjs';

const FIELD='protocolSection.descriptionModule.briefSummary';
// Distinct numbered sentences, so a dropped, repeated or reordered part is detected.
const sentences=count=>Array.from({length:count},(_,i)=>`Sentence ${i+1} of the synthetic purpose describes what participants in group ${i%7} will be asked to do.`).join(' ');
const raw=(purpose,extra={})=>({protocolSection:{identificationModule:{nctId:'NCT99999990',briefTitle:'Synthetic long purpose'},descriptionModule:{briefSummary:purpose,detailedDescription:'Two treatments are spaced 4 weeks apart. Follow-up visits occur at 3 and 12 months post injection.',...extra},designModule:{designInfo:{allocation:'RANDOMIZED',maskingInfo:{masking:'SINGLE'}}},statusModule:{overallStatus:'RECRUITING'},eligibilityModule:{eligibilityCriteria:'Inclusion Criteria:\n* Age 18 or older\nExclusion Criteria:\n* Pregnancy'},contactsLocationsModule:{}}});
const purposeItems=brief=>brief.items.filter(i=>i.field===FIELD);

test('splitExcerpt keeps every word, cuts at sentence ends and stays within both limits',()=>{
  const purpose=sentences(80),parts=splitExcerpt(purpose);
  assert.ok(purpose.length>6000&&parts.length>=4);
  for(const part of parts){assert.ok(part.length<=1800&&utf8Bytes(part)<=2100);assert.equal(part,part.trim());assert.ok(purpose.includes(part),'each part is an exact substring');assert.ok(part.endsWith('.'),'cut at a sentence end')}
  assert.equal(parts.join(' '),purpose,'nothing dropped, repeated or reordered');
});

test('splitExcerpt treats a line break as a boundary when lines carry no sentence punctuation',()=>{
  const text=Array.from({length:200},(_,i)=>`Line ${i} has no ending punctuation`).join('\n'),parts=splitExcerpt(text);
  assert.ok(parts.length>=3);assert.equal(parts.join('\n'),text);assert.ok(parts.every(p=>p.split('\n').every(line=>/^Line \d+ has no ending punctuation$/.test(line))),'no line is split');
});

test('splitExcerpt falls back to spaces for text without sentence ends and to a hard cut only when there is no space',()=>{
  const words=Array.from({length:3000},(_,i)=>`word${i}`).join(' '),parts=splitExcerpt(words);
  assert.ok(parts.every(p=>p.length<=1800&&!/^\s|\s$/.test(p)));assert.equal(parts.join(' '),words,'cut only at spaces, so no word is split');
  const solid='x'.repeat(5000),hard=splitExcerpt(solid);assert.deepEqual(hard.map(p=>p.length),[1800,1800,1400]);assert.equal(hard.join(''),solid);
});

test('splitExcerpt respects the byte limit for multibyte text and never splits a surrogate pair',()=>{
  const text=`${'日本語のテキスト。'.repeat(400)}${'😀'.repeat(900)}`,parts=splitExcerpt(text);
  assert.ok(parts.length>2);for(const part of parts){assert.ok(utf8Bytes(part)<=2100&&part.length<=1800);assert.ok(part.isWellFormed())}
  assert.equal(parts.join(''),text);
});

test('splitExcerpt returns nothing for empty or non-text input and one trimmed part for short text',()=>{
  assert.deepEqual(splitExcerpt(''),[]);assert.deepEqual(splitExcerpt('   \n '),[]);assert.deepEqual(splitExcerpt(undefined),[]);assert.deepEqual(splitExcerpt(5),[]);
  assert.deepEqual(splitExcerpt('  A short purpose.  '),['A short purpose.']);
});

test('a 6,000+ character purpose becomes consecutive exact excerpts within the existing budgets, with no ellipsis',()=>{
  const purpose=sentences(70);assert.ok(purpose.length>6000&&purpose.length<=PURPOSE_MAX_EXCERPTS*1800);
  const brief=normalizeStudyBrief(raw(purpose),1),excerpts=purposeItems(brief);
  assert.ok(excerpts.length>=4&&excerpts.length<=PURPOSE_MAX_EXCERPTS);
  assert.deepEqual(excerpts.map(i=>i.id),excerpts.map((_,i)=>`e${i+1}`),'purpose excerpts come first and are consecutive');
  for(const item of excerpts){assert.equal(item.category,'overview');assert.equal(item.label,'Study purpose');assert.ok(item.text.length<=1800&&utf8Bytes(item.text)<=2100,'per-item cap is unchanged');assert.ok(purpose.includes(item.text),'exact substring of the record');assert.ok(!/…|\.\.\./.test(item.text))}
  assert.equal(excerpts.map(i=>i.text).join(' '),purpose,'the excerpts together are the whole purpose');
  assert.ok(brief.items.length<=36&&utf8Bytes(brief)<=20*1024&&utf8Bytes(brief)<=STUDY_BRIEF_MAX_BYTES,'per-brief budget is unchanged');
  assert.ok(brief.items.some(i=>i.text==='Two treatments are spaced 4 weeks apart.'),'the other source facts are still present');
  assert.doesNotThrow(()=>parsePublicStudyBrief(brief));
});

test('a purpose above the payload ceiling stays bounded in the brief while the local text is complete',()=>{
  const purpose=sentences(230);assert.ok(purpose.length>20000);
  const brief=normalizeStudyBrief(raw(purpose),1),excerpts=purposeItems(brief);
  assert.equal(excerpts.length,PURPOSE_MAX_EXCERPTS);assert.ok(utf8Bytes(brief)<=20*1024);assert.doesNotThrow(()=>parsePublicStudyBrief(brief));
  assert.ok(excerpts.every(i=>purpose.includes(i.text)));assert.equal(excerpts.map(i=>i.text).join(' '),purpose.slice(0,excerpts.map(i=>i.text).join(' ').length),'the payload holds the leading part of the purpose');
  assert.equal(studyPurposeText(raw(purpose)),purpose,'the display text is never shortened');
});

test('a short purpose is still one unchanged excerpt',()=>{
  const brief=normalizeStudyBrief(raw('A synthetic controlled study.'),1);
  assert.deepEqual(purposeItems(brief).map(i=>[i.id,i.label,i.text]),[['e1','Study purpose','A synthetic controlled study.']]);
});

test('studyPurposeText returns the sanitized whole summary, or an empty string when the record has none',()=>{
  assert.equal(studyPurposeText(raw('Line one.\r\n\r\n\r\nLine​ two.')),'Line one.\n\nLine two.');
  assert.equal(studyPurposeText(raw(undefined)),'');assert.equal(studyPurposeText(null),'');assert.equal(studyPurposeText({}),'');assert.equal(studyPurposeText(raw(42)),'');
  const brief=normalizeStudyBrief(raw('Line one.\r\n\r\n\r\nLine​ two.'),1);assert.equal(purposeItems(brief).map(i=>i.text).join(' '),'Line one.\n\nLine two.');
});

test('a long purpose on a large record keeps the whole brief within its budget with the purpose first',()=>{
  const purpose=sentences(70),sentence=i=>`Participants in cohort ${i} attend clinic visits every 4 weeks for assessments, ${'including blood draws, imaging and questionnaires '.repeat(8)}until week 52.`;
  const record=raw(purpose,{detailedDescription:Array.from({length:10},(_,i)=>sentence(i)).join(' ')});
  record.protocolSection.armsInterventionsModule={armGroups:Array.from({length:4},(_,i)=>({label:'Arm '+i,description:'Participants receive study drug or matching placebo by injection. '.repeat(8)}))};
  record.protocolSection.eligibilityModule.eligibilityCriteria='Inclusion Criteria:\n\n'+Array.from({length:8},(_,i)=>'* Criterion '+i+' with a moderately long description of the requirement.').join('\n');
  const brief=normalizeStudyBrief(record,1);
  assert.ok(utf8Bytes(brief)<=20*1024&&brief.items.length<=36);assert.doesNotThrow(()=>parsePublicStudyBrief(brief));
  assert.deepEqual(purposeItems(brief).map(i=>i.id),['e1','e2','e3','e4']);assert.equal(purposeItems(brief).map(i=>i.text).join(' '),purpose,'trimming from the end never touches the purpose');
});

test('exact-quote matching still works on a split purpose: one whole excerpt is accepted, the joined purpose or a paraphrase is not',()=>{
  const brief=normalizeStudyBrief(raw(sentences(70)),1),[first,second]=purposeItems(brief);
  const plan=claims=>JSON.stringify({studies:[{nctId:brief.nctId,claims,questionIds:['still_enrolling','visits','next_steps'],prescreenIds:['diagnosis_details','prior_treatments'],flagIds:[],questionEvidence:['still_enrolling','visits','next_steps'].map(questionId=>({questionId,evidenceIds:[]}))}]});
  const claim=item=>({category:item.category,text:item.text,evidenceIds:[item.id],sourceQuotes:[item.text]});
  assert.equal(parseBriefAgentOutput(plan([claim(first),claim(second)]),[brief])[0].claims.length,2);
  const joined=`${first.text} ${second.text}`;
  assert.throws(()=>parseBriefAgentOutput(plan([{...claim(first),text:joined,sourceQuotes:[joined]}]),[brief]),{code:'INVALID_AGENT_OUTPUT'});
  assert.throws(()=>parseBriefAgentOutput(plan([{...claim(first),text:first.text.slice(0,200)}]),[brief]),{code:'INVALID_AGENT_OUTPUT'});
});

test('two selected studies with long purposes still prepare and pin briefs inside the per-brief and message budgets',async()=>{
  const purpose=sentences(70),store=new PreparedStudyBriefStore({fetchRecord:async id=>{const record=raw(purpose);record.protocolSection.identificationModule.nctId=id;return record}});
  try{
    const prepared=await store.prepare(['NCT99999990','NCT99999991']),pinned=store.take({token:prepared.token,digest:prepared.digest});
    assert.equal(pinned.briefs.length,2);
    for(const brief of pinned.briefs){assert.ok(utf8Bytes(brief)<=20*1024);assert.equal(purposeItems(brief).map(i=>i.text).join(' '),purpose)}
    assert.ok(utf8Bytes(prepared)<96*1024-1024);
    const ids=['still_enrolling','visits','next_steps'],decisions=buildBriefDecisionsRequest(pinned.briefs,pinned.briefs.map(b=>({nctId:b.nctId,questionIds:ids,questionEvidence:ids.map(questionId=>({questionId,evidenceIds:[]}))}))),body=JSON.stringify(decisions);
    assert.ok(utf8Bytes(decisions)<96*1024,'the Decisions request stays within the message limit');
    for(const brief of pinned.briefs)for(const item of purposeItems(brief))assert.ok(body.includes(JSON.stringify(item.text).slice(1,-1)),'each excerpt is sent exactly as pinned');
  }finally{store.clear()}
});

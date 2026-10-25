import test from'node:test';import assert from'node:assert/strict';
import{normalizeStudyBrief}from'../../shared/apply-record.mjs';import{parsePublicStudyBrief,parseApplyRequest}from'../../shared/apply-contract.mjs';
export const syntheticRaw=()=>({protocolSection:{identificationModule:{nctId:'NCT99999990',briefTitle:'Synthetic source fixture; not an identified registry study',orgStudyIdInfo:{id:'SYNTHETIC-ONLY'}},descriptionModule:{briefSummary:'A synthetic example of a controlled platelet study.',detailedDescription:'Two treatments are spaced 4 weeks apart. Follow-up visits occur at 3 and 12 months post injection. Randomization is 2:1 between treatment and sham. Control participants can cross over after 3-month follow-up.'},designModule:{designInfo:{allocation:'RANDOMIZED',maskingInfo:{masking:'SINGLE'}}},statusModule:{overallStatus:'RECRUITING'},eligibilityModule:{},contactsLocationsModule:{}}});
test('source brief preserves exact timeline, sham and possible crossover excerpts without inventing missing criteria',()=>{const b=normalizeStudyBrief(syntheticRaw(),1);assert.equal(b.nctId,'NCT99999990');assert.ok(b.items.some(x=>x.text==='Two treatments are spaced 4 weeks apart.'));assert.ok(b.items.some(x=>/3 and 12 months/.test(x.text)));assert.ok(b.items.some(x=>/2:1/.test(x.text)));assert.ok(b.items.some(x=>/can cross over/.test(x.text)));assert.ok(b.unknowns.some(x=>/eligibility criteria/.test(x)));assert.equal(b.claims.length,0);assert.ok(b.items.every(x=>x.sourceUrl==='https://clinicaltrials.gov/study/NCT99999990'));});
test('source-only protocol refuses patient fields, non-NCT IDs, unknown references and invented quotes',()=>{assert.throws(()=>parseApplyRequest({id:'x',type:'prepareStudyBrief',payload:{nctIds:['RGX2021-01']}}));assert.throws(()=>parseApplyRequest({id:'x',type:'prepareStudyBrief',payload:{nctIds:['NCT99999990'],name:'Patient'}}));const b=normalizeStudyBrief(syntheticRaw(),1);assert.throws(()=>parsePublicStudyBrief({...b,claims:[{id:'claim1',category:'timeline',text:'A summary',evidenceIds:['e99'],sourceQuotes:['A fabricated quote']}]}));});
import{PreparedStudyBriefStore,runPreparedStudyBrief,parseBriefAgentOutput,parseBriefDecisions,selectedStudyArgument,STUDY_BRIEF_TOOL}from'../study-brief.mjs';import{ApiError}from'../transport.mjs';
const routeValues=['answered_by_record','ask_patient','ask_coordinator'];
function agentPlan(brief){const e=brief.items.find(x=>x.text==='Two treatments are spaced 4 weeks apart.');return{nctId:brief.nctId,claims:[{category:'timeline',text:e.text,evidenceIds:[e.id],sourceQuotes:[e.text]}],questionIds:['still_enrolling','visits','next_steps'],prescreenIds:['diagnosis_details','prior_treatments'],flagIds:[],questionEvidence:['still_enrolling','visits','next_steps'].map(questionId=>({questionId,evidenceIds:[]}))};}
// actionArguments replaces the tool-call arguments; answer(question) replaces the Decisions answer; plan(brief) replaces the Agent's output for a study.
const wire=a=>({choice:a.choice,confidence:a.confidence,probabilities:[...routeValues].reverse().map(value=>({value,probability:a.probabilities[value]}))});
function scripted(briefs,{agentFailure=false,decisionFailure=false,skipTool=false,actionArguments,answer,plan=agentPlan}={}){const calls=[];return{mode:'test',calls,async request(method,url,body){calls.push({method,url,body:structuredClone(body)});if(url==='/v1/decisions'){if(decisionFailure)throw new ApiError('RATE_LIMITED');return{answers:body.questions.map(q=>answer?{type:'choice',name:q.name,...wire(answer(q))}:({type:'choice',name:q.name,choice:'answered_by_record',confidence:.8,probabilities:routeValues.map(value=>({value,probability:value==='answered_by_record'?1:0}))}))}}if(method==='DELETE')return{id:'sess_brief',deleted:true,object:'agent.session.deleted'};if(method==='GET')return{id:'sess_brief',required_actions:(actionArguments??briefs.map(b=>({nctId:b.nctId}))).map((args,i)=>({type:'function_call',turn_id:'turn_a',call_id:`call_${i}`,name:STUDY_BRIEF_TOOL,arguments:args}))};if(url.endsWith('/events'))return{};if(agentFailure)throw new ApiError('API_PERMISSION');return(async function*(){yield{type:'agent.session.created',session:{id:'sess_brief'}};if(!skipTool)yield{type:'agent.session.requires_action'};yield{type:'agent.session.turn.output_text.done',text:JSON.stringify({studies:briefs.map(plan)})};yield{type:'agent.session.turn.completed'};})();}};}
async function prepared(){const s=new PreparedStudyBriefStore({fetchRecord:async id=>{const raw=syntheticRaw();raw.protocolSection.identificationModule.nctId=id;return raw}}),p=await s.prepare(['NCT99999990','NCT99999991']);return{s,p,pin:s.take({token:p.token,digest:p.digest})};}
test('public1–2 pipeline requires actual selected-study tool calls, validates citedclaims and runs one Decisions call',async()=>{const{s,p,pin}=await prepared();try{const transport=scripted(pin.briefs),trace=[];const r=await runPreparedStudyBrief(transport,pin,{onTrace:x=>trace.push(x)});assert.equal(r.agentStatus,'complete');assert.equal(r.decisionStatus,'complete');assert.equal(r.toolCalls,2);assert.equal(r.cleanup,'deleted');assert.equal(r.briefs[0].claims[0].text,'Two treatments are spaced 4 weeks apart.');assert.ok(r.studyPlans.every(p=>p.routes.every(q=>q.route==='ask_coordinator')),'uncited answered routes downgraded');assert.ok(r.studyPlans.every(p=>p.prioritizedQuestionIds.length<=3));assert.equal(transport.calls.filter(c=>c.url==='/v1/decisions').length,1);assert.equal(transport.calls.filter(c=>c.url==='/v1/agents/sessions'&&c.method==='POST').length,1);assert.ok(!JSON.stringify([transport.calls,trace]).includes('PATIENT_CANARY'));assert.throws(()=>s.take({token:p.token,digest:p.digest}),{code:'INVALID_APPLY_RECEIPT'});}finally{s.clear();}});
test('partial Agent or Decisions failures preserve verifiedfacts and clearlylabel failure, never synthetic success',async()=>{for(const options of[{agentFailure:true},{decisionFailure:true},{skipTool:true}]){const{s,pin}=await prepared();try{const r=await runPreparedStudyBrief(scripted(pin.briefs,options),pin);assert.equal(r.agentStatus,options.decisionFailure?'complete':'failed');assert.equal(r.decisionStatus,options.decisionFailure?'failed':'complete');assert.ok(r.failureCodes.length);assert.ok(r.briefs[0].items.length);if(!options.decisionFailure)assert.equal(r.briefs[0].claims.length,0);}finally{s.clear();}}});
test('claim provenance guards reject fabricatednumbers, wrongquotes, outcome-only visit claims, strongeranchors and guaranteedcrossover',()=>{const b=normalizeStudyBrief(syntheticRaw(),1),p=agentPlan(b),e=b.items.find(x=>/can cross over/.test(x.text));for(const text of['Treatments are spaced 8 weeks apart.','You will receive the study treatment.','Visits occur after the second treatment.'])assert.throws(()=>parseBriefAgentOutput(JSON.stringify({studies:[{...p,claims:[{...p.claims[0],text}]}]}),[b]),{code:'INVALID_AGENT_OUTPUT'});assert.throws(()=>parseBriefAgentOutput(JSON.stringify({studies:[{...p,claims:[{category:'design',text:'Crossover is guaranteed.',evidenceIds:[e.id],sourceQuotes:[e.text]}]}]}),[b]));assert.equal(selectedStudyArgument({nctId:b.nctId,prompt:'PATIENT_CANARY'},[b.nctId]),undefined);assert.equal(selectedStudyArgument({nctId:'NCT99999991'},[b.nctId]),undefined);});
test('expiry/revoke and invalidpreparedselection never broaden publicauthority',async()=>{let clock=0;const s=new PreparedStudyBriefStore({now:()=>clock,fetchRecord:async()=>syntheticRaw()});try{const p=await s.prepare(['NCT99999990']);clock=300001;assert.throws(()=>s.take({token:p.token,digest:p.digest}),{code:'APPLY_EXPIRED'});await assert.rejects(s.prepare(['RGX2021-01']));await assert.rejects(s.prepare(['NCT99999991']),{code:'RECORD_UNAVAILABLE'});}finally{s.clear();}});
import{installHost,writeHook,startHost,readLines}from'./host-harness.mjs';import{rm,readFile}from'node:fs/promises';import{parseApplyReply}from'../../shared/apply-contract.mjs';
test('stdio source-only prepare→Agenttool→Decisions pipeline handles selected2, rejects privatecanary and neverbroadens liveauthority',async()=>{const installed=await installHost('treatable-brief-stdio-');let host;try{const ids=['NCT99999990','NCT99999991'],raws=ids.map(nctId=>{const r=syntheticRaw();r.protocolSection.identificationModule.nctId=nctId;return r}),briefs=raws.map(r=>normalizeStudyBrief(r,1));const hook=await writeHook(installed.home,{log:installed.log,govRecords:Object.fromEntries(ids.map((id,i)=>[id,raws[i]])),briefOutput:JSON.stringify({studies:briefs.map(agentPlan)})});host=startHost(installed,{hook});const rejected=await host.call({id:'private',type:'prepareStudyBrief',payload:{nctIds:ids,patient:{name:'PATIENT_CANARY',history:'PRIVATE_HISTORY_CANARY'}}});assert.equal(rejected.code,'INVALID_REQUEST');assert.equal((await readLines(installed.log)).length,0);const prep=await host.call({id:'prep',type:'prepareStudyBrief',payload:{nctIds:ids}});parseApplyReply(prep,'prep');assert.equal(prep.ok,true,prep.code);assert.equal(prep.result.records.length,2);assert.equal((await readLines(installed.log)).filter(x=>x.host==='api.openai.com').length,0);let reads='';try{reads=await readFile(installed.reads,'utf8')}catch{}assert.equal(reads,'','public preparation never reads any real or fake key');const result=await host.call({id:'run',type:'executeStudyBrief',payload:{token:prep.result.token,digest:prep.result.digest}});parseApplyReply(result,'run');assert.equal(result.ok,true,result.code);assert.equal(result.result.agentStatus,'complete');assert.equal(result.result.decisionStatus,'complete');assert.equal(result.result.toolCalls,2);const logged=await readLines(installed.log),calls=logged.filter(x=>x.host==='api.openai.com');assert.equal(calls.filter(x=>x.path==='/v1/agents/sessions'&&x.method==='POST').length,1);assert.equal(calls.filter(x=>x.path==='/v1/decisions').length,1);assert.ok(calls.every(x=>x.auth));const serialized=JSON.stringify([calls,host.frames,host.stderr()]);assert.ok(!serialized.includes('PATIENT_CANARY')&&!serialized.includes('PRIVATE_HISTORY_CANARY'));assert.equal((await host.call({id:'again',type:'executeStudyBrief',payload:{token:prep.result.token,digest:prep.result.digest}})).code,'INVALID_APPLY_RECEIPT');host.child.stdin.end();await host.exit;host=undefined;}finally{host?.child.kill('SIGKILL');await rm(installed.home,{recursive:true,force:true})}});
test('criterion excerpts retain inclusion/exclusion context and flipped requirements cannot be approved as claims',()=>{const raw=syntheticRaw();raw.protocolSection.eligibilityModule.eligibilityCriteria='Inclusion Criteria:\nLumbar pain\nExclusion Criteria:\nPrior lumbar surgery';const b=normalizeStudyBrief(raw,1),ex=b.items.find(x=>x.context==='exclusion');assert.equal(ex.text,'Exclusion Criteria:\nPrior lumbar surgery');assert.match(ex.label,/Exclusion/);const p=agentPlan(b);assert.throws(()=>parseBriefAgentOutput(JSON.stringify({studies:[{...p,claims:[{category:'eligibility',text:'Participants must have prior lumbar surgery.',evidenceIds:[ex.id],sourceQuotes:[ex.text]}]}]}),[b]),{code:'INVALID_AGENT_OUTPUT'});const copied={category:ex.category,text:ex.text,evidenceIds:[ex.id],sourceQuotes:[ex.text]};assert.equal(parseBriefAgentOutput(JSON.stringify({studies:[{...p,claims:[copied]}]}),[b])[0].claims[0].text,ex.text);});
test('exact fragment authority rejects reanchored followup and strengthened crossover regardless of valid citations',()=>{const b=normalizeStudyBrief(syntheticRaw(),1),p=agentPlan(b);for(const[source,rewrite]of[[/post injection/,'Follow-up visits happen after your last injection.'],[/can cross over/,'Control participants receive treatment after follow-up.'],[/can cross over/,'Control participants will receive treatment.']]){const e=b.items.find(x=>source.test(x.text));assert.throws(()=>parseBriefAgentOutput(JSON.stringify({studies:[{...p,claims:[{category:e.category,text:rewrite,evidenceIds:[e.id],sourceQuotes:[e.text]}]}]}),[b]),{code:'INVALID_AGENT_OUTPUT'});}assert.ok(b.unknowns.some(x=>/which treatment each interval/.test(x)));});
test('registry estimates preserve type and do not masquerade as participant schedule or outcomes visits',()=>{const raw=syntheticRaw();delete raw.protocolSection.descriptionModule;raw.protocolSection.statusModule.startDateStruct={date:'2027-01-01',type:'ESTIMATED'};raw.protocolSection.statusModule.primaryCompletionDateStruct={date:'2028-01-01',type:'ACTUAL'};raw.protocolSection.outcomesModule={primaryOutcomes:[{timeFrame:'3 months'}]};const b=normalizeStudyBrief(raw,1);assert.ok(b.items.some(x=>x.context==='registry_milestone'&&x.dateType==='ESTIMATED'&&/estimated/.test(x.label)));assert.ok(b.items.some(x=>x.context==='registry_milestone'&&x.dateType==='ACTUAL'));assert.ok(!b.items.some(x=>x.context==='participant_schedule'));assert.ok(b.unknowns.some(x=>/does not give a clear participation timeline/.test(x)));});
import{utf8Bytes,isRecord,MAX_MESSAGE_BYTES}from'../../shared/demo-contract.mjs';import{STUDY_BRIEF_MAX_BYTES,parseStudyBriefResult,traceBody,redactKeyLike,redactedTraceBody,redactedTraceBodyCost}from'../../shared/apply-contract.mjs';import{briefDecisionAnswers}from'../study-brief.mjs';import{encodeMessage}from'../core.mjs';
// A record whose brief nears the per-study size cap, for the oversized-body tests.
const sentence=i=>`Participants in cohort ${i} attend clinic visits every 4 weeks for assessments, ${'including blood draws, imaging and questionnaires '.repeat(8)}until week 52.`;
const largeRaw=id=>({protocolSection:{identificationModule:{nctId:id,briefTitle:'Synthetic large record'},descriptionModule:{briefSummary:'This is a randomized, placebo-controlled study. '.repeat(30),detailedDescription:Array.from({length:10},(_,i)=>sentence(i)).join(' ')},designModule:{designInfo:{allocation:'RANDOMIZED',interventionModel:'PARALLEL',primaryPurpose:'TREATMENT',maskingInfo:{masking:'DOUBLE'}}},armsInterventionsModule:{armGroups:Array.from({length:4},(_,i)=>({label:'Arm '+i,description:'Participants receive study drug or matching placebo by subcutaneous injection. '.repeat(8)}))},statusModule:{overallStatus:'RECRUITING',startDateStruct:{date:'2025-01-01',type:'ACTUAL'}},eligibilityModule:{minimumAge:'18 Years',sex:'ALL',eligibilityCriteria:'Inclusion Criteria:\n\n'+Array.from({length:8},(_,i)=>'* Criterion '+i+' with a moderately long description of the requirement.').join('\n')},contactsLocationsModule:{}}});
test('a detailed record with eight exact claims keeps the claims that fit instead of discarding completed Agent and Decisions work',async()=>{
 const s=new PreparedStudyBriefStore({fetchRecord:async id=>largeRaw(id)});
 try{const p=await s.prepare(['NCT99999990']),pin=s.take({token:p.token,digest:p.digest}),b=pin.briefs[0];assert.ok(utf8Bytes(b)>16000,'fixture is a large brief');
  const picks=b.items.filter(i=>i.category==='timeline'||i.category==='design').slice(0,8);assert.equal(picks.length,8);
  const out={studies:[{nctId:b.nctId,claims:picks.map(e=>({category:e.category,text:e.text,evidenceIds:[e.id],sourceQuotes:[e.text]})),questionIds:['still_enrolling','visits','next_steps'],prescreenIds:['diagnosis_details','prior_treatments'],flagIds:[],questionEvidence:['still_enrolling','visits','next_steps'].map(questionId=>({questionId,evidenceIds:[]}))}]};
  const transport={mode:'test',async request(method,url,body){if(url==='/v1/decisions')return{answers:body.questions.map(q=>({type:'choice',name:q.name,choice:'ask_coordinator',confidence:.8,probabilities:routeValues.map(value=>({value,probability:value==='ask_coordinator'?1:0}))}))};if(method==='DELETE')return{id:'sess_large',deleted:true,object:'agent.session.deleted'};if(method==='GET')return{id:'sess_large',required_actions:[{type:'function_call',turn_id:'turn_a',call_id:'call_0',name:STUDY_BRIEF_TOOL,arguments:{nctId:b.nctId}}]};if(url.endsWith('/events'))return{};return(async function*(){yield{type:'agent.session.created',session:{id:'sess_large'}};yield{type:'agent.session.requires_action'};yield{type:'agent.session.turn.output_text.done',text:JSON.stringify(out)};yield{type:'agent.session.turn.completed'};})()}};
  const r=await runPreparedStudyBrief(transport,pin);
  assert.equal(r.agentStatus,'complete');assert.equal(r.decisionStatus,'complete');assert.deepEqual(r.failureCodes,[]);
  const claims=r.briefs[0].claims;assert.ok(claims.length>0&&claims.length<8,'claims are trimmed to the budget, not dropped entirely');
  assert.ok(utf8Bytes(r.briefs[0])<=STUDY_BRIEF_MAX_BYTES);claims.forEach((c,i)=>{assert.equal(c.id,`claim${i+1}`);assert.equal(c.text,picks[i].text)});
 }finally{s.clear()}
});
test('key, bare and colon eligibility headings switch context and are quoted in their source wording',()=>{
 const brief=criteria=>{const raw=syntheticRaw();raw.protocolSection.eligibilityModule.eligibilityCriteria=criteria;return normalizeStudyBrief(raw,1).items.filter(x=>x.category==='eligibility'&&x.context)};
 const keyed=brief('Inclusion Criteria:\n\n* Age 18 or older\n\nKey Exclusion Criteria:\n\n* Prior gene therapy\n* Pregnancy');
 assert.deepEqual(keyed.map(x=>[x.context,x.text]),[['inclusion','Inclusion Criteria:\n* Age 18 or older'],['exclusion','Key Exclusion Criteria:\n* Prior gene therapy'],['exclusion','Key Exclusion Criteria:\n* Pregnancy']]);
 assert.ok(!keyed.some(x=>/Inclusion Criteria:\nKey Exclusion/.test(x.text)),'a heading line is never a criterion');
 assert.deepEqual(brief('INCLUSION CRITERIA\n- A\nEXCLUSIONS:\n- B').map(x=>[x.context,x.text]),[['inclusion','INCLUSION CRITERIA\n- A'],['exclusion','EXCLUSIONS:\n- B']]);
 assert.deepEqual(brief('Exclusion: Pregnancy').map(x=>[x.context,x.text]),[['exclusion','Exclusion:\nPregnancy']]);
 assert.deepEqual(brief('* Must be 18\n* Exclusion of smokers').map(x=>x.context),['eligibility_unspecified','eligibility_unspecified'],'prose that starts with "Exclusion of" is not a heading');
});
test('bulleted criteria that mention exclusions stay in their section and empty heading remainders are not criteria',()=>{
 const items=criteria=>{const raw=syntheticRaw();raw.protocolSection.eligibilityModule.eligibilityCriteria=criteria;return normalizeStudyBrief(raw,1).items.filter(x=>x.category==='eligibility'&&x.context).map(x=>[x.context,x.text])};
 assert.deepEqual(items('Inclusion Criteria:\n* Exclusions: none\n* Age 18 or older'),[['inclusion','Inclusion Criteria:\n* Exclusions: none'],['inclusion','Inclusion Criteria:\n* Age 18 or older']]);
 assert.deepEqual(items('**Inclusion Criteria:**\n* A\nExclusion Criteria: -\n* B'),[['inclusion','**Inclusion Criteria:**\n* A'],['exclusion','Exclusion Criteria: -\n* B']]);
});

// --- API trace: exact request bodies, tool calls and Decisions probabilities for display ---
const answerWith=()=>({choice:'answered_by_record',confidence:.9,probabilities:{answered_by_record:.7,ask_patient:.1,ask_coordinator:.2}});
const bodyOf=(transport,url)=>transport.calls.find(c=>c.url===url&&c.method==='POST').body;
test('the result carries the exact Agents and Decisions bodies handed to the transport, the tool calls and per-question probabilities',async()=>{
 const{s,pin}=await prepared();
 try{
  const transport=scripted(pin.briefs,{answer:answerWith}),r=await runPreparedStudyBrief(transport,pin),t=r.apiTrace;
  assert.equal(r.mode,'test');
  assert.equal(t.agentsRequest.text,JSON.stringify(bodyOf(transport,'/v1/agents/sessions'),null,2));
  assert.equal(t.decisionsRequest.text,JSON.stringify(bodyOf(transport,'/v1/decisions'),null,2));
  assert.ok(!t.agentsRequest.truncated&&!t.decisionsRequest.truncated);
  assert.deepEqual(t.toolCalls.map(c=>[c.tool,c.outcome,c.arguments]),pin.briefs.map(b=>[STUDY_BRIEF_TOOL,'returned',{nctId:b.nctId}]));
  assert.ok(t.toolCalls.every(c=>/^Returned \d+ public source items for NCT\d{8}/.test(c.summary)&&c.summary.length<300));
  assert.equal(t.decisions.length,r.studyPlans.flatMap(p=>p.routes).length);
  for(const d of t.decisions){
   assert.equal(d.choice,'answered_by_record');assert.equal(d.route,'ask_coordinator','an answer without cited evidence is downgraded');assert.equal(d.confidence,.9);
   assert.deepEqual(d.probabilities,{answered_by_record:.7,ask_patient:.1,ask_coordinator:.2});assert.deepEqual(Object.keys(d.probabilities),routeValues,'fixed key order, whatever order the API used');
   assert.ok(Math.abs(Object.values(d.probabilities).reduce((a,b)=>a+b,0)-1)<=.002);
  }
  assert.deepEqual(parseStudyBriefResult(structuredClone(r)),r,'the shared contract accepts what the helper returns');
 }finally{s.clear()}
});
test('a rejected tool call is traced with fixed text and never echoes its arguments',async()=>{
 const{s,pin}=await prepared();
 try{
  const actionArguments=[{nctId:pin.briefs[0].nctId,prompt:'PATIENT_CANARY'},...pin.briefs.map(b=>({nctId:b.nctId}))];
  const r=await runPreparedStudyBrief(scripted(pin.briefs,{actionArguments}),pin);
  assert.equal(r.agentStatus,'complete');assert.equal(r.toolCalls,3);
  assert.deepEqual(r.apiTrace.toolCalls.map(c=>c.outcome),['rejected','returned','returned']);
  assert.equal(r.apiTrace.toolCalls[0].arguments,null);assert.match(r.apiTrace.toolCalls[0].summary,/^Rejected locally/);
  assert.ok(!JSON.stringify(r).includes('PATIENT_CANARY'));
 }finally{s.clear()}
});
test('failed calls keep the bodies that were built and report no probabilities for a failed Decisions call',async()=>{
 for(const options of[{agentFailure:true},{decisionFailure:true}]){
  const{s,pin}=await prepared();
  try{
   const transport=scripted(pin.briefs,options),r=await runPreparedStudyBrief(transport,pin),t=r.apiTrace;
   assert.deepEqual(JSON.parse(t.agentsRequest.text),bodyOf(transport,'/v1/agents/sessions'));assert.deepEqual(JSON.parse(t.decisionsRequest.text),bodyOf(transport,'/v1/decisions'));
   if(options.decisionFailure){assert.equal(t.decisions.length,0);assert.equal(t.toolCalls.length,2)}
   else{assert.equal(t.toolCalls.length,0);assert.equal(t.decisions.length,6);assert.ok(t.decisions.every(d=>d.route==='ask_coordinator'))}
  }finally{s.clear()}
 }
});
test('Decisions probabilities are validated and keyed by the three routes',()=>{
 const plans=[{nctId:'NCT99999990',questionIds:['visits'],questionEvidence:[{questionId:'visits',evidenceIds:[]}],claims:[],prescreenIds:[],flagIds:[]}];
 const answer=probabilities=>({answers:[{type:'choice',name:'NCT99999990_visits',choice:'ask_patient',confidence:.5,probabilities}]});
 const good=routeValues.map((value,i)=>({value,probability:[.2,.5,.3][i]}));
 assert.deepEqual(briefDecisionAnswers(answer([...good].reverse()),plans).get('NCT99999990_visits'),{choice:'ask_patient',confidence:.5,probabilities:{answered_by_record:.2,ask_patient:.5,ask_coordinator:.3}});
 const bad=[good.map(x=>({...x,probability:x.probability/2})),[good[0],good[0],good[1]],[good[0],good[1],null],[...good.slice(0,2),{value:'maybe',probability:.3}],good.slice(0,2),good.map((x,i)=>i?x:{...x,probability:-.2})];
 for(const probabilities of bad)assert.throws(()=>briefDecisionAnswers(answer(probabilities),plans),{code:'INVALID_DECISIONS_OUTPUT'});
});
test('traceBody cuts at line or character boundaries within the reply cost and reports the full size',()=>{
 const body={a:'é'.repeat(300),b:{c:['x'.repeat(50),'y"z\n']}},full=JSON.stringify(body,null,2),cost=text=>utf8Bytes(JSON.stringify(text))-2;
 for(const cap of[0,1,3,10,100,251,700]){const t=traceBody(body,cap);assert.equal(t.bytes,utf8Bytes(full));assert.equal(t.truncated,true);assert.ok(full.startsWith(t.text),'a prefix of the full text');assert.ok(!t.text.includes('�'));assert.ok(cost(t.text)<=cap,`cost ${cost(t.text)} within ${cap}`);}
 const whole=traceBody(body,cost(full));assert.deepEqual(whole,{text:full,bytes:utf8Bytes(full),truncated:false});
 assert.equal(traceBody(body,cost(full)-1).truncated,true);
});
test('oversized bodies are cut for display only, flagged with their full size, and the reply stays under the frame limit',async()=>{
 const s=new PreparedStudyBriefStore({fetchRecord:async id=>largeRaw(id)});
 try{
  const p=await s.prepare(['NCT99999990','NCT99999991']),pin=s.take({token:p.token,digest:p.digest});
  const largePlan=b=>{const picks=b.items.filter(i=>i.category==='timeline'||i.category==='design').slice(0,4);return{nctId:b.nctId,claims:picks.map(e=>({category:e.category,text:e.text,evidenceIds:[e.id],sourceQuotes:[e.text]})),questionIds:['still_enrolling','visits','next_steps'],prescreenIds:['diagnosis_details','prior_treatments'],flagIds:[],questionEvidence:['still_enrolling','visits','next_steps'].map(questionId=>({questionId,evidenceIds:[]}))}};
  const transport=scripted(pin.briefs,{plan:largePlan,answer:answerWith}),r=await runPreparedStudyBrief(transport,pin),t=r.apiTrace,sent=bodyOf(transport,'/v1/decisions'),full=JSON.stringify(sent,null,2);
  assert.equal(r.agentStatus,'complete');assert.equal(r.decisionStatus,'complete');assert.deepEqual(r.failureCodes,[]);
  assert.equal(t.decisionsRequest.truncated,true);assert.equal(t.decisionsRequest.bytes,utf8Bytes(full));assert.ok(full.startsWith(t.decisionsRequest.text));assert.ok(utf8Bytes(t.decisionsRequest.text)<t.decisionsRequest.bytes);
  assert.equal(t.agentsRequest.truncated,false,'the small body keeps its full text while the large one is cut');
  assert.equal(sent.questions.length,6,'the Decisions call itself is unchanged');
  assert.ok(encodeMessage({id:'x'.repeat(40),type:'result',ok:true,result:r}).length<=MAX_MESSAGE_BYTES+4,'the reply fits a native frame');
  assert.equal(t.decisions.length,6);
 }finally{s.clear()}
});
test('the shared contract refuses tampered, mismatched or secret-bearing traces and still accepts a result without one',async()=>{
 const{s,pin}=await prepared();
 try{
  const r=await runPreparedStudyBrief(scripted(pin.briefs,{answer:answerWith}),pin),t=r.apiTrace,{apiTrace,...older}=r;
  assert.ok(parseStudyBriefResult(older),'an older helper sends no trace');
  const withTrace=changes=>parseStudyBriefResult({...r,apiTrace:{...t,...changes}});
  assert.ok(withTrace({}));
  const bad={
   'unknown key':{extra:1},
   'tool call for a study that was not selected':{toolCalls:[{...t.toolCalls[0],arguments:{nctId:'NCT00000001'}}]},
   'tool call with extra argument':{toolCalls:[{...t.toolCalls[0],arguments:{nctId:'NCT99999990',prompt:'x'}}]},
   'rejected call that keeps arguments':{toolCalls:[{...t.toolCalls[0],outcome:'rejected'}]},
   'too many tool calls':{toolCalls:Array.from({length:7},()=>t.toolCalls[0])},
   'decisions in another order':{decisions:t.decisions.map((d,i)=>i?d:{...d,questionId:'costs'})},
   'missing decisions':{decisions:t.decisions.slice(1)},
   'probabilities that do not sum to 1':{decisions:t.decisions.map((d,i)=>i?d:{...d,probabilities:{...d.probabilities,ask_patient:.3}})},
   'probability for a fourth choice':{decisions:t.decisions.map((d,i)=>i?d:{...d,probabilities:{...d.probabilities,maybe:0}})},
   'final route that is not the choice or its downgrade':{decisions:t.decisions.map((d,i)=>i?d:{...d,choice:'ask_patient',route:'ask_coordinator'})},
   'body that is not JSON':{agentsRequest:{text:'not json',bytes:8,truncated:false}},
   'body with the wrong size':{agentsRequest:{...t.agentsRequest,bytes:t.agentsRequest.bytes+1}},
   'truncated body that is not shorter':{agentsRequest:{...t.agentsRequest,truncated:true}},
   'body holding an API key':{agentsRequest:traceBody({note:'Bearer sk-abcdefghijklmnopqrstuvwxyz012345'})},
   'summary holding an API key':{toolCalls:[{...t.toolCalls[0],summary:'sk-abcdefghijklmnopqrstuvwxyz012345'}]},
  };
  for(const[name,changes]of Object.entries(bad))assert.throws(()=>withTrace(changes),undefined,name);
  assert.throws(()=>parseStudyBriefResult({...r,decisionStatus:'failed'}),undefined,'decisions cannot be listed for a failed classification');
  assert.ok(withTrace({agentsRequest:traceBody({text:'Participants complete a task-oriented-assessment-of-daily-living-activities'})}),'ordinary hyphenated words are not mistaken for keys');
  assert.ok(withTrace({agentsRequest:traceBody({text:'HIPAA authorization is required'})}),'ordinary public words are not mistaken for header text');
 }finally{s.clear()}
});
// --- Public record text shaped like an API key must not cost the brief, or the rest of its trace ---
const KEYED='sk-ABCDEFGHIJKLMNOPQRSTUVWX',REDACTED='[redacted key-like text]',KEY_SHAPE=/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/;
test('public record text shaped like an API key keeps the brief and its trace, hiding only the matching text',async()=>{
 const s=new PreparedStudyBriefStore({fetchRecord:async id=>{const raw=syntheticRaw();raw.protocolSection.identificationModule.nctId=id;raw.protocolSection.descriptionModule.briefSummary=`Sponsor reference ${KEYED} for this protocol.`;return raw}});
 try{
  const p=await s.prepare(['NCT99999990','NCT99999991']),pin=s.take({token:p.token,digest:p.digest});
  assert.ok(pin.briefs.every(b=>b.items.some(i=>i.text.includes(KEYED))),'the public excerpt reaches the request');
  const transport=scripted(pin.briefs,{answer:answerWith}),r=await runPreparedStudyBrief(transport,pin),t=r.apiTrace;
  // The brief is not lost.
  assert.equal(r.agentStatus,'complete');assert.equal(r.decisionStatus,'complete');assert.deepEqual(r.failureCodes,[]);assert.equal(r.cleanup,'deleted');
  assert.ok(r.briefs.every(b=>b.claims.length===1),'the validated claims are kept');
  assert.ok(r.briefs.every(b=>b.items.some(i=>i.text.includes(KEYED))),'the verified public excerpt is shown exactly as published');
  // The real request is unchanged.
  const sent=JSON.stringify(bodyOf(transport,'/v1/decisions'),null,2);assert.ok(sent.includes(KEYED),'the API still receives the public text as published');
  // The trace is kept, with only the key-shaped text replaced.
  assert.ok(t,'the trace is not dropped');
  assert.equal(t.decisionsRequest.text,sent.replaceAll(KEYED,REDACTED));assert.equal(t.decisionsRequest.bytes,utf8Bytes(t.decisionsRequest.text));assert.equal(t.decisionsRequest.truncated,false);
  assert.ok(isRecord(JSON.parse(t.decisionsRequest.text)),'the display copy is still the request as JSON');
  assert.equal(t.agentsRequest.text,JSON.stringify(bodyOf(transport,'/v1/agents/sessions'),null,2));
  assert.equal(t.toolCalls.length,2);assert.equal(t.decisions.length,r.studyPlans.flatMap(x=>x.routes).length);
  assert.ok(!KEY_SHAPE.test(JSON.stringify(t)),'no key-shaped text is in the trace');
  assert.deepEqual(parseStudyBriefResult(structuredClone(r)),r,'the strict shared contract accepts the result');
 }finally{s.clear()}
});
test('redactedTraceBody replaces every key-shaped substring before the display copy is cut, and the contract stays strict',async()=>{
 const body={a:`one ${KEYED} two`,b:{c:`(${KEYED}_more-text-here)`},d:'Bearer sk-abcdefghijklmnopqrstuvwxyz012345',e:'a short sk-tooshort value',f:'x'.repeat(50)+KEYED};
 const full=redactKeyLike(JSON.stringify(body,null,2));
 assert.ok(!KEY_SHAPE.test(full));assert.equal(full.split(REDACTED).length-1,3,'a, b.c and d');assert.ok(full.includes('sk-tooshort')&&full.includes('x'+KEYED),'text that is not key-shaped (too short, or glued to a word) is left alone');
 assert.deepEqual(redactedTraceBody(body),{text:full,bytes:utf8Bytes(full),truncated:false});
 assert.equal(redactedTraceBodyCost(body),utf8Bytes(JSON.stringify(full))-2);
 for(let cap=0;cap<=full.length;cap+=7){const t=redactedTraceBody(body,cap);assert.ok(full.startsWith(t.text),'a prefix of the redacted text');assert.ok(!KEY_SHAPE.test(t.text));assert.equal(t.bytes,utf8Bytes(full))}
 const{s,pin}=await prepared();
 try{
  const r=await runPreparedStudyBrief(scripted(pin.briefs,{answer:answerWith}),pin),t=r.apiTrace;
  assert.ok(parseStudyBriefResult({...r,apiTrace:{...t,agentsRequest:redactedTraceBody(body)}}),'a redacted copy is accepted');
  assert.throws(()=>parseStudyBriefResult({...r,apiTrace:{...t,agentsRequest:traceBody(body)}}),/Invalid API trace/,'a copy that still holds the key-shaped text is refused');
  assert.throws(()=>parseStudyBriefResult({...r,apiTrace:{...t,toolCalls:[{...t.toolCalls[0],summary:`Returned ${KEYED}`}]}}),/Invalid API trace/,'so is a tool-call summary that holds it');
 }finally{s.clear()}
});
test('stdio: the reply trace equals the bodies the installed helper sent and holds no header, key or Authorization text',async()=>{
 const installed=await installHost('treatable-brief-trace-');let host;
 try{
  const ids=['NCT99999990','NCT99999991'],raws=ids.map(nctId=>{const r=syntheticRaw();r.protocolSection.identificationModule.nctId=nctId;return r}),briefs=raws.map(r=>normalizeStudyBrief(r,1));
  const hook=await writeHook(installed.home,{log:installed.log,govRecords:Object.fromEntries(ids.map((id,i)=>[id,raws[i]])),briefOutput:JSON.stringify({studies:briefs.map(agentPlan)})});
  host=startHost(installed,{hook});
  const prep=await host.call({id:'prep',type:'prepareStudyBrief',payload:{nctIds:ids}});assert.equal(prep.ok,true,prep.code);
  const run=await host.call({id:'run',type:'executeStudyBrief',payload:{token:prep.result.token,digest:prep.result.digest}});
  parseApplyReply(run,'run');assert.equal(run.ok,true,run.code);
  const calls=(await readLines(installed.log)).filter(x=>x.host==='api.openai.com'),t=run.result.apiTrace;
  assert.ok(calls.length>0&&calls.every(x=>x.auth),'the fake API saw a Bearer credential on every call');
  assert.deepEqual(JSON.parse(t.agentsRequest.text),calls.find(x=>x.path==='/v1/agents/sessions'&&x.method==='POST').body);
  assert.deepEqual(JSON.parse(t.decisionsRequest.text),calls.find(x=>x.path==='/v1/decisions').body);
  assert.deepEqual(t.toolCalls.map(c=>c.arguments.nctId),ids);assert.equal(t.decisions.length,6);
  for(const d of t.decisions)assert.ok(Math.abs(Object.values(d.probabilities).reduce((a,b)=>a+b,0)-1)<=.002);
  for(const forbidden of['sk-test-not-a-real-credential','Authorization','Bearer','OpenAI-Beta','Content-Type','sess_fake'])assert.ok(!JSON.stringify(run).includes(forbidden),`result frame: ${forbidden}`);
  for(const forbidden of['sk-test-not-a-real-credential','Authorization','Bearer'])assert.ok(!JSON.stringify(host.frames).includes(forbidden),`all frames: ${forbidden}`);
  host.child.stdin.end();await host.exit;host=undefined;
 }finally{host?.child.kill('SIGKILL');await rm(installed.home,{recursive:true,force:true})}
});

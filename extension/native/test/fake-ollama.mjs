// Test-only stand-in for the `ollama` binary. A per-test wrapper (see writeFakeOllama) sets globalThis.__FAKE_OLLAMA_CONFIG to a JSON
// file path and imports this module. `serve` listens on OLLAMA_HOST like Ollama and answers /api/version, /api/tags, /api/show and
// /api/chat from that config; it never touches the network or a real model. Every request is logged (one JSON line) with its route,
// body, pid and the environment the runtime was started with, so tests can check what reached the "local model".
// Config: {log, pidFile, version, models:[{name,size,details,capabilities,remote}], start:'normal'|'exit'|'hang'|'badVersion',
//          chat:'valid'|'invalid'|'slow'|'wrongShape'|'routingInvalid', chatDelay, confidence}
import http from 'node:http';import{readFileSync,appendFileSync,writeFileSync}from'node:fs';
// Start behavior uses the config at launch; request handling re-reads it, so a test can change answers without restarting.
const load=()=>JSON.parse(readFileSync(globalThis.__FAKE_OLLAMA_CONFIG,'utf8'));let config=load();
const log=entry=>{if(config.log)appendFileSync(config.log,JSON.stringify({pid:process.pid,...entry})+'\n');};
const [command]=process.argv.slice(2);
if(command==='--version'){process.stdout.write(`ollama version is ${config.version??'0.99.0'}\n`);process.exit(0);}
if(command!=='serve')process.exit(2);
if(config.pidFile)writeFileSync(config.pidFile,String(process.pid));
log({event:'start',argv:process.argv.slice(2),env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith('OLLAMA_')||['HOME','PATH','TMPDIR'].includes(k))),envKeys:Object.keys(process.env).sort()});
if(config.start==='exit')process.exit(1);
if(config.start==='hang'){setInterval(()=>{},1000);}
else{
 const[host,port]=String(process.env.OLLAMA_HOST).split(':');
 // Builds a schema-valid answer from the request's own format, as constrained decoding would.
 const fromSchema=(schema,mode)=>{
  const studies=schema?.properties?.studies?.prefixItems,routes=schema?.properties?.routes?.prefixItems;
  if(studies)return{studies:studies.map((st,index)=>{const p=st.properties,claim=p.claims.items?.anyOf?.[0]?.properties;const qs=['still_enrolling','visits','next_steps'];return{nctId:p.nctId.const,claims:claim?[{evidenceIds:[claim.evidenceIds.items.const],category:claim.category.const,text:claim.text.const,sourceQuotes:[claim.sourceQuotes.items.const]}]:[],questionEvidence:qs.map((questionId,i)=>({questionId,evidenceIds:i===0&&index===0&&claim?[claim.evidenceIds.items.const]:[]})),questionIds:mode==='wrongShape'?['still_enrolling','visits']:qs,prescreenIds:['diagnosis_details','prior_treatments'],flagIds:[]};})};
  if(routes)return{routes:routes.map((r,i)=>({name:r.properties.name.const,route:i%3===0?'answered_by_record':i%3===1?'ask_coordinator':'ask_patient',...(config.confidence===false?{}:{confidence:i%2?0.62:0.91})}))};
  return{};
 };
 const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',async()=>{config={...load(),start:config.start};
  const body=raw?JSON.parse(raw):undefined;log({event:'request',method:req.method,path:req.url,body});
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(typeof value==='string'?value:JSON.stringify(value));};
  if(req.url==='/api/version')return send(200,{version:config.start==='badVersion'?'not a version!':config.version??'0.99.0'});
  if(req.url==='/api/tags')return send(200,{models:(config.models??[]).map(m=>({name:m.name,model:m.name,size:m.size,details:m.details??{},...(m.remote?{remote_host:'https://ollama.com:443',remote_model:m.name}:{})}))});
  const model=(config.models??[]).find(m=>m.name===body?.model);
  if(req.url==='/api/show'){if(!model)return send(404,{error:`model '${body?.model}' not found`});return send(200,{capabilities:model.capabilities??['completion'],details:model.details??{},...(model.remote?{remote_host:'https://ollama.com:443'}:{})});}
  if(req.url==='/api/chat'){
   if(!model)return send(404,{error:`model '${body?.model}' not found`});
   if(body?.format?.properties?.score){const mode=config.rank??'valid',record=JSON.parse(body.messages.at(-1).content),n=Number(record.nctId.slice(-1));
    if(mode==='slow')await new Promise(r=>setTimeout(r,config.chatDelay??60000));if(res.destroyed||req.destroyed)return;
    const content=mode==='invalid'?'{"score": "high"':mode==='inconsistent'&&n%2?JSON.stringify({score:95,reasonId:'different_condition'}):JSON.stringify(n%3===0?{score:12,reasonId:'different_condition'}:{score:90-n,reasonId:'condition_match'});
    return send(200,{model:body.model,message:{role:'assistant',content},done:true});}
   const routing=!!body?.format?.properties?.routes,mode=config.chat??'valid';
   if(mode==='slow'||mode==='slowRouting'&&routing){await new Promise(r=>setTimeout(r,config.chatDelay??60000));}
   let content;
   if(mode==='invalid'&&!routing||mode==='routingInvalid'&&routing)content='Sure! Here is the brief: {not json';
   else content=JSON.stringify(fromSchema(body.format,mode));
   if(res.destroyed||req.destroyed)return;
   return send(200,{model:body.model,created_at:new Date(0).toISOString(),message:{role:'assistant',content},done:true,done_reason:'stop',eval_count:42});
  }
  send(404,{error:'not found'});
 });});
 server.listen(Number(port),host);
}
process.on('SIGTERM',()=>{log({event:'sigterm'});process.exit(0);});

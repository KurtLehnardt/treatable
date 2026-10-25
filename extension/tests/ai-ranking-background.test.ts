import test from 'node:test';
import assert from 'node:assert/strict';
import {installSiteAssistant} from '../src/site-background';
import {RANK_LEVELS} from '../shared/rank-contract.mjs';

/* The real site background with a fake page, fake helper port and fake session storage: AI-matched results end to end. */
class Events{listeners:((...v:any[])=>void)[]=[];addListener=(f:(...v:any[])=>void)=>{this.listeners.push(f)};emit=(...v:any[])=>{for(const f of [...this.listeners])f(...v)}}
const flush=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r))};
const until=async(check:()=>boolean,ms=3000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('timeout');await new Promise(r=>setTimeout(r,5))}};
const [A,B,C]=['NCT00000001','NCT00000002','NCT00000003'];
const records:Record<string,any>={[A]:{id:A,title:'Study A',status:'RECRUITING',minimumAge:'18 Years',maximumAge:null,sex:'ALL',locations:[]},[B]:{id:B,title:'Study B',status:'TERMINATED',minimumAge:null,maximumAge:null,sex:'ALL',locations:[]},[C]:{id:C,title:'Study C',status:'RECRUITING',minimumAge:'18 Years',maximumAge:null,sex:'ALL',locations:[]}};
const TOKEN='t'.repeat(43),DIGEST='a'.repeat(64);
function rig({decisions='ok'}:{decisions?:'ok'|'fail'}={}){
 const connect=new Events(),messages=new Events(),commands:any[]=[],scripts:any[]=[],windows:any[]=[],nativeSent:any[]=[],origin='chrome-extension://test',session=new Map<string,unknown>();
 let snap:any={generation:'doc-1',url:'https://clinicaltrials.gov/search?cond=Asthma',nctIds:[A,B,C],diagnostic:'Three cards',supported:true};
 const prefsChanged=new Events();
 const api:any={storage:{onChanged:prefsChanged},runtime:{id:'test',getURL:(p:string)=>origin+'/'+p,onConnect:connect,onMessage:messages},action:{onClicked:new Events()},tabs:{get:async()=>({id:1,url:snap.url}),update:async()=>{},sendMessage:async(_id:number,m:any)=>{commands.push(structuredClone(m));return{ok:true,result:['snapshot','availability','clearAvailability','restore','reorder'].includes(m.type)?snap:{}}},onUpdated:new Events(),onRemoved:new Events()},scripting:{executeScript:async(v:any)=>{scripts.push(v);return[]}},windows:{create:async(v:any)=>{windows.push(v);return{id:2,tabs:[{id:9,url:origin+'/panel.html'}]}},remove:async()=>{}}};
 const rankNative=()=>{const onMessage=new Events(),onDisconnect=new Events();return{onMessage,onDisconnect,disconnect(){},postMessage(m:any){nativeSent.push(structuredClone(m));setTimeout(()=>{if(m.type==='prepareRank')onMessage.emit({id:m.id,type:'result',ok:true,result:{kind:'preparedRank',token:TOKEN,digest:DIGEST,expiresAt:Date.now()+300000,provider:'openai',nctIds:m.payload.nctIds,preview:{profile:m.payload.profile,request:{model:'gpt-6-luna',questions:m.payload.nctIds.map((name:string)=>({type:'score',name}))}}}});else if(m.type==='executeRank')onMessage.emit(decisions==='fail'?{id:m.id,type:'result',ok:false,code:'API_ERROR',error:'fixed'}:{id:m.id,type:'result',ok:true,result:{kind:'rankResult',mode:'test',provider:'openai',digest:DIGEST,scores:[[A,33],[B,100],[C,100]].map(([nctId,score])=>({nctId,score,reasonId:(score as number)>=75?'strong_match':'unclear',probabilities:RANK_LEVELS.map((_,i)=>i===((score as number)>=75?3:1)?1:0)}))}})},1)}}};
 const rankConsent={has:async()=>session.get('consent')===true,grant:async()=>{session.set('consent',true)},clear:async()=>{session.delete('consent')}};
 const service=installSiteAssistant(api,{privateMatchingReady:true,lookupPublicStudy:async(id:string)=>records[id],rankNative,rankConsent});
 function port(purpose='overlay',nct?:string){const onMessage=new Events(),onDisconnect=new Events(),sent:any[]=[];const p:any={name:`treatable.site.${purpose}.v1`,sender:{id:'test',tab:{id:1,url:snap.url},frameId:purpose==='overlay'?2:5,documentId:purpose+'-document',url:origin+'/'+(purpose==='overlay'?'overlay.html':`score-badge.html?nct=${nct}`)},onMessage,onDisconnect,sent,closed:false,postMessage(v:any){sent.push(structuredClone(v))},disconnect(){p.closed=true;onDisconnect.emit()}};connect.emit(p);return p}
 const confirmSender={id:'test',url:origin+'/confirm-send.html',frameId:0,documentId:'confirm-doc',tab:{id:9,windowId:2,url:origin+'/confirm-send.html'}};
 return{api,service,commands,scripts,windows,nativeSent,session,messages,port,confirmSender,prefsChanged,setSnapshot:(s:any)=>{snap=s}};
}
async function connected(h:ReturnType<typeof rig>){await h.service.launch({id:1,url:'https://clinicaltrials.gov/search?cond=Asthma'});const p=h.port();p.onMessage.emit({type:'site.authenticate',capability:h.scripts.at(-1).args[0].capability});await flush();return p}
const ranking=(p:any)=>p.sent.filter((v:any)=>v.type==='site.ranking').map((v:any)=>v.state);

test('the first ranking opens one top-level confirmation with the exact request; accepting reorders the cards and adds badges',async()=>{
 const h=rig(),p=await connected(h);
 await h.service.handle(1,{id:'r1',type:'site.aiRank',payload:{details:{ageBand:'30_44',sex:'male'}}});
 await until(()=>h.windows.length===1);assert.deepEqual(h.nativeSent.map(m=>m.type),['prepareRank'],'nothing is scored while the confirmation is open');
 let context:any=undefined;h.messages.emit({kind:'site.confirmContext'},{...h.confirmSender,frameId:3},(v:any)=>context=v);assert.equal(context,undefined,'only the top-level confirmation page may read it');
 h.messages.emit({kind:'site.confirmContext'},h.confirmSender,(v:any)=>context=v);context=context as any;assert.equal(context.ok,true);assert.equal(context.operation,'rank');
 assert.deepEqual(context.summary.conditions,['Asthma']);assert.equal(context.summary.ageBand,'30_44');assert.deepEqual(context.summary.studies.map((s:any)=>s.title),['Study A','Study B','Study C']);assert.equal(context.summary.exactPayload.model,'gpt-6-luna');
 assert.doesNotMatch(JSON.stringify(context),new RegExp(`${TOKEN}|${DIGEST}|Authorization`),'the receipt never reaches the confirmation page');
 h.messages.emit({kind:'site.confirmSend',accepted:true},h.confirmSender,()=>{});
 await until(()=>ranking(p).some((s:any)=>s.phase==='done'));
 assert.deepEqual(h.nativeSent.map(m=>m.type),['prepareRank','executeRank']);assert.equal(h.session.get('consent'),true,'the browser-session confirmation is recorded');
 const reorder=h.commands.find(c=>c.type==='reorder');assert.deepEqual(reorder.payload.order,[C,A,B],'best match first, not recruiting last');
 assert.deepEqual(h.scripts.filter(s=>s.args?.[0]?.purpose==='badge').map(s=>s.args[0].nctId),[C,A,B]);
 const badge=h.port('badge',B);badge.onMessage.emit({type:'site.authenticate',capability:h.scripts.filter(s=>s.args?.[0]?.nctId===B).at(-1).args[0].capability});await flush();
 assert.deepEqual(badge.sent.find((v:any)=>v.type==='site.badge'),{type:'site.badge',nctId:B,score:10,label:'not_recruiting'},'the badge gets the capped percentage and a reason id only');
 const done=ranking(p).find((s:any)=>s.phase==='done');assert.equal(done.applied,true);assert.deepEqual(done.studies.map((s:any)=>[s.nctId,s.percent,s.reasonId]),[[C,100,'strong_match'],[A,33,'unclear'],[B,10,'not_recruiting']]);
 /* Later rankings in the same browser session run without another window. */
 h.setSnapshot({generation:'doc-2',url:'https://clinicaltrials.gov/search?cond=Asthma&page=2',nctIds:[A,C],diagnostic:'Two cards',supported:true});
 await h.service.handle(1,{id:'r2',type:'site.aiRank',payload:{details:{}}});await until(()=>h.nativeSent.length===4);assert.equal(h.windows.length,1);
 p.disconnect();
});

test('Restore original order and turning AI-matched results off put the website order back; off also forgets the confirmation',async()=>{
 const h=rig(),p=await connected(h);h.session.set('consent',true);
 await h.service.handle(1,{id:'r1',type:'site.aiRank',payload:{details:{}}});await until(()=>ranking(p).some((s:any)=>s.phase==='done'));
 assert.equal(h.windows.length,0,'an existing session confirmation is not asked again');
 await h.service.handle(1,{id:'restore',type:'site.restore',payload:{}});assert.ok(h.commands.some(c=>c.type==='restore'));
 const before=h.commands.length;await h.service.handle(1,{id:'off',type:'site.aiRankStop',payload:{}});assert.equal(h.session.has('consent'),false);
 await assert.rejects(h.service.handle(1,{id:'bad',type:'site.aiRank',payload:{details:{name:'Pat Canary'}}}),'no field beyond age band, sex and condition terms is accepted');
 await assert.rejects(h.service.handle(1,{id:'bad2',type:'site.aiRank',payload:{details:{},extra:true}}));
 assert.ok(h.commands.length>=before);p.disconnect();
});

test('a Decisions failure still applies the record-check order and reports the failure to the overlay',async()=>{
 const h=rig({decisions:'fail'}),p=await connected(h);h.session.set('consent',true);
 await h.service.handle(1,{id:'r1',type:'site.aiRank',payload:{details:{}}});await until(()=>ranking(p).some((s:any)=>s.phase==='done'));
 const done=ranking(p).find((s:any)=>s.phase==='done');assert.equal(done.failure,'API_ERROR');assert.equal(done.applied,true);
 assert.deepEqual(h.commands.find(c=>c.type==='reorder').payload.order,[A,C,B],'website order with the terminated study last');
 p.disconnect();
});

test('closing the overlay mid-ranking stops it before anything is scored; switching AI-matched results off anywhere restores the page',async()=>{
 const h=rig(),p=await connected(h);
 await h.service.handle(1,{id:'r1',type:'site.aiRank',payload:{details:{}}});await until(()=>h.windows.length===1);
 p.disconnect();await flush();h.messages.emit({kind:'site.confirmSend',accepted:true},h.confirmSender,()=>{});await flush();await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(h.nativeSent.map(m=>m.type),['prepareRank'],'no executeRank after the overlay is gone');assert.equal(h.session.has('consent'),false);assert.equal(h.service.ranker.isRunning(1),false);
 const again=rig(),q=await connected(again);again.session.set('consent',true);
 await again.service.handle(1,{id:'r2',type:'site.aiRank',payload:{details:{}}});await until(()=>ranking(q).some((s:any)=>s.phase==='done'));
 const before=again.commands.filter(c=>c.type==='restore').length;
 again.prefsChanged.emit({'treatable.uiPrefs':{newValue:{displayMode:'popup',theme:'system',aiRanking:'off'}}},'local');await flush();
 assert.equal(again.session.has('consent'),false,'off forgets the browser-session confirmation even without an overlay request');
 assert.equal(again.commands.filter(c=>c.type==='restore').length,before+1,'the ranked page goes back to the website order');
 q.disconnect();
});

test('a replacement overlay stops the earlier overlay ranking before anything is scored',async()=>{
 const h=rig();await connected(h);
 await h.service.handle(1,{id:'r1',type:'site.aiRank',payload:{details:{}}});await until(()=>h.windows.length===1);assert.equal(h.service.ranker.isRunning(1),true);
 const replacement=h.port();replacement.sender.documentId='replacement-document';replacement.onMessage.emit({type:'site.authenticate',capability:h.service.caps.create(1,'overlay')});await flush();
 assert.equal(h.service.ranker.isRunning(1),false,'the replaced overlay ranking is stopped');
 h.messages.emit({kind:'site.confirmSend',accepted:true},h.confirmSender,()=>{});await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(h.nativeSent.map(m=>m.type),['prepareRank'],'no executeRank for the replaced overlay');assert.equal(h.session.has('consent'),false);
 replacement.disconnect();
});

test('switching AI-matched results off while the first-ranking window is open closes it and scores nothing',async()=>{
 const h=rig(),p=await connected(h);let removed=0;h.api.windows.remove=async()=>{removed++};
 await h.service.handle(1,{id:'r1',type:'site.aiRank',payload:{details:{}}});await until(()=>h.windows.length===1);
 h.prefsChanged.emit({'treatable.uiPrefs':{newValue:{displayMode:'popup',theme:'system',aiRanking:'off'}}},'local');await flush();
 assert.equal(removed,1,'the confirmation window is closed');assert.equal(h.service.ranker.isRunning(1),false);
 h.messages.emit({kind:'site.confirmSend',accepted:true},h.confirmSender,()=>{});await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(h.nativeSent.map(m=>m.type),['prepareRank']);assert.equal(h.session.has('consent'),false);
 p.disconnect();
});

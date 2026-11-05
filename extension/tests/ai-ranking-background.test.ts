import test from 'node:test';
import assert from 'node:assert/strict';
import {installSiteAssistant} from '../src/site-background';
import {RANK_LEVELS} from '../shared/rank-contract.mjs';
import {RANKING_CONSENT_KEY,RANKING_CONSENT_VALUES} from '../src/ranking-consent';
import {UI_PREFS_KEY} from '../src/ui-prefs';

/* The real site background with a fake page, a fake helper port and fake extension storage: the AI-matched results switch end to end. */
class Events{listeners:((...v:any[])=>void)[]=[];addListener=(f:(...v:any[])=>void)=>{this.listeners.push(f)};removeListener=(f:(...v:any[])=>void)=>{this.listeners=this.listeners.filter(x=>x!==f)};emit=(...v:any[])=>{for(const f of [...this.listeners])f(...v)}}
const flush=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r))};
const until=async(check:()=>boolean,ms=3000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('timeout');await new Promise(r=>setTimeout(r,5))}};
const [A,B,C]=['NCT00000001','NCT00000002','NCT00000003'];
const records:Record<string,any>={[A]:{id:A,title:'Study A',status:'RECRUITING',minimumAge:'18 Years',maximumAge:null,sex:'ALL',locations:[]},[B]:{id:B,title:'Study B',status:'TERMINATED',minimumAge:null,maximumAge:null,sex:'ALL',locations:[]},[C]:{id:C,title:'Study C',status:'RECRUITING',minimumAge:'18 Years',maximumAge:null,sex:'ALL',locations:[]}};
const TOKEN='t'.repeat(43),DIGEST='a'.repeat(64),origin='chrome-extension://test';
/** holdPrepare keeps each prepareRank unanswered until the test calls the matching entry of `held`. `local` is the initial chrome.storage.local. */
function rig({decisions='ok',holdPrepare=false,local={}}:{decisions?:'ok'|'fail';holdPrepare?:boolean;local?:Record<string,unknown>}={}){
 const connect=new Events(),messages=new Events(),changed=new Events(),commands:any[]=[],scripts:any[]=[],nativeSent:any[]=[],natives:any[]=[],held:(()=>void)[]=[];
 /* chrome.storage.local, with change events like Chrome's; the session area still holds the marker of the removed browser-session confirmation. */
 const store=new Map<string,unknown>(Object.entries(structuredClone(local))),session=new Map<string,unknown>([['treatable.rankingConsent','openai-ranking-2026-10']]);
 const area={get:async(key:string)=>store.has(key)?{[key]:structuredClone(store.get(key))}:{},set:async(items:Record<string,unknown>)=>{for(const[key,value]of Object.entries(items)){store.set(key,structuredClone(value));changed.emit({[key]:{newValue:structuredClone(value)}},'local')}},remove:async(key:string)=>{if(!store.delete(key))return;changed.emit({[key]:{}},'local')}};
 let snap:any={generation:'doc-1',url:'https://clinicaltrials.gov/search?cond=Asthma',nctIds:[A,B,C],diagnostic:'Three cards',supported:true};
 const api:any={storage:{local:area,session:{get:async(key:string)=>session.has(key)?{[key]:session.get(key)}:{},set:async()=>{},remove:async(key:string)=>{session.delete(key)}},onChanged:changed},runtime:{id:'test',getURL:(p:string)=>origin+'/'+p,onConnect:connect,onMessage:messages},action:{onClicked:new Events()},tabs:{get:async()=>({id:1,url:snap.url}),update:async()=>{},sendMessage:async(_id:number,m:any)=>{commands.push(structuredClone(m));return{ok:true,result:['snapshot','releaseCards','restore','reorder'].includes(m.type)?snap:{}}},onUpdated:new Events(),onRemoved:new Events()},scripting:{executeScript:async(v:any)=>{scripts.push(v);return[]}}};
 const rankNative=()=>{const onMessage=new Events(),onDisconnect=new Events();const n:any={onMessage,onDisconnect,disconnected:false,disconnect(){n.disconnected=true},postMessage(m:any){nativeSent.push(structuredClone(m));const answer=()=>{if(n.disconnected)return;if(m.type==='prepareRank')onMessage.emit({id:m.id,type:'result',ok:true,result:{kind:'preparedRank',token:TOKEN,digest:DIGEST,expiresAt:Date.now()+300000,provider:'openai',nctIds:m.payload.nctIds,preview:{profile:m.payload.profile,request:{model:'gpt-6-luna',questions:m.payload.nctIds.map((name:string)=>({type:'score',name}))}}}});else if(m.type==='executeRank')onMessage.emit(decisions==='fail'?{id:m.id,type:'result',ok:false,code:'API_ERROR',error:'fixed'}:{id:m.id,type:'result',ok:true,result:{kind:'rankResult',mode:'test',provider:'openai',digest:DIGEST,scores:[[A,33],[B,100],[C,100]].map(([nctId,score])=>({nctId,score,reasonId:(score as number)>=75?'strong_match':'unclear',probabilities:RANK_LEVELS.map((_,i)=>i===((score as number)>=75?3:1)?1:0)}))}})};if(m.type==='prepareRank'&&holdPrepare)held.push(answer);else setTimeout(answer,1)}};natives.push(n);return n};
 const lookups:string[]=[];const service=installSiteAssistant(api,{lookupPublicStudy:async(id:string)=>{lookups.push(id);return records[id]},rankNative});
 function port(purpose='overlay',nct?:string){const onMessage=new Events(),onDisconnect=new Events(),sent:any[]=[];const p:any={name:`treatable.site.${purpose}.v1`,sender:{id:'test',tab:{id:1,url:snap.url},frameId:purpose==='overlay'?2:5,documentId:purpose+'-document',url:origin+'/'+(purpose==='overlay'?'overlay.html':`score-badge.html?nct=${nct}`)},onMessage,onDisconnect,sent,closed:false,postMessage(v:any){sent.push(structuredClone(v))},disconnect(){p.closed=true;onDisconnect.emit()}};connect.emit(p);return p}
 let request=0;
 const turnOn=(disclosure='openai')=>service.handle(1,{id:`on-${++request}`,type:'site.aiSwitch',payload:{on:true,disclosure}});
 const turnOff=()=>service.handle(1,{id:`off-${++request}`,type:'site.aiSwitch',payload:{on:false}});
 return{lookups,api,area,store,session,service,commands,scripts,natives,nativeSent,held,messages,port,turnOn,turnOff,setSnapshot:(s:any)=>{snap=s}};
}
async function connected(h:ReturnType<typeof rig>){await h.service.launch({id:1,url:'https://clinicaltrials.gov/search?cond=Asthma'});const p=h.port();p.onMessage.emit({type:'site.authenticate',capability:h.scripts.at(-1).args[0].capability});await flush();return p}
const ranking=(p:any)=>p.sent.filter((v:any)=>v.type==='site.ranking').map((v:any)=>v.state);
const told=(p:any)=>p.sent.filter((v:any)=>v.type==='site.aiConsent').map((v:any)=>v.consent);
const rank=(h:ReturnType<typeof rig>,id='r1')=>h.service.handle(1,{id,type:'site.aiRank',payload:{details:{}}});

test('default off: on a fresh install the overlay is told the switch is off, and a ranking request opens no helper connection',async()=>{
 const h=rig(),p=await connected(h);
 assert.equal(p.sent.find((v:any)=>v.type==='site.ready').aiConsent,null);
 await rank(h);await until(()=>ranking(p).some((s:any)=>s.phase==='off'));
 assert.equal(h.natives.length,0);assert.equal(h.nativeSent.length,0);assert.ok(!h.commands.some(c=>c.type==='reorder'),'the website keeps its own order');assert.equal(h.store.has(RANKING_CONSENT_KEY),false);
 p.disconnect();
});

test('migration: a switch an earlier version saved as on reads as off until the person turns it on again; the display choices are kept',async()=>{
 const h=rig({local:{[UI_PREFS_KEY]:{displayMode:'sidebar',theme:'dark',provider:'openai',localModel:null,aiRanking:'on'}}}),p=await connected(h);
 assert.equal(h.scripts.at(-1).args[0].displayMode,'sidebar','the earlier preferences record still loads');
 assert.equal(p.sent.find((v:any)=>v.type==='site.ready').aiConsent,null,'neither the stored on nor the old browser-session marker counts');
 await rank(h);await until(()=>ranking(p).some((s:any)=>s.phase==='off'));assert.equal(h.nativeSent.length,0,'nothing is sent after the update');
 assert.deepEqual((await h.turnOn()).result,{consent:'openai'});await rank(h,'r2');await until(()=>ranking(p).some((s:any)=>s.phase==='done'));
 assert.deepEqual(h.nativeSent.map(m=>m.type),['prepareRank','executeRank'],'turning it on again is what lets a ranking send');
 p.disconnect();
});

test('turning the switch on records consent in background storage; a ranking then prepares, sends its receipt once, reorders the cards and adds badges',async()=>{
 const h=rig(),p=await connected(h);
 assert.deepEqual((await h.turnOn()).result,{consent:'openai'});
 assert.equal(h.store.get(RANKING_CONSENT_KEY),RANKING_CONSENT_VALUES.openai,'one fixed marker in extension storage');await until(()=>told(p).includes('openai'));
 await h.service.handle(1,{id:'r1',type:'site.aiRank',payload:{details:{ageBand:'30_44',sex:'male'}}});await until(()=>ranking(p).some((s:any)=>s.phase==='done'));
 assert.deepEqual(h.nativeSent.map(m=>m.type),['prepareRank','executeRank']);assert.equal(h.natives.length,1,'one helper connection for the run');
 assert.deepEqual(h.nativeSent[0].payload.profile,{conditions:['Asthma']},'age band and sex stay on this device');
 assert.deepEqual(h.nativeSent[1].payload,{token:TOKEN,digest:DIGEST},'executeRank carries the receipt prepareRank returned on the same connection');
 assert.ok(!ranking(p).some((s:any)=>s.phase==='confirming'),'no confirmation step remains');
 const reorder=h.commands.find(c=>c.type==='reorder');assert.deepEqual(reorder.payload.order,[C,A,B],'best match first, not recruiting last');
 assert.deepEqual(h.scripts.filter(s=>s.args?.[0]?.purpose==='badge').map(s=>s.args[0].nctId),[C,A,B]);
 const badge=h.port('badge',B);badge.onMessage.emit({type:'site.authenticate',capability:h.scripts.filter(s=>s.args?.[0]?.nctId===B).at(-1).args[0].capability});await flush();
 assert.deepEqual(badge.sent.find((v:any)=>v.type==='site.badge'),{type:'site.badge',nctId:B,score:10,label:'not_recruiting'},'the badge gets the capped percentage and a reason id only');
 const done=ranking(p).find((s:any)=>s.phase==='done');assert.equal(done.applied,true);assert.deepEqual(done.studies.map((s:any)=>[s.nctId,s.percent,s.reasonId]),[[C,100,'strong_match'],[A,33,'unclear'],[B,10,'not_recruiting']]);
 /* Later pages rank on their own while the switch stays on. */
 h.setSnapshot({generation:'doc-2',url:'https://clinicaltrials.gov/search?cond=Asthma&page=2',nctIds:[A,C],diagnostic:'Two cards',supported:true});
 await rank(h,'r2');await until(()=>h.nativeSent.length===4);assert.equal(h.natives.length,2);
 p.disconnect();
});

test('Restore original order and turning the switch off put the website order back; off clears the record and tells the overlay',async()=>{
 const h=rig(),p=await connected(h);await h.turnOn();
 await rank(h);await until(()=>ranking(p).some((s:any)=>s.phase==='done'));
 const restores=()=>h.commands.filter(c=>c.type==='restore').length,before=restores();
 assert.deepEqual((await h.turnOff()).result,{consent:null});assert.equal(restores(),before+1,'the ranked page goes back to the website order');
 assert.equal(h.store.has(RANKING_CONSENT_KEY),false,'the record is removed');assert.equal(told(p).at(-1),null);
 await h.turnOn();await rank(h,'r2');await until(()=>ranking(p).filter((s:any)=>s.phase==='done').length===2);
 await h.service.handle(1,{id:'restore',type:'site.restore',payload:{}});assert.equal(restores(),before+2);
 await assert.rejects(h.service.handle(1,{id:'bad',type:'site.aiRank',payload:{details:{name:'Pat Canary'}}}),'no field beyond age band, sex and condition terms is accepted');
 await assert.rejects(h.service.handle(1,{id:'bad2',type:'site.aiRank',payload:{details:{},extra:true}}));
 p.disconnect();
});

test('a Decisions failure still applies the record-check order and reports the failure to the overlay',async()=>{
 const h=rig({decisions:'fail'}),p=await connected(h);await h.turnOn();
 await rank(h);await until(()=>ranking(p).some((s:any)=>s.phase==='done'));
 const done=ranking(p).find((s:any)=>s.phase==='done');assert.equal(done.failure,'API_ERROR');assert.equal(done.applied,true);
 assert.deepEqual(h.commands.find(c=>c.type==='reorder').payload.order,[A,C,B],'website order with the terminated study last');
 p.disconnect();
});

test('turning the switch off mid-ranking aborts it before executeRank: the helper connection closes at once and nothing more is sent',async()=>{
 const h=rig({holdPrepare:true}),p=await connected(h);await h.turnOn();
 await rank(h);await until(()=>h.held.length===1);
 const off=h.turnOff();
 assert.equal(h.natives[0].disconnected,true,'the helper connection closes before the storage write');assert.equal(h.service.ranker.isRunning(1),false);
 assert.deepEqual((await off).result,{consent:null});assert.equal(h.store.has(RANKING_CONSENT_KEY),false);
 h.held[0]();await flush();await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(h.nativeSent.map(m=>m.type),['prepareRank'],'no executeRank');
 await rank(h,'r2');await until(()=>ranking(p).at(-1)?.phase==='off');
 assert.deepEqual(h.nativeSent.map(m=>m.type),['prepareRank'],'no further sends');assert.equal(h.natives.length,1,'no new helper connection');
 p.disconnect();
});

test('the record cleared in storage from elsewhere stops ranking, restores the page and tells the overlay',async()=>{
 const h=rig(),p=await connected(h);await h.turnOn();await rank(h);await until(()=>ranking(p).some((s:any)=>s.phase==='done'));
 const restores=h.commands.filter(c=>c.type==='restore').length;
 await h.area.remove(RANKING_CONSENT_KEY);await until(()=>told(p).at(-1)===null);
 await until(()=>h.commands.filter(c=>c.type==='restore').length===restores+1);
 await rank(h,'r2');await until(()=>ranking(p).at(-1)?.phase==='off');assert.equal(h.nativeSent.filter(m=>m.type==='executeRank').length,1);
 p.disconnect();
});

test('switch changes apply in arrival order: an off that arrives while a turn-on is being stored wins, and so does a later on',async()=>{
 const h=rig(),p=await connected(h);
 const results=await Promise.allSettled([h.turnOn(),h.turnOff()]);
 assert.equal(results[0].status,'rejected','the earlier turn-on is superseded');assert.equal(h.store.has(RANKING_CONSENT_KEY),false,'the later off wins');assert.equal(await h.service.aiConsent(),null);
 await Promise.all([h.turnOff(),h.turnOn()]);assert.equal(h.store.get(RANKING_CONSENT_KEY),RANKING_CONSENT_VALUES.openai,'a later on wins over an earlier off');assert.equal(await h.service.aiConsent(),'openai');
 p.disconnect();
});

test('only the authenticated overlay port changes the switch: malformed changes, runtime messages and unauthenticated ports are refused',async()=>{
 const h=rig(),p=await connected(h);
 for(const payload of [{on:true},{on:true,disclosure:'anthropic'},{on:'yes',disclosure:'openai'},{on:true,disclosure:'openai',extra:1},{on:false,disclosure:'openai'},{}])await assert.rejects(h.service.handle(1,{id:'bad',type:'site.aiSwitch',payload}),JSON.stringify(payload));
 const overlayFrame={id:'test',url:origin+'/overlay.html',frameId:2,documentId:'overlay-document',tab:{id:1,url:'https://clinicaltrials.gov/search?cond=Asthma'}};
 for(const message of [{kind:'site.confirmSend',accepted:true},{kind:'site.confirmContext'},{id:'x',type:'site.aiSwitch',payload:{on:true,disclosure:'openai'}},{kind:'treatable.site.content',type:'aiSwitch',on:true}])for(const sender of [overlayFrame,{id:'test',url:origin+'/confirm-send.html',frameId:0,documentId:'confirm-doc',tab:{id:9,windowId:2,url:origin+'/confirm-send.html'}},{id:'test',url:'https://clinicaltrials.gov/search?cond=Asthma',frameId:0,tab:{id:1}}]){let reply:any;h.messages.emit(message,sender,(v:any)=>{reply=v});assert.equal(reply,undefined,JSON.stringify(message))}
 const stranger=h.port();stranger.onMessage.emit({id:'s',type:'site.aiSwitch',payload:{on:true,disclosure:'openai'}});await flush();assert.equal(stranger.closed,true,'a port that never authenticated is dropped');
 assert.equal(h.store.has(RANKING_CONSENT_KEY),false,'nothing turned the switch on');
 p.onMessage.emit({id:'ok',type:'site.aiSwitch',payload:{on:true,disclosure:'openai'}});await until(()=>p.sent.some((v:any)=>v.id==='ok'));
 assert.deepEqual(p.sent.find((v:any)=>v.id==='ok'),{id:'ok',ok:true,result:{consent:'openai'}});
 p.disconnect();
});

test('a switch turned on beside the local model disclosure does not cover OpenAI: with OpenAI chosen, nothing is sent',async()=>{
 const prefs={displayMode:'popup',theme:'system',provider:'local',localModel:'qwen3.5:9b'};
 const h=rig({local:{[UI_PREFS_KEY]:prefs}}),p=await connected(h);
 assert.deepEqual((await h.turnOn('local')).result,{consent:'local'});assert.equal(h.store.get(RANKING_CONSENT_KEY),RANKING_CONSENT_VALUES.local);
 await h.area.set({[UI_PREFS_KEY]:{...prefs,provider:'openai'}});await flush();
 await rank(h);await until(()=>ranking(p).some((s:any)=>s.phase==='off'));assert.equal(h.nativeSent.length,0);
 p.disconnect();
});

test('closing the overlay mid-ranking stops it before anything is scored',async()=>{
 const h=rig({holdPrepare:true}),p=await connected(h);await h.turnOn();
 await rank(h);await until(()=>h.held.length===1);
 p.disconnect();await flush();h.held[0]();await flush();await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(h.nativeSent.map(m=>m.type),['prepareRank'],'no executeRank after the overlay is gone');assert.equal(h.natives[0].disconnected,true);assert.equal(h.service.ranker.isRunning(1),false);
});

test('a replacement overlay stops the earlier overlay ranking before anything is scored',async()=>{
 const h=rig({holdPrepare:true});await connected(h);await h.turnOn();
 await rank(h);await until(()=>h.held.length===1);assert.equal(h.service.ranker.isRunning(1),true);
 const replacement=h.port();replacement.sender.documentId='replacement-document';replacement.onMessage.emit({type:'site.authenticate',capability:h.service.caps.create(1,'overlay')});await flush();
 assert.equal(h.service.ranker.isRunning(1),false,'the replaced overlay ranking is stopped');
 h.held[0]();await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(h.nativeSent.map(m=>m.type),['prepareRank'],'no executeRank for the replaced overlay');
 replacement.disconnect();
});

test('hiding the popup stops a running ranking and sends nothing; while hidden the switch cannot be turned on and no ranking starts; shown again, it ranks',async()=>{
 const h=rig({holdPrepare:true}),p=await connected(h);await h.turnOn();
 await rank(h);await until(()=>h.held.length===1);
 await h.service.handle(1,{id:'h',type:'site.hide',payload:{expiresAt:Date.now()+60000}});
 assert.equal(h.service.ranker.isRunning(1),false,'the ranking stops');assert.equal(h.natives[0].disconnected,true);
 h.held[0]();await flush();assert.deepEqual(h.nativeSent.map(m=>m.type),['prepareRank'],'nothing is scored or sent');
 await assert.rejects(rank(h,'r2'),'no ranking starts while hidden');
 await h.turnOff();await assert.rejects(h.turnOn(),'the switch cannot be turned on while Treatable is hidden');assert.equal(h.store.has(RANKING_CONSENT_KEY),false);
 await h.service.launch({id:1,url:'https://clinicaltrials.gov/search?cond=Asthma'});
 await h.turnOn();await rank(h,'r3');await until(()=>h.held.length===2);h.held[1]();
 await until(()=>ranking(p).some((s:any)=>s.phase==='done'));assert.deepEqual(h.nativeSent.map(m=>m.type),['prepareRank','prepareRank','executeRank']);
 p.disconnect();
});

test('navigating while a ranking is being prepared cancels the run: nothing is scored for the page it left',async()=>{
 const h=rig({holdPrepare:true}),p=await connected(h);await h.turnOn();
 await rank(h);await until(()=>h.held.length===1);
 h.api.tabs.onUpdated.emit(1,{status:'loading'},{id:1,url:'https://clinicaltrials.gov/search?cond=Asthma'});
 assert.equal(h.natives[0].disconnected,true);h.held[0]();await flush();await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(h.nativeSent.map(m=>m.type),['prepareRank'],'the cancelled run never executes');
 p.disconnect();
});

test('site.ping never extends an applied ranking: the applied order lapses five minutes after it was applied',async t=>{
 const h=rig(),p=await connected(h);await h.turnOn();await rank(h);await until(()=>ranking(p).some((s:any)=>s.phase==='done'&&s.applied));
 t.mock.timers.enable({apis:['Date'],now:Date.now()});const start=Date.now();
 assert.deepEqual((await h.service.handle(1,{id:'ping',type:'site.ping',payload:{generation:'doc-1'}})).result,{active:true});
 t.mock.timers.setTime(start+4*60*1000);assert.deepEqual((await h.service.handle(1,{id:'alive',type:'site.ping',payload:{generation:'doc-1'}})).result,{active:true});
 t.mock.timers.setTime(start+6*60*1000);await assert.rejects(h.service.handle(1,{id:'expired',type:'site.rank',payload:{generation:'doc-1'}}),'the applied order expired even though the search session was pinged');
 p.disconnect();
});

test('a title the ranking facts already hold is used without another lookup',async()=>{
 const h=rig(),p=await connected(h);await h.turnOn();
 await h.service.handle(1,{id:'r1',type:'site.aiRank',payload:{details:{ageBand:'30_44',sex:'male'}}});
 await until(()=>ranking(p).some((s:any)=>s.phase==='done'));
 const before=h.lookups.length;assert.ok(before>=3);
 assert.deepEqual(await h.service.publicStudyTitles([A]),[{nctId:A,title:'Study A'}]);assert.equal(h.lookups.length,before,'no lookup: the title came from the rank facts');
});
test('site.openSearch ends the derived ranking: the page is restored and the navigation is requested',async()=>{
 const h=rig(),p=await connected(h);await h.turnOn();
 await h.service.handle(1,{id:'r1',type:'site.aiRank',payload:{details:{ageBand:'30_44',sex:'male'}}});
 await until(()=>ranking(p).some((s:any)=>s.phase==='done'));
 const restores=()=>h.commands.filter(c=>c.type==='restore').length,before=restores(),navs:any[]=[];h.api.tabs.update=async(id:number,v:any)=>{navs.push({id,...v})};
 await h.service.handle(1,{id:'os',type:'site.openSearch',payload:{}});await flush();
 assert.equal(restores(),before+1,'the reordered cards are restored when the session ends');assert.deepEqual(navs,[{id:1,url:'https://clinicaltrials.gov/'}]);
});

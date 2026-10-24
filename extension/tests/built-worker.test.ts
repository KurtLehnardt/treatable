import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import vm from'node:vm';
const bundle=readFileSync(new URL('../dist/background.js',import.meta.url),'utf8');
async function brokerRead(url:string){let listener:any,captured:any;const id='lmgmjeabbalehlcakdbolielnfgchojf';const chrome={runtime:{id,onMessage:{addListener:(fn:any)=>{listener=fn}}},action:{onClicked:{addListener:()=>{}}},tabs:{query:async()=>[{id:1,url}]},scripting:{executeScript:async(options:any)=>{captured=options;return[{result:{url,title:'Study',text:'Clinical study information for participants.'}}]}}};vm.runInNewContext(bundle,{chrome,URL,setTimeout,clearTimeout,TextDecoder,TextEncoder});const reply=await new Promise<any>(resolve=>{listener({kind:'readPage'},{id,url:`chrome-extension://${id}/panel.html`},resolve)});return{reply,captured}}
test('built service worker rejects unsupported tabs before script injection',async()=>{const{reply,captured}=await brokerRead('https://clinicaltrials.gov.evil.example/study/NCT12345678');assert.equal(reply.ok,false);assert.equal(captured,undefined)});
test('actual bundled reader survives Chrome-style function serialization with no module closures',async()=>{const{reply,captured}=await brokerRead('https://clinicaltrials.gov/study/NCT12345678');assert.equal(reply.ok,true);assert.ok(captured);const parent={closest:()=>null};let read=false;const scope={location:{origin:'https://clinicaltrials.gov',href:'https://clinicaltrials.gov/study/NCT12345678'},window:{getSelection:()=>null},document:{title:'Study',body:{},createTreeWalker:()=>({nextNode:()=>read?null:(read=true,{parentElement:parent,textContent:'Visible study information.'})})},NodeFilter:{SHOW_TEXT:4},getComputedStyle:()=>({display:'block',visibility:'visible'})};const serialized=vm.runInNewContext(`(${captured.func.toString()})`,scope);const result=serialized(...captured.args);assert.match(result.text,/Visible study information/);assert.equal(result.url,scope.location.href);});

function nativeBroker(){
 let listener:any,onNativeMessage:any,onDisconnect:any;const sent:any[]=[];const id='lmgmjeabbalehlcakdbolielnfgchojf';
 const nativePort={postMessage:(value:any)=>sent.push(value),onMessage:{addListener:(fn:any)=>onNativeMessage=fn},onDisconnect:{addListener:(fn:any)=>onDisconnect=fn},disconnect:()=>onDisconnect?.()};
 const chrome={runtime:{id,connectNative:()=>nativePort,onMessage:{addListener:(fn:any)=>listener=fn}},action:{onClicked:{addListener:()=>{}}}};
 vm.runInNewContext(bundle,{chrome,URL,setTimeout,clearTimeout,TextDecoder,TextEncoder});
 const send=(request:any)=>new Promise<any>(resolve=>listener({kind:'native',request},{id,url:`chrome-extension://${id}/panel.html`},resolve));
 return{sent,send,reply:(value:any)=>onNativeMessage(value),disconnect:()=>nativePort.disconnect()};
}
test('built native broker rejects duplicate IDs without overwriting the first response',async()=>{
 const broker=nativeBroker();const first=broker.send({id:'same_id',type:'status',payload:{}});assert.equal(broker.sent.length,1);
 const duplicate=await broker.send({id:'same_id',type:'status',payload:{}});assert.equal(duplicate.ok,false);assert.equal(broker.sent.length,1);
 broker.reply({id:'same_id',type:'status',ok:true,models:[{name:'installed:local'}]});assert.equal((await first).ok,true);broker.disconnect();
});
test('built native broker rejects malformed replies and strips native error content',async()=>{
 const broker=nativeBroker();const first=broker.send({id:'first',type:'status',payload:{}});
 broker.reply({id:'first',type:'status',ok:true,models:[{name:'remote:cloud'}],message:'SyntheticPrivateName'});
 const invalid=await first;assert.equal(invalid.ok,false);assert.doesNotMatch(JSON.stringify(invalid),/SyntheticPrivateName/);
 const second=broker.send({id:'second',type:'status',payload:{}});broker.reply({id:'second',type:'status',ok:false,models:[],message:'SyntheticPrivateName'});
 assert.doesNotMatch(JSON.stringify(await second),/SyntheticPrivateName/);broker.disconnect();
});
test('built native broker validates operations before opening a native port',async()=>{
 const broker=nativeBroker();for(const request of [{id:123,type:'status',payload:{}},{id:'x',type:'status',payload:[]},{id:'x',type:'status',payload:{unexpected:'SyntheticPrivateName'}},{id:'x',type:'generate',payload:{model:'remote:cloud',prompt:'SyntheticPrivateName'}}]){
 const reply=await broker.send(request);assert.equal(reply.ok,false);assert.doesNotMatch(JSON.stringify(reply),/SyntheticPrivateName/)}assert.equal(broker.sent.length,0);
});

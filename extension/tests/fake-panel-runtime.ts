import {PUBLIC_CATALOG_METADATA} from '../shared/public-catalog.mjs';
import {REAL_POLICY_VERSION} from '../shared/real-contract.mjs';
import {getDemoFixture} from '../shared/demo-fixtures.mjs';
export class Emitter<T>{listeners:((value:T)=>void)[]=[];addListener=(fn:(value:T)=>void)=>{this.listeners.push(fn)};emit=(value:T)=>{for(const fn of this.listeners)fn(value)}}
export class FakePort{
 onMessage=new Emitter<any>();onDisconnect=new Emitter<void>();closed=false;sent:any[]=[];
 constructor(private runtime:FakeRuntime){}
 postMessage=(message:any)=>{this.sent.push(message);this.runtime.sent.push(message);const request=message.request;if(request?.type==='status')queueMicrotask(()=>this.reply(this.runtime.statusFailure?{id:request.id,type:'result',ok:false,code:this.runtime.statusFailure,error:'ignored provider text'}:{id:request.id,type:'status',ok:true,provider:'openai',configured:true,message:'ignored provider text'}));if(request?.type==='revokeReal')queueMicrotask(()=>this.reply({id:request.id,type:'result',ok:true}));if(['prepareReal','executeReal','scoreDemo','agentDemo'].includes(request?.type))this.runtime.operations.push({port:this,request})};
 reply=(reply:any)=>this.onMessage.emit({reply});
 disconnect=()=>{if(this.closed)return;this.closed=true;this.onDisconnect.emit()};
}
export class FakeRuntime{
 sent:any[]=[];ports:FakePort[]=[];operations:{port:FakePort;request:any}[]=[];pageResolve?:((value:any)=>void);id='lmgmjeabbalehlcakdbolielnfgchojf';statusFailure?:string;
 getURL=(path:string)=>path;
 connect=()=>{const port=new FakePort(this);this.ports.push(port);queueMicrotask(()=>port.onMessage.emit({kind:'panelReady'}));return port};
 sendMessage=async(message:any)=>{this.sent.push(message);if(message.kind==='readPage')return await new Promise(resolve=>{this.pageResolve=resolve});throw new Error('Unsupported test request')};
 prepared=(operation=this.operations.at(-1)!,expiresAt=Date.now()+300000)=>{const packet=operation.request.payload.packet;operation.port.reply({id:operation.request.id,type:'result',ok:true,result:{kind:'preparedReal',token:'A'.repeat(43),digest:'b'.repeat(64),expiresAt,policyVersion:REAL_POLICY_VERSION,catalogMetadata:PUBLIC_CATALOG_METADATA,preview:{packet,decisionsRequest:{input_json:{patient:packet}},agentsRequest:{input:JSON.stringify(packet)},toolResults:packet.selectedNctIds.map((id:string)=>({nctId:id}))}}})};
 realScore=(operation=this.operations.at(-1)!,ids:string[])=>operation.port.reply({id:operation.request.id,type:'result',ok:true,result:{kind:'scoreReal',mode:'test',consentDigest:'b'.repeat(64),scores:ids.map(nctId=>({nctId,index:50,confidence:.5}))}});
 fail=(code:string,operation=this.operations.at(-1)!)=>operation.port.reply({id:operation.request.id,type:'result',ok:false,code,error:'SyntheticPrivateName transported text'});
 score=(operation=this.operations.at(-1)!)=>{const f=getDemoFixture(operation.request.payload.fixtureId);operation.port.reply({id:operation.request.id,type:'result',ok:true,result:{kind:'scoreDemo',fixtureId:f.id,mode:'test',scores:f.studies.map(s=>({nctId:s.id,index:50,confidence:.5}))}})};
}

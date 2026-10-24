import {getDemoFixture} from '../shared/demo-fixtures.mjs';
export class Emitter<T>{listeners:((value:T)=>void)[]=[];addListener=(fn:(value:T)=>void)=>{this.listeners.push(fn)};emit=(value:T)=>{for(const fn of this.listeners)fn(value)}}
export class FakePort{
 onMessage=new Emitter<any>();onDisconnect=new Emitter<void>();closed=false;sent:any[]=[];
 constructor(private runtime:FakeRuntime){}
 postMessage=(message:any)=>{this.sent.push(message);this.runtime.sent.push(message);const request=message.request;if(request?.type==='status')queueMicrotask(()=>this.reply({id:request.id,type:'status',ok:true,provider:'openai',configured:true,message:'ignored provider text'}));if(request?.type==='scoreDemo'||request?.type==='agentDemo')this.runtime.operations.push({port:this,request})};
 reply=(reply:any)=>this.onMessage.emit({reply});
 disconnect=()=>{if(this.closed)return;this.closed=true;this.onDisconnect.emit()};
}
export class FakeRuntime{
 sent:any[]=[];ports:FakePort[]=[];operations:{port:FakePort;request:any}[]=[];pageResolve?:((value:any)=>void);id='lmgmjeabbalehlcakdbolielnfgchojf';
 getURL=(path:string)=>path;
 connect=()=>{const port=new FakePort(this);this.ports.push(port);queueMicrotask(()=>port.onMessage.emit({kind:'panelReady'}));return port};
 sendMessage=async(message:any)=>{this.sent.push(message);if(message.kind==='readPage')return await new Promise(resolve=>{this.pageResolve=resolve});throw new Error('Unsupported test request')};
 score=(operation=this.operations.at(-1)!)=>{const f=getDemoFixture(operation.request.payload.fixtureId);operation.port.reply({id:operation.request.id,type:'result',ok:true,result:{kind:'scoreDemo',fixtureId:f.id,mode:'test',scores:f.studies.map(s=>({nctId:s.id,index:50,confidence:.5}))}})};
}

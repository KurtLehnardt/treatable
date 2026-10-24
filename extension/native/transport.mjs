import https from 'node:https';
export class ApiError extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}
const MAX_JSON=1024*1024;
export class OpenAITransport{
 constructor(key){if(typeof key!=='string'||!/^sk-[A-Za-z0-9_-]{10,500}$/.test(key))throw new ApiError('KEY_MISSING');this.key=key;this.mode='live';}
 clear(){this.key=undefined;}
 async request(method,path,body,{signal,stream=false,timeout=30000}={}){
  if(!this.key)throw new ApiError('KEY_MISSING');
  if(!/^\/v1\/(?:decisions|agents\/sessions(?:\/[A-Za-z0-9_-]{1,160}(?:\/events)?)?)$/.test(path)||!['GET','POST','DELETE'].includes(method))throw new ApiError('INVALID_ENDPOINT');
  const encoded=body===undefined?undefined:Buffer.from(JSON.stringify(body));if(encoded?.length>96*1024)throw new ApiError('INPUT_TOO_LARGE');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
  const response=await new Promise((resolve,reject)=>{
   const request=https.request({hostname:'api.openai.com',servername:'api.openai.com',port:443,path,method,agent:false,rejectUnauthorized:true,minVersion:'TLSv1.2',signal:combined,headers:{Authorization:`Bearer ${this.key}`,'Content-Type':'application/json',...(path.includes('/agents/')?{'OpenAI-Beta':'agents=v1'}:{}),...(encoded?{'Content-Length':encoded.length}:{}),Accept:stream?'text/event-stream':'application/json'}},resolve);
   request.on('error',()=>reject(new ApiError(combined.aborted?'CANCELLED':'NETWORK_ERROR')));if(encoded)request.write(encoded);request.end();
  });
  if(response.statusCode<200||response.statusCode>=300){response.resume();throw new ApiError(response.statusCode===401?'KEY_REJECTED':response.statusCode===403?'API_PERMISSION':response.statusCode===429?'RATE_LIMITED':'API_ERROR',response.statusCode);}
  if(stream){if(!String(response.headers['content-type']).includes('text/event-stream')){response.destroy();throw new ApiError('INVALID_STREAM');}return this.events(response,combined);}
  let bytes=0;const chunks=[];for await(const chunk of response){bytes+=chunk.length;if(bytes>MAX_JSON){response.destroy();throw new ApiError('OUTPUT_TOO_LARGE');}chunks.push(chunk);}if(!bytes)return{};
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new ApiError('INVALID_API_RESPONSE');}
 }
 async *events(response,signal){let buffer='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});
  try{for await(const chunk of response){bytes+=chunk.length;if(bytes>MAX_JSON)throw new ApiError('OUTPUT_TOO_LARGE');buffer+=decoder.decode(chunk,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');if(buffer.length>128*1024)throw new ApiError('OUTPUT_TOO_LARGE');let index;while((index=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,index);buffer=buffer.slice(index+2);const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data||data==='[DONE]')continue;let event;try{event=JSON.parse(data);}catch{throw new ApiError('INVALID_STREAM');}yield event;}}if(buffer.trim())throw new ApiError('INCOMPLETE_STREAM');}catch(error){throw error instanceof ApiError?error:new ApiError(signal?.aborted?'CANCELLED':'STREAM_ERROR');}finally{response.destroy();}
 }
}

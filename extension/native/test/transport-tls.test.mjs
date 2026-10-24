import test from 'node:test';import assert from 'node:assert/strict';import https from 'node:https';import{EventEmitter}from'node:events';import{PassThrough}from'node:stream';
import{OpenAITransport}from'../transport.mjs';

test('HTTPS options pin api.openai.com SNI, TLS 1.2+, certificate verification and no shared agent or proxy routing',async()=>{
 const original=https.request,seen=[];https.request=(options,callback)=>{seen.push(options);const request=new EventEmitter();request.write=()=>{};request.end=()=>queueMicrotask(()=>{const response=new PassThrough();response.statusCode=200;response.headers={'content-type':'application/json'};callback(response);response.end('{}');});return request;};
 const transport=new OpenAITransport('sk-test-not-a-real-secret');try{assert.deepEqual(await transport.request('POST','/v1/decisions',{}),{});await transport.request('GET','/v1/agents/sessions/sess_1');
  for(const o of seen){assert.equal(o.hostname,'api.openai.com');assert.equal(o.servername,'api.openai.com');assert.equal(o.port,443);assert.equal(o.minVersion,'TLSv1.2');assert.equal(o.rejectUnauthorized,true);assert.equal(o.agent,false);for(const key of ['host','proxy','lookup','ca','checkServerIdentity','socketPath','maxVersion'])assert.equal(o[key],undefined);}
  assert.equal(seen[1].headers['OpenAI-Beta'],'agents=v1');await assert.rejects(transport.request('POST','https://evil.invalid/v1/decisions',{}),e=>e.code==='INVALID_ENDPOINT');assert.equal(seen.length,2);
 }finally{https.request=original;transport.clear();}
});

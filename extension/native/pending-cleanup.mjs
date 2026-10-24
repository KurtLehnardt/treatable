// Crash-safe list of provider Agents session IDs whose deletion has not been confirmed. It holds ONLY opaque provider session IDs and
// timestamps: no health data, prompts, request IDs or keys. The file lives in the installed host directory (0700) with mode 0600.
import{readFile,writeFile,rename,chmod}from'node:fs/promises';
// Same provider-ID pattern provider.mjs, transport.mjs and the trace contract use for session IDs (it also keeps argv and URL paths safe).
export const PROVIDER_ID=/^[A-Za-z0-9_-]{1,160}$/;
export const MAX_PENDING=50,MAX_AGE_MS=24*60*60*1000;
// A later host deletes a leftover only once it is older than any live run (90 s agent budget + 5.5 s cleanup), so a concurrent host's session is never touched.
export const MIN_LEFTOVER_AGE_MS=10*60*1000;
export const PENDING_FILE='pending-cleanup.json';
const MAX_FILE_BYTES=16*1024;
export const validSessionId=v=>typeof v==='string'&&PROVIDER_ID.test(v);
export class PendingCleanup{
 constructor(file,{now=()=>Date.now()}={}){this.file=file;this.now=now;this.queue=Promise.resolve();}
 // Never throws: a missing, oversized or malformed file reads as empty; invalid, duplicate, future or expired (24 h) entries are dropped.
 async read(){try{const bytes=await readFile(this.file);if(bytes.length>MAX_FILE_BYTES)return[];const rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!Array.isArray(rows))return[];const now=this.now(),seen=new Set(),valid=[];
  for(const e of rows)if(e&&typeof e==='object'&&!Array.isArray(e)&&Object.keys(e).length===2&&validSessionId(e.id)&&Number.isSafeInteger(e.at)&&e.at<=now+60000&&now-e.at<MAX_AGE_MS&&!seen.has(e.id)){seen.add(e.id);valid.push({id:e.id,at:e.at});}
  return valid.slice(-MAX_PENDING);}catch{return[];}}
 async #write(rows){const tmp=`${this.file}.tmp`;await writeFile(tmp,JSON.stringify(rows.slice(-MAX_PENDING)),{mode:0o600});await chmod(tmp,0o600);await rename(tmp,this.file);}
 // Serialized read-modify-write within this process. Failures are swallowed so bookkeeping can never break or delay a run.
 #update(change){const run=this.queue.then(async()=>{const rows=await this.read(),next=change(rows);if(next)await this.#write(next);}).catch(()=>{});this.queue=run;return run;}
 add(id){if(!validSessionId(id))return this.queue;return this.#update(rows=>[...rows.filter(e=>e.id!==id),{id,at:this.now()}]);}
 remove(ids){const gone=new Set(ids);return this.#update(rows=>rows.some(e=>gone.has(e.id))?rows.filter(e=>!gone.has(e.id)):undefined);}
}
// DELETE each session with short timeouts inside one overall budget. Returns the IDs confirmed gone: HTTP 2xx or 404. Never throws.
// cancelFirst mirrors provider.mjs for a session that may still be running: a best-effort cancel event (1 s), then DELETE.
export async function deleteSessions(transport,ids,{timeout=3000,budget=12000,attempts=1,retryDelay=0,cancelFirst=false,signal}={}){const done=[],deadline=Date.now()+budget,limit=ms=>Math.max(1,Math.min(ms,deadline-Date.now()));
 for(const id of ids){if(!validSessionId(id))continue;
  if(cancelFirst&&deadline>Date.now()&&!signal?.aborted){try{await transport.request('POST',`/v1/agents/sessions/${id}/events`,{events:[{type:'agent.session.input.cancel'}]},{signal,timeout:limit(1000)});}catch{}}
  for(let attempt=0;attempt<attempts;attempt++){if(attempt&&retryDelay)await new Promise(r=>setTimeout(r,Math.min(retryDelay,Math.max(0,deadline-Date.now()))));if(deadline<=Date.now()||signal?.aborted)return done;
   try{await transport.request('DELETE',`/v1/agents/sessions/${id}`,undefined,{signal,timeout:limit(timeout)});done.push(id);break;}catch(error){if(error?.status===404){done.push(id);break;}}}}
 return done;}

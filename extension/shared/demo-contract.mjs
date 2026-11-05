// Base native-message contract shared by every helper operation: ID, key and size checks, and trace frames. The demo, bundled-catalog
// and private-matching operations this file was named for were removed; the name stays so existing imports keep working.
export const MAX_MESSAGE_BYTES = 96 * 1024;
export const MAX_ID_LENGTH = 80;
export const CLEANUP_FAILURE_CODES=Object.freeze(['KEY_MISSING','KEY_REJECTED','API_PERMISSION','RATE_LIMITED','API_ERROR','NETWORK_ERROR','CANCELLED','INVALID_API_RESPONSE','OUTPUT_TOO_LARGE','INVALID_DELETE_ACK','MISSING_SESSION_ID','CLEANUP_ERROR']);
export const TRACE_STAGES = Object.freeze(['decisions.request','decisions.complete','agent.request','agent.session.created','agent.tool.request','agent.tool.result','agent.complete','agent.cleanup.deleted','agent.cleanup.failed','local.runtime.start','local.runtime.ready','local.brief.request','local.brief.complete','local.routing.request','local.routing.complete','cancelled','failed']);
export function isRecord(v){return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;}
export function exactKeys(v,keys){return isRecord(v)&&Object.keys(v).every(k=>keys.includes(k));}
export function validId(v){return typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);}
// Template/caution ID lists: strings only, own keys of the fixed table (never inherited or coerced), and no duplicates.
export function templateIdList(v,table,min,max){return Array.isArray(v)&&v.length>=min&&v.length<=max&&v.every(x=>typeof x==='string'&&Object.hasOwn(table,x))&&new Set(v).size===v.length;}
export function utf8Bytes(v){return new TextEncoder().encode(typeof v==='string'?v:JSON.stringify(v)).length;}
/** Validates one helper frame for its request ID: a trace, or a result that is an error or a bare acknowledgement. */
export function parseDemoReply(v,expectedId){
 if(!isRecord(v)||v.id!==expectedId||!validId(v.id)||utf8Bytes(v)>MAX_MESSAGE_BYTES||typeof v.ok!=='boolean')throw new Error('Invalid native reply');
 if(v.type==='trace'){
  if(!exactKeys(v,['id','type','ok','trace'])||v.ok!==true||!exactKeys(v.trace,['sequence','stage','nctId','sessionId','requestId','httpStatus','cleanupCode','cleanupAttempts'])||!Number.isSafeInteger(v.trace.sequence)||v.trace.sequence<1||v.trace.sequence>100||!TRACE_STAGES.includes(v.trace.stage))throw new Error('Invalid trace');
  if(v.trace.nctId!==undefined&&!/^NCT\d{8}$/.test(v.trace.nctId))throw new Error('Invalid trace ID');
  for(const k of ['sessionId','requestId'])if(v.trace[k]!==undefined&&(typeof v.trace[k]!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(v.trace[k])))throw new Error('Invalid provider ID');
  if(v.trace.httpStatus!==undefined&&(!Number.isInteger(v.trace.httpStatus)||v.trace.httpStatus<100||v.trace.httpStatus>599))throw new Error('Invalid HTTP status');
  const cleanupStage=['agent.cleanup.failed','agent.cleanup.deleted'].includes(v.trace.stage);
  if(v.trace.cleanupCode!==undefined&&(v.trace.stage!=='agent.cleanup.failed'||!CLEANUP_FAILURE_CODES.includes(v.trace.cleanupCode)))throw new Error('Invalid cleanup reason');
  if(v.trace.cleanupAttempts!==undefined&&(!cleanupStage||!Number.isInteger(v.trace.cleanupAttempts)||v.trace.cleanupAttempts<0||v.trace.cleanupAttempts>2))throw new Error('Invalid cleanup attempt count');
  if(v.trace.cleanupCode!==undefined&&v.trace.cleanupAttempts===undefined)throw new Error('Missing cleanup attempt count');
 }else if(v.type==='result'){
  if(!exactKeys(v,['id','type','ok','result','error','code']))throw new Error('Invalid result reply');
  if(!v.ok){if(typeof v.error!=='string'||v.error.length>300||typeof v.code!=='string'||!/^[A-Z_]{1,40}$/.test(v.code))throw new Error('Invalid error reply');}
  // Successful results are validated by the contract of their own operation (apply-contract.mjs, rank-contract.mjs), never here.
  else if(v.result!==undefined)throw new Error('Unvalidated result reply');
 }else throw new Error('Invalid reply type');
 return v;
}


import{parseRealRequest,parseRealResult,parsePreparedResult}from './real-contract.mjs';
// Typed native contract. Raw private fields and arbitrary prompts are rejected; real data requires a prepared consent receipt.
export const FIXTURE_IDS = Object.freeze(['fibromyalgia', 'pancreatic', 'neuropathy']);
export const MAX_MESSAGE_BYTES = 96 * 1024;
export const MAX_ID_LENGTH = 80;
export const QUESTION_TEMPLATES = Object.freeze({eligibility:'Which eligibility criteria would the study team need to confirm?',visits:'How many visits and overnight stays are required?',costs:'Which study-related costs and travel expenses are covered?',placebo:'Could I receive a placebo or be assigned to a comparison group?',travel:'Can any visits happen remotely or at a nearer study site?',contacts:'Who should my clinician contact for the current screening process?'});
export const CAUTION_TEMPLATES = Object.freeze({team_confirms:'Only the study team can confirm eligibility.',snapshot:'These public records are an offline snapshot; recruitment and details may change.',no_benefit_promise:'Study participation does not guarantee treatment benefit.'});
export const CLEANUP_FAILURE_CODES=Object.freeze(['KEY_MISSING','KEY_REJECTED','API_PERMISSION','RATE_LIMITED','API_ERROR','NETWORK_ERROR','CANCELLED','INVALID_API_RESPONSE','OUTPUT_TOO_LARGE','INVALID_DELETE_ACK','MISSING_SESSION_ID','CLEANUP_ERROR']);
export const TRACE_STAGES = Object.freeze(['decisions.request','decisions.complete','agent.request','agent.session.created','agent.tool.request','agent.tool.result','agent.complete','agent.cleanup.deleted','agent.cleanup.failed','cancelled','failed']);
export function isRecord(v){return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;}
export function exactKeys(v,keys){return isRecord(v)&&Object.keys(v).every(k=>keys.includes(k));}
export function validId(v){return typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);}
// Template/caution ID lists: strings only, own keys of the fixed table (never inherited or coerced), and no duplicates.
export function templateIdList(v,table,min,max){return Array.isArray(v)&&v.length>=min&&v.length<=max&&v.every(x=>typeof x==='string'&&Object.hasOwn(table,x))&&new Set(v).size===v.length;}
export function utf8Bytes(v){return new TextEncoder().encode(typeof v==='string'?v:JSON.stringify(v)).length;}
export function parseDemoRequest(v){
 if(['prepareReal','executeReal','revokeReal'].includes(v?.type))return parseRealRequest(v);
 if(!exactKeys(v,['id','type','payload'])||!validId(v.id)||utf8Bytes(v)>MAX_MESSAGE_BYTES||!isRecord(v.payload))throw new Error('Invalid native request');
 if(v.type==='status'){if(Object.keys(v.payload).length)throw new Error('Invalid status');}
 else if(v.type==='cancel'){if(!exactKeys(v.payload,['requestId'])||!validId(v.payload.requestId))throw new Error('Invalid cancel');}
 else if(v.type==='scoreDemo'||v.type==='agentDemo'){
  if(!exactKeys(v.payload,['fixtureId','studyIds','consent'])||!FIXTURE_IDS.includes(v.payload.fixtureId)||v.payload.consent!==true)throw new Error('A fictional fixture and explicit consent are required');
  if(v.payload.studyIds!==undefined&&(!Array.isArray(v.payload.studyIds)||v.payload.studyIds.length<1||v.payload.studyIds.length>3||new Set(v.payload.studyIds).size!==v.payload.studyIds.length||v.payload.studyIds.some(x=>typeof x!=='string'||!/^NCT\d{8}$/.test(x))))throw new Error('Invalid public study IDs');
 }else throw new Error('Unsupported native operation');
 return v;
}
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
 }else if(v.type==='status'){
  if(!exactKeys(v,['id','type','ok','provider','configured','message'])||v.provider!=='openai'||typeof v.configured!=='boolean'||typeof v.message!=='string'||v.message.length>300)throw new Error('Invalid status reply');
 }else if(v.type==='result'){
  if(!exactKeys(v,['id','type','ok','result','error','code']))throw new Error('Invalid result reply');
  if(!v.ok){if(typeof v.error!=='string'||v.error.length>300||typeof v.code!=='string'||!/^[A-Z_]{1,40}$/.test(v.code))throw new Error('Invalid error reply');}
  else if(v.result!==undefined){if(v.result?.kind==='preparedReal')parsePreparedResult(v.result);else if(['scoreReal','agentReal'].includes(v.result?.kind))parseRealResult(v.result);else parseDemoResult(v.result);}
 }else throw new Error('Invalid reply type');
 return v;
}
export function parseDemoResult(v){
 if(!isRecord(v)||!FIXTURE_IDS.includes(v.fixtureId)||!['live','test'].includes(v.mode)||!['scoreDemo','agentDemo'].includes(v.kind))throw new Error('Invalid demo result');
 if(v.kind==='scoreDemo'){
  if(!exactKeys(v,['kind','fixtureId','mode','scores'])||!Array.isArray(v.scores)||!v.scores.length||v.scores.length>3||new Set(v.scores.map(x=>x.nctId)).size!==v.scores.length)throw new Error('Invalid scores');
  for(const s of v.scores)if(!exactKeys(s,['nctId','index','confidence'])||typeof s.nctId!=='string'||!/^NCT\d{8}$/.test(s.nctId)||!Number.isFinite(s.index)||s.index<0||s.index>100||!Number.isFinite(s.confidence)||s.confidence<0||s.confidence>1)throw new Error('Invalid score');
 }else{
  if(!exactKeys(v,['kind','fixtureId','mode','comparisons','cautionIds','toolCalls','cleanup'])||!Array.isArray(v.comparisons)||!v.comparisons.length||v.comparisons.length>3||!Number.isInteger(v.toolCalls)||v.toolCalls<1||v.toolCalls>6||!['deleted','failed'].includes(v.cleanup)||new Set(v.comparisons.map(x=>x?.nctId)).size!==v.comparisons.length)throw new Error('Invalid agent result');
  for(const c of v.comparisons)if(!exactKeys(c,['nctId','questionIds'])||typeof c.nctId!=='string'||!/^NCT\d{8}$/.test(c.nctId)||!templateIdList(c.questionIds,QUESTION_TEMPLATES,1,6))throw new Error('Invalid comparison');
  if(!templateIdList(v.cautionIds,CAUTION_TEMPLATES,1,3))throw new Error('Invalid cautions');
 }
 return v;
}

export const parseNativeRequest=parseDemoRequest;
export const parseNativeReply=parseDemoReply;

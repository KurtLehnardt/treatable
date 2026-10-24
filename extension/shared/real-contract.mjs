import{exactKeys,isRecord,utf8Bytes,validId,MAX_MESSAGE_BYTES,QUESTION_TEMPLATES,CAUTION_TEMPLATES}from'./demo-contract.mjs';
import{PUBLIC_CONDITIONS,PUBLIC_STUDY_IDS,PUBLIC_CATALOG_METADATA}from'./public-catalog.mjs';
export const REAL_POLICY_VERSION='treatable-health-api-draft-2026-10-24-v1';
export const PREPARED_TTL_MS=5*60*1000;
export const AGE_BANDS=Object.freeze(['under_18','18_29','30_44','45_59','60_74','75_89','90_plus']);
export const US_STATES=Object.freeze('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
const conditions=new Set(PUBLIC_CONDITIONS.map(x=>x.id)),studies=new Set(PUBLIC_STUDY_IDS);
const TOKEN=/^[A-Za-z0-9_-]{43}$/;const DIGEST=/^[a-f0-9]{64}$/;
export function parsePolicyReceipt(v){if(!exactKeys(v,['policyVersion','accepted'])||v.policyVersion!==REAL_POLICY_VERSION||v.accepted!==true)throw Error('Current health-data policy acknowledgement is required');return{policyVersion:REAL_POLICY_VERSION,accepted:true};}
export function parseRealPacket(v){
 if(!exactKeys(v,['ageBand','state','sex','conditionIds','selectedNctIds'])||!AGE_BANDS.includes(v.ageBand))throw Error('Invalid minimized health packet');
 if(v.state!==undefined&&!US_STATES.includes(v.state))throw Error('Invalid US state');
 if(v.sex!==undefined&&!['female','male','other','prefer_not_to_say'].includes(v.sex))throw Error('Invalid optional sex');
 if(!Array.isArray(v.conditionIds)||!v.conditionIds.length||v.conditionIds.length>6||new Set(v.conditionIds).size!==v.conditionIds.length||v.conditionIds.some(x=>typeof x!=='string'||!conditions.has(x)))throw Error('Choose conditions explicitly from the public catalog');
 if(!Array.isArray(v.selectedNctIds)||!v.selectedNctIds.length||v.selectedNctIds.length>2||new Set(v.selectedNctIds).size!==v.selectedNctIds.length||v.selectedNctIds.some(x=>typeof x!=='string'||!studies.has(x)))throw Error('Choose up to two bundled public study IDs');
 return structuredClone(v);
}
export function parseRealRequest(v){
 if(!exactKeys(v,['id','type','payload'])||!validId(v.id)||utf8Bytes(v)>MAX_MESSAGE_BYTES||!isRecord(v.payload))throw Error('Invalid real-data operation');const p=v.payload;
 if(v.type==='prepareReal'){if(!exactKeys(p,['packet','policyReceipt']))throw Error('Unsupported preparation data');parseRealPacket(p.packet);parsePolicyReceipt(p.policyReceipt);}
 else if(v.type==='executeReal'){if(!exactKeys(p,['token','digest','operation','policyReceipt'])||typeof p.token!=='string'||!TOKEN.test(p.token)||typeof p.digest!=='string'||!DIGEST.test(p.digest)||!['score','agent'].includes(p.operation))throw Error('Invalid prepared analysis receipt');parsePolicyReceipt(p.policyReceipt);}
 else if(v.type==='revokeReal'){if(!exactKeys(p,['token'])||p.token!==undefined&&(typeof p.token!=='string'||!TOKEN.test(p.token)))throw Error('Invalid revocation');}
 else throw Error('Unsupported real-data operation');return v;
}
export function parseRealResult(v){
 if(!isRecord(v)||!['scoreReal','agentReal'].includes(v.kind)||!['live','test'].includes(v.mode)||typeof v.consentDigest!=='string'||!DIGEST.test(v.consentDigest))throw Error('Invalid real analysis result');
 if(v.kind==='scoreReal'){
  if(!exactKeys(v,['kind','mode','consentDigest','scores'])||!Array.isArray(v.scores)||!v.scores.length||v.scores.length>2||new Set(v.scores.map(x=>x?.nctId)).size!==v.scores.length)throw Error('Invalid relevance result');
  for(const s of v.scores)if(!exactKeys(s,['nctId','index','confidence'])||!studies.has(s.nctId)||!Number.isFinite(s.index)||s.index<0||s.index>100||!Number.isFinite(s.confidence)||s.confidence<0||s.confidence>1)throw Error('Invalid relevance score');
 }else{
  if(!exactKeys(v,['kind','mode','consentDigest','comparisons','cautionIds','toolCalls','cleanup'])||!Array.isArray(v.comparisons)||!v.comparisons.length||v.comparisons.length>2||new Set(v.comparisons.map(x=>x?.nctId)).size!==v.comparisons.length||!Number.isInteger(v.toolCalls)||v.toolCalls<1||v.toolCalls>6||!['deleted','failed'].includes(v.cleanup))throw Error('Invalid agent plan');
  for(const c of v.comparisons)if(!exactKeys(c,['nctId','questionIds'])||!studies.has(c.nctId)||!Array.isArray(c.questionIds)||!c.questionIds.length||c.questionIds.length>6||c.questionIds.some(x=>!Object.hasOwn(QUESTION_TEMPLATES,x)))throw Error('Invalid contact question');
  if(!Array.isArray(v.cautionIds)||v.cautionIds.length!==3||new Set(v.cautionIds).size!==3||v.cautionIds.some(x=>!Object.hasOwn(CAUTION_TEMPLATES,x)))throw Error('Invalid cautions');
 }return v;
}
export function parsePreparedResult(v){if(!exactKeys(v,['kind','token','digest','expiresAt','policyVersion','catalogMetadata','preview'])||v.kind!=='preparedReal'||typeof v.token!=='string'||!TOKEN.test(v.token)||typeof v.digest!=='string'||!DIGEST.test(v.digest)||!Number.isSafeInteger(v.expiresAt)||v.policyVersion!==REAL_POLICY_VERSION||JSON.stringify(v.catalogMetadata)!==JSON.stringify(PUBLIC_CATALOG_METADATA)||!exactKeys(v.preview,['packet','decisionsRequest','agentsRequest','toolResults'])||!isRecord(v.preview.decisionsRequest)||!isRecord(v.preview.agentsRequest)||!Array.isArray(v.preview.toolResults)||v.preview.toolResults.length<1||v.preview.toolResults.length>2||utf8Bytes(v)>MAX_MESSAGE_BYTES)throw Error('Invalid prepared preview');parseRealPacket(v.preview.packet);return v;}

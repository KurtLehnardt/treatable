// AI ranking contract, shared by the extension and the native helper. It is provider-neutral: one operation shape takes a
// minimized profile plus up to ten public ClinicalTrials.gov records and returns one relevance score per study.
//
//   prepareRank  {nctIds, profile, provider?, model?} -> preparedRank {token, digest, expiresAt, provider, nctIds, preview:{profile, request}}
//   executeRank  {token, digest}              -> rankResult   {mode, provider, digest, scores:[{nctId, score, reasonId, probabilities?} | {nctId, failure}]}
//   revokeRank   {token?}                     -> ok
//
// The helper fetches the public records itself; the caller only names public NCT IDs. The profile never holds a name, exact
// age, ZIP code, coordinates or notes: condition terms are short, refuse three digits in a row and age phrases, and age is a coarse band.
// `preview.request` is the exact provider request body (for OpenAI, the Decisions request) so it can be shown before and after sending.
// `provider` is 'openai' (the default) or 'local'; 'local' names an installed Ollama model in `model` and keeps everything on this
// device. `probabilities` are the Decisions probabilities for the four relevance levels (RANK_LEVELS order); OpenAI results always carry
// them and a local model never does. A local model may fail for one study and still score the rest: that study carries only `failure`.
import {AGE_BANDS} from './real-contract.mjs';
import {exactKeys,isRecord,validId,utf8Bytes,MAX_MESSAGE_BYTES} from './demo-contract.mjs';
import {isLocalModelName} from './local-model.mjs';
import {RANK_REASONS as LOCAL_RANK_REASONS} from './local-ranking.mjs';
export const RANK_REQUEST_TYPES=Object.freeze(['prepareRank','executeRank','revokeRank']);
export const RANK_MAX_STUDIES=10;
export const RANK_MAX_TERMS=6;
export const RANK_TERM_MAX_CHARS=80;
export const RANK_TTL_MS=5*60*1000;
/** Providers the helper may report. A local model backend adds its own id here and to the extension's provider handling. */
export const RANK_PROVIDERS=Object.freeze(['openai','local']);
export const RANK_SEXES=Object.freeze(['female','male']);
/** Short relevance reason ids a provider returns with each score. Deterministic record checks have their own ids in the extension. */
export const RANK_REASONS=Object.freeze(['strong_match','possible_match','unclear','unrelated',...Object.keys(LOCAL_RANK_REASONS)]);
/** Decisions relevance levels, lowest first. Probabilities follow this order. */
export const RANK_LEVELS=Object.freeze(['Unrelated','Unclear','Related','Strongly related']);
const HASH=/^[a-f0-9]{64}$/,TOKEN=/^[A-Za-z0-9_-]{43}$/;
// A condition term holds letters, digits, marks, spaces and light punctuation, with at least two letters. Digits are allowed inside
// a name ("COVID-19", "HER2", "11q") and as a short number or range right after a word such as "Type", "Stage", "COVID" or "HPV"
// ("Type 2 diabetes", "HPV 16", "Grade 1-2"). Everything that can carry an exact age, a date or a location is refused: a standalone
// number ("45 female"), an age-and-sex token ("52M", "52/M", "F45", "45yoF", "45female"), a date ("12/03", "12-03", "March 12th"),
// three or more digits in a row (a ZIP code, a year, a phone number) and age phrases ("45 years", "45-year-old", "aged 52").
const TERM=/^[\p{L}\p{N}][\p{L}\p{M}\p{N} '’\-/(),.&+]*$/u,AGE_LIKE=/\p{N}[\s-]*(?:yrs?|years?|months?|mos?|weeks?|wks?|days?|y)\b|\p{N}\s*y\/?o[mf]?(?!\p{L})|\b(?:age|aged)[\s-]*\p{N}/iu;
// Words after which a short number is part of a condition name. "MEN" (multiple endocrine neoplasia) counts only in capitals, so
// "men 52" stays refused.
const NUMBERED=new Set(['type','stage','grade','phase','class','level','tier','factor','trisomy','monosomy','chromosome','gleason','score','cin','nyha','covid','hiv','hpv','hsv','htlv','exon','mody','ckd','nf','neurofibromatosis','sma','brca','gold','chiari','bi-rads','birads','genotype','subtype']);
const MONTHS=new Set(['january','february','march','april','may','june','july','august','september','october','november','december','jan','feb','mar','apr','jun','jul','aug','sep','sept','oct','nov','dec']);
function numberLeak(text){
 const raw=text.split(/[\s,()]+/).filter(Boolean),tokens=raw.map(t=>t.toLocaleLowerCase('en-US')),named=i=>i>0&&(NUMBERED.has(tokens[i-1])||raw[i-1]==='MEN');
 return tokens.some((t,i)=>{
  if(/^\p{N}+$/u.test(t))return!(t.length<=2&&named(i));
  if(/^\p{N}+(?:[./-]\p{N}+)+$/u.test(t))return!((/^\p{N}{1,2}\.\p{N}$/u.test(t)||/^\p{N}{1,2}-\p{N}{1,2}$/u.test(t))&&named(i));
  if(/^\p{N}{1,3}(?:y\/?o|yrs?|y)?[-/.]?(?:m|f|male|female|man|woman|boy|girl)$/u.test(t)||/^(?:m|f)[-/.]?\p{N}{2,3}$/u.test(t)||/^(?:male|female|man|woman)[-/.]?\p{N}{1,3}$/u.test(t))return true;
  return/^\p{N}{1,2}(?:st|nd|rd|th)$/u.test(t)&&(MONTHS.has(tokens[i-1]??'')||MONTHS.has(tokens[i+1]??''));
 });
}
/** Normalizes one condition term (collapsed spaces, bounded length) or returns undefined when it is not an allowed term. */
export function rankTerm(v){if(typeof v!=='string')return undefined;const text=v.normalize('NFC').replace(/\s+/g,' ').trim();if(!text||[...text].length>RANK_TERM_MAX_CHARS||!TERM.test(text)||(text.match(/\p{L}/gu)??[]).length<2||/\p{N}{3,}/u.test(text)||AGE_LIKE.test(text)||numberLeak(text))return undefined;return text;}
/** Reason id for a 0-100 relevance score, used when a provider has no reason of its own. */
export function rankReasonForScore(score){return score>=75?'strong_match':score>=50?'possible_match':score>=25?'unclear':'unrelated';}
export function rankNctIds(v){if(!Array.isArray(v)||!v.length||v.length>RANK_MAX_STUDIES||new Set(v).size!==v.length||v.some(x=>typeof x!=='string'||!/^NCT[0-9]{8}$/.test(x)))throw Error('Choose one to ten unique public NCT IDs');return [...v];}
export function parseRankProfile(v){
 if(!exactKeys(v,['conditions','ageBand','sex'])||!Array.isArray(v.conditions)||!v.conditions.length||v.conditions.length>RANK_MAX_TERMS)throw Error('Invalid ranking profile');
 const conditions=v.conditions.map(rankTerm);if(conditions.some((x,i)=>x===undefined||x!==v.conditions[i])||new Set(conditions.map(x=>x.toLocaleLowerCase('en-US'))).size!==conditions.length)throw Error('Invalid condition terms');
 if(v.ageBand!==undefined&&!AGE_BANDS.includes(v.ageBand))throw Error('Invalid age band');if(v.sex!==undefined&&!RANK_SEXES.includes(v.sex))throw Error('Invalid sex');
 return{conditions:[...conditions],...(v.ageBand!==undefined?{ageBand:v.ageBand}:{}),...(v.sex!==undefined?{sex:v.sex}:{})};
}
export function parseRankRequest(v){
 if(!exactKeys(v,['id','type','payload'])||!validId(v.id)||utf8Bytes(v)>MAX_MESSAGE_BYTES||!isRecord(v.payload))throw Error('Invalid ranking operation');const p=v.payload;
 if(v.type==='prepareRank'){if(!exactKeys(p,['nctIds','profile','provider','model'])||p.provider!==undefined&&!RANK_PROVIDERS.includes(p.provider)||(p.provider==='local'?!isLocalModelName(p.model):p.model!==undefined))throw Error('Invalid ranking preparation');rankNctIds(p.nctIds);parseRankProfile(p.profile);}
 else if(v.type==='executeRank'){if(!exactKeys(p,['token','digest'])||typeof p.token!=='string'||!TOKEN.test(p.token)||typeof p.digest!=='string'||!HASH.test(p.digest))throw Error('Invalid ranking receipt');}
 else if(v.type==='revokeRank'){if(!exactKeys(p,['token'])||p.token!==undefined&&(typeof p.token!=='string'||!TOKEN.test(p.token)))throw Error('Invalid ranking revocation');}
 else throw Error('Unsupported ranking operation');return v;
}
export function parsePreparedRank(v){
 if(!exactKeys(v,['kind','token','digest','expiresAt','provider','nctIds','preview'])||v.kind!=='preparedRank'||typeof v.token!=='string'||!TOKEN.test(v.token)||typeof v.digest!=='string'||!HASH.test(v.digest)||!Number.isSafeInteger(v.expiresAt)||!RANK_PROVIDERS.includes(v.provider)||!exactKeys(v.preview,['profile','request'])||!isRecord(v.preview.request)||utf8Bytes(v)>MAX_MESSAGE_BYTES-1024)throw Error('Invalid prepared ranking');
 rankNctIds(v.nctIds);parseRankProfile(v.preview.profile);return v;
}
function probabilities(v){if(v===undefined)return true;if(!Array.isArray(v)||v.length!==RANK_LEVELS.length||v.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0||x>1))return false;return Math.abs(v.reduce((a,b)=>a+b,0)-1)<=0.002;}
export function parseRankResult(v){
 if(!exactKeys(v,['kind','mode','provider','digest','scores'])||v.kind!=='rankResult'||!['live','test'].includes(v.mode)||!RANK_PROVIDERS.includes(v.provider)||typeof v.digest!=='string'||!HASH.test(v.digest)||!Array.isArray(v.scores)||utf8Bytes(v)>MAX_MESSAGE_BYTES)throw Error('Invalid ranking result');
 rankNctIds(v.scores.map(x=>x?.nctId));
 for(const s of v.scores){
  if(isRecord(s)&&s.failure!==undefined){if(v.provider==='openai'||!exactKeys(s,['nctId','failure'])||typeof s.failure!=='string'||!/^[A-Z_]{1,40}$/.test(s.failure))throw Error('Invalid study ranking failure');continue;}
  if(!exactKeys(s,['nctId','score','reasonId','probabilities'])||!Number.isInteger(s.score)||s.score<0||s.score>100||!RANK_REASONS.includes(s.reasonId)||!probabilities(s.probabilities)||v.provider==='openai'&&s.probabilities===undefined||v.provider==='local'&&s.probabilities!==undefined)throw Error('Invalid study ranking');
 }
 return v;
}
export function parseRankReply(v,expectedId){
 if(!isRecord(v)||v.id!==expectedId||!validId(v.id)||utf8Bytes(v)>MAX_MESSAGE_BYTES||v.type!=='result'||typeof v.ok!=='boolean'||!exactKeys(v,['id','type','ok','result','code','error']))throw Error('Invalid ranking reply');
 if(!v.ok){if(typeof v.code!=='string'||!/^[A-Z_]{1,40}$/.test(v.code)||typeof v.error!=='string'||v.error.length>300)throw Error('Invalid ranking error');}
 else if(v.result!==undefined){if(v.result?.kind==='preparedRank')parsePreparedRank(v.result);else parseRankResult(v.result);}
 return v;
}

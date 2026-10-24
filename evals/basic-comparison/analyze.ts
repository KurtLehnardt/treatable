/** Offline-only analysis. No native host, network, credential, or provider imports. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {nearestStudySite,parseStudySites} from '../../extension/src/local-distance';
const dir=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(dir,'../..');
const read=async(n:string)=>JSON.parse(await readFile(path.join(dir,n),'utf8'));
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const [spec,frozen,synthetic,live]=await Promise.all(['predeclared.json','public-records.json','synthetic.json','live-results.json'].map(read));
assert.equal(sha(await readFile(path.join(dir,'public-records.json'))),spec.publicArtifactSha256);assert.equal(sha(await readFile(path.join(dir,'synthetic.json'))),spec.syntheticArtifactSha256);
const basicPath=path.resolve(process.env.BASIC_MODULE??path.join(repo,'extension/src/basic-matching.ts'));
const basicRoot=path.resolve(path.dirname(basicPath),'../..');
const basicCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:basicRoot,encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--','extension/src/basic-matching.ts'],{cwd:basicRoot,encoding:'utf8'}).trim(),'','Basic ranker must be committed before evaluation');
const {rankBasicStudies,BASIC_RANKING_VERSION}=await import(pathToFileURL(basicPath).href);
const now=Date.parse(spec.createdAt),studies=frozen.records.map((r:any)=>r.normalized);
const metric=(ranked:any[],labels:any[])=>{const gold=new Set(labels.filter((l:any)=>l.relevant).map((l:any)=>l.nctId));const hits=ranked.slice(0,5).filter((r:any)=>gold.has(r.nctId)).length;const first=ranked.findIndex((r:any)=>gold.has(r.nctId));return{precisionAt5:hits/5,recallAt5:gold.size?hits/gold.size:null,reciprocalRank:first<0?0:1/(first+1),positiveLabels:gold.size};};
const profiles=[];
for(const p of spec.profiles){
 const profile={conditionText:p.conditions.join(' '),ageBand:p.ageBand,...(p.sex?{sex:p.sex}:{}),...(p.state?{state:p.state}:{})};
 const start=performance.now(),basic=rankBasicStudies(studies,profile,{now}),latencyMs=performance.now()-start;
 assert.deepEqual(basic.map((r:any)=>r.nctId).sort(),[...spec.ids].sort());
 const labels=spec.labels.find((l:any)=>l.profileId===p.id).labels;
 const cmp=(a:any,b:any)=>a.guardTier-b.guardTier||(b.index??-1)-(a.index??-1)||a.nctId.localeCompare(b.nctId);
 const basicRank=[...basic].sort(cmp),saved=live.results.find((r:any)=>r.profileId===p.id);
 const ai=saved?.scores.map((s:any)=>({...s,guardTier:basic.find((b:any)=>b.nctId===s.nctId).guardTier})).sort(cmp);
 profiles.push({profileId:p.id,basic:{latencyMs,metrics:metric(basicRank,labels),rows:basicRank},openai:ai?{latencyMs:saved.latencyMs,metrics:metric(ai,labels),rows:ai}:null});
}
const fixtureResults=[];
for(const c of synthetic.cases){
 const input={...synthetic.base,...c.patch};const row=rankBasicStudies([input],c.profile,{now})[0];const checks=[];
 for(const [key,expected]of Object.entries(c.expected)){
  if(['age','sex','status'].includes(key))checks.push({key,expected,actual:row?.checks.find((x:any)=>x.id===key)?.status,pass:row?.checks.find((x:any)=>x.id===key)?.status===expected});
  else if(key==='topicalMatch')checks.push({key,expected,actual:(row?.index??0)>0,pass:(row?.index??0)>0});
  else if(key==='notExcluded')checks.push({key,expected,actual:!!row&&row.bucket!=='unlikely'&&row.bucket!=='unavailable',pass:!!row&&row.bucket!=='unlikely'&&row.bucket!=='unavailable'});
  else if(key==='noEligibilityClaim')checks.push({key,expected,actual:row?.bucket!=='eligible',pass:row?.bucket!=='eligible',scope:'Structured result bucket only; no browser UI evaluated.'});
 }
 let siteResult;
 if(c.localOnly){siteResult=nearestStudySite(c.localOnly.sites,c.localOnly.origin,{radiusMiles:50,onlyAccepting:true});
  if(c.expected.distanceUnknown)checks.push({key:'distanceUnknown',expected:true,actual:siteResult.distanceMiles===undefined&&siteResult.outsideRadius===false,pass:siteResult.distanceMiles===undefined&&siteResult.outsideRadius===false});
  if(c.expected.nearestSelectableFacility)checks.push({key:'nearestSelectableFacility',expected:c.expected.nearestSelectableFacility,actual:siteResult.nearestSiteLabel??null,pass:null,invalidFixture:'Country omitted in the frozen sites. Production requires confirmed US country to measure a US site. This assertion is not counted; input defect identified before Basic execution.'});
 }
 fixtureResults.push({id:c.id,row,checks,...(siteResult?{siteResult}:{})});
}
const siteCase=await read('supplemental-site-predeclared.json');
const supplemental=nearestStudySite(siteCase.sites,siteCase.origin,{onlyAccepting:true});
const knownPublic=frozen.records.find((r:any)=>r.id==='NCT07254806');
const publicSites=parseStudySites(knownPublic.raw.protocolSection.contactsLocationsModule.locations);
const validChecks=fixtureResults.flatMap((r:any)=>r.checks).filter((c:any)=>typeof c.pass==='boolean');
const output={predeclarationCommit:'4a31b36',analyzedAt:new Date().toISOString(),basicCommit,basicSourceSha256:sha(await readFile(basicPath)),rankingVersion:BASIC_RANKING_VERSION,localDistanceSha256:sha(await readFile(path.join(repo,'extension/src/local-distance.ts'))),publicArtifactSha256:spec.publicArtifactSha256,profiles,synthetic:{passed:validChecks.filter((c:any)=>c.pass).length,evaluated:validChecks.length,failed:validChecks.filter((c:any)=>!c.pass),invalidAssertions:1,fixtureResults,supplementalUSSiteProbe:{predeclaredSeparately:true,reason:'Country correction declared before Basic/site execution; not part of the original predeclared score.',pass:supplemental.nearestSiteLabel==='Far recruiting',result:supplemental},publicSiteEvidence:{nctId:knownPublic.id,facilities:publicSites.length,withCoordinates:publicSites.filter((s:any)=>s.lat!==undefined&&s.lon!==undefined).length,recruiting:publicSites.filter((s:any)=>s.status==='RECRUITING').length,terminated:publicSites.filter((s:any)=>s.status==='TERMINATED').length}},safety:{falseEligibilityBuckets:fixtureResults.filter((r:any)=>r.row?.bucket==='eligible').length,falseExclusions:fixtureResults.filter((r:any)=>r.checks.some((c:any)=>c.key==='notExcluded'&&!c.pass)).length,unknownAssertions:validChecks.filter((c:any)=>c.expected==='unknown'||c.key==='distanceUnknown'),openaiEligibilityClaimScope:'Score-only result schema cannot express eligibility or exclusion; shared deterministic guard rows used unchanged. No clinical false-eligibility rate measured.'},actualAuthenticatedRequests:live.authenticatedRequestsAttempted,completedRequests:live.completed,agentsRequests:live.agentsRequests,cost:live.cost,notes:['Basic receives precisely the same normalized title/conditions/summary/criteria and age/sex/status facts as OpenAI. Neither receives untruncated raw study text or interventions absent from this native projection.','Basic conditionText is only joined selected public condition labels. State is present in one OpenAI profile; Basic has no state-based scorer or guard. No ZIP, origin, history or notes reach either ranker.','Both scored lists use the SAME Basic deterministic guard tiers before scores. A topically exact study with a known constraint conflict can rank lower than unrelated but structurally compatible records.','Synthetic safety is local deterministic verification. OpenAI was not asked to score synthetic fixtures.','Single execution times are observations, not latency benchmarks. Offline reruns update Basic compute latency but reuse saved OpenAI observations.']};
await writeFile(path.join(dir,'results.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({basicCommit,rankingVersion:BASIC_RANKING_VERSION,profiles:profiles.map((p:any)=>({id:p.profileId,basic:p.basic.metrics,openai:p.openai?.metrics,basicMs:p.basic.latencyMs,openaiMs:p.openai?.latencyMs})),synthetic:{passed:output.synthetic.passed,evaluated:output.synthetic.evaluated,failed:output.synthetic.failed,invalidAssertions:1,supplementalPass:output.synthetic.supplementalUSSiteProbe.pass},safety:output.safety},null,2));

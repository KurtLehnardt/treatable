import {contentHash,studyEmbedText} from "./ctgov.mjs";
export function vectorTarget(cwd,target="snapshot"){const root=target==="local"?`${cwd}/data/local`:`${cwd}/data`;return {root,input:`${root}/studies.json`,output:`${root}/vectors/builtin.json`};}
export async function buildStudyVectors({studies,previous={},config,model,revision,dims,embed,onCheckpoint=()=>{}}){
 const compatible=previous.model===model&&previous.modelRevision===revision&&previous.dims===dims&&JSON.stringify(previous.config)===JSON.stringify(config);const vectors={},hashes={},pending=[];
 for(const study of studies){hashes[study.id]=contentHash(study);const old=previous.vectors?.[study.id];if(compatible&&previous.hashes?.[study.id]===hashes[study.id]&&Array.isArray(old)&&old.length===dims&&old.every(Number.isFinite))vectors[study.id]=old;else pending.push(study);}
 const snapshot=()=>({model,modelRevision:revision,config,dims,generatedAt:new Date().toISOString(),hashes,vectors});
 for(let i=0;i<pending.length;i+=8){const batch=pending.slice(i,i+8);const values=await embed(batch.map(study=>`search_document: ${studyEmbedText(study)}`));if(values.length!==batch.length||values.some(v=>v.length!==dims||!v.every(Number.isFinite)))throw Error("Embedding model returned invalid vector dimensions");values.forEach((v,j)=>{vectors[batch[j].id]=v.map(x=>Math.round(x*1e5)/1e5);});await onCheckpoint(snapshot(),Math.min(i+8,pending.length),pending.length);}
 return {snapshot:snapshot(),updated:pending.length};
}

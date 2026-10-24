#!/usr/bin/env node
import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';
const actualUrl=new URL('../../scaffold/data/studies.json',import.meta.url);
const bytes=await readFile(actualUrl);const studies=JSON.parse(bytes);if(!Array.isArray(studies)||studies.length!==2000)throw Error('Expected the approved 2,000-record corpus');
const canonical=s=>s.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
const labels=new Map();for(const s of studies){if(!/^NCT\d{8}$/.test(s.id))throw Error('Invalid public record');for(const raw of s.conditions){const label=raw.normalize('NFC').trim().replace(/\s+/g,' '),key=canonical(label);if(!key||label.length>500)continue;const old=labels.get(key);if(!old||label<old)labels.set(key,label);}}
const conditions=[...labels].map(([key,label])=>({id:'ctg_'+createHash('sha256').update(key).digest('hex').slice(0,24),label})).sort((a,b)=>a.label<b.label?-1:a.label>b.label?1:0);
if(new Set(conditions.map(x=>x.id)).size!==conditions.length)throw Error('Condition ID collision');
const studyIds=studies.map(s=>s.id).sort();const metadata={version:'ctgov-snapshot-2026-10-23-v1',vocabulary:'ClinicalTrials.gov public condition labels; not diagnosis normalization or a MeSH mapping',studyCount:studies.length,conditionCount:conditions.length,corpusSha256:createHash('sha256').update(bytes).digest('hex'),catalogSha256:createHash('sha256').update(JSON.stringify({conditions,studyIds})).digest('hex')};
const module='// Generated only from the approved public study snapshot. No patient input.\nexport const PUBLIC_CATALOG_METADATA=Object.freeze('+JSON.stringify(metadata)+');\nexport const PUBLIC_CONDITIONS=Object.freeze('+JSON.stringify(conditions)+');\nexport const PUBLIC_STUDY_IDS=Object.freeze('+JSON.stringify(studyIds)+');\n';
await writeFile(new URL('../shared/public-catalog.mjs',import.meta.url),module);await writeFile(new URL('data/studies.json',import.meta.url),bytes);
console.log(`Public catalog: ${studies.length} studies, ${conditions.length} fixed condition labels; ${metadata.corpusSha256}`);

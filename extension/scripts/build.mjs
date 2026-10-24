import {build} from 'esbuild';
import {mkdir,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await rm(path.join(root,'dist'),{recursive:true,force:true});
await mkdir(path.join(root,'dist/data'),{recursive:true});
await build({entryPoints:{panel:path.join(root,'src/panel.tsx'),background:path.join(root,'src/background.ts')},outdir:path.join(root,'dist'),bundle:true,format:'esm',platform:'browser',target:'chrome116',minify:true,legalComments:'eof',jsx:'automatic',alias:{zod:path.join(root,'node_modules/zod')}});
const sites=JSON.parse(await readFile(path.join(root,'sites.json'),'utf8'));
const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
// Page access stays ClinicalTrials.gov-only. The OpenAI API origin is used only by the panel's fetch calls after consent.
manifest.host_permissions=[...sites.origins.map(origin=>`${origin}/*`),'https://api.openai.com/*'];
await writeFile(path.join(root,'dist/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await cp(path.join(root,'public/panel.html'),path.join(root,'dist/panel.html'));
for(const name of ['studies.json','us-zip-centroids.json'])await cp(path.join(root,'../scaffold/data',name),path.join(root,'dist/data',name));
const studies=JSON.parse(await readFile(path.join(root,'dist/data/studies.json'),'utf8'));
if(studies.length!==2000)throw new Error(`Expected 2,000 shipped studies, got ${studies.length}`);
await writeFile(path.join(root,'dist/data/provenance.json'),JSON.stringify({count:studies.length,fetchedAt:studies[0]?.fetchedAt,source:'ClinicalTrials.gov API v2',search:'Local BM25 retrieval with optional OpenAI or local-model scoring; snapshot is incomplete and recruitment may change',zipAttribution:'GeoNames, CC BY 4.0; approximate postal-area centers'},null,2));
console.log(`Built private Chrome extension with ${studies.length} studies`);

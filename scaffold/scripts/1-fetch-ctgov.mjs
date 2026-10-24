import { mkdirSync,writeFileSync } from "node:fs";
import { fetchPages } from "./lib/ctgov.mjs";
mkdirSync("data/raw/ctgov",{recursive:true});const fetchedAt=new Date().toISOString();
const studies=await fetchPages({max:Number(process.env.CORPUS_MAX)||4000,onPage:(data,i)=>{writeFileSync(`data/raw/ctgov/page-${i}.json`,JSON.stringify({fetchedAt,...data}));console.log(`Fetched page ${i+1}: ${data.studies.length}`);}});
writeFileSync("data/raw/ctgov/fetch.json",JSON.stringify({fetchedAt,studies}));console.log(`Fetched ${studies.length} real CT.gov records`);

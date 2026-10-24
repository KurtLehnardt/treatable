import {readFileSync} from "node:fs";import path from "node:path";import type {Study} from "../contracts/study";
let cache:Study[]|undefined;export function loadStudies():Study[]{if(!cache)cache=JSON.parse(readFileSync(path.join(process.cwd(),"data/studies.json"),"utf8"));return cache!;}
export interface StudyVectors{model:string;modelRevision:string;dims:number;hashes:Record<string,string>;vectors:Record<string,number[]>}
let vectors:StudyVectors|null|undefined;export function loadStudyVectors():StudyVectors|null{if(vectors===undefined){try{vectors=JSON.parse(readFileSync(path.join(process.cwd(),"data/vectors/builtin.json"),"utf8"));}catch{vectors=null;}}return vectors!;}

// Test helpers for the local model path: a fake `ollama` binary (fake-ollama.mjs behind a per-test wrapper) and a fake models directory
// with real manifests and size-checked blobs. Nothing here touches the user's Ollama, its port or ~/.ollama.
import{mkdir,writeFile}from'node:fs/promises';import path from'node:path';
import{manifestPath}from'../local-runtime.mjs';
const fakeModule=new URL('./fake-ollama.mjs',import.meta.url).href;
export const MODELS=[
 {name:'qwen3.5:9b',size:6594474711,details:{family:'qwen35',parameter_size:'9.7B',quantization_level:'Q4_K_M'},capabilities:['completion','vision','tools','thinking']},
 {name:'qwen3:32b',size:20201253829,details:{family:'qwen3',parameter_size:'32.8B',quantization_level:'Q4_K_M'},capabilities:['completion','tools','thinking']},
 {name:'qwen2.5:14b',size:8988124069,details:{family:'qwen2',parameter_size:'14.8B',quantization_level:'Q4_K_M'},capabilities:['completion','tools']},
 {name:'gemma4:latest',size:9608350718,details:{family:'gemma4',parameter_size:'8.0B',quantization_level:'Q4_K_M'},capabilities:['completion','vision','tools','thinking']},
 {name:'batiai/gemma4-26b:q4',size:16796011431,details:{family:'gemma4',parameter_size:'25.2B',quantization_level:'Q4_K_M'},capabilities:['completion','tools','thinking']},
 {name:'nomic-embed-text:latest',size:274302450,details:{family:'nomic-bert',parameter_size:'137M',quantization_level:'F16'},capabilities:['embedding']},
 {name:'gpt-oss:120b-cloud',size:384,details:{family:'gptoss'},capabilities:['completion'],remote:true},
 {name:'mirror:latest',size:1234567890,details:{family:'llama'},capabilities:['completion'],remote:true},
 {name:'ghost:latest',size:5e9,details:{family:'llama',parameter_size:'8.0B'},capabilities:['completion']},
];
// Only these have manifests and blobs on disk (ghost is listed by the runtime but has no local weights).
export const ON_DISK=['qwen3.5:9b','qwen3:32b','qwen2.5:14b','gemma4:latest','batiai/gemma4-26b:q4','nomic-embed-text:latest','mirror:latest'];
export async function modelsDir(root,names=ON_DISK,{remote=['mirror:latest'],badBlob=[]}={}){
 const dir=path.join(root,'models');await mkdir(path.join(dir,'blobs'),{recursive:true});
 for(const[i,name]of names.entries()){const digest=`sha256:${String(i+1).padStart(64,'0')}`,data=Buffer.alloc(100+i);await writeFile(path.join(dir,'blobs',digest.replace(':','-')),badBlob.includes(name)?Buffer.alloc(3):data);
  const file=manifestPath(dir,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify({schemaVersion:2,layers:[{mediaType:'application/vnd.ollama.image.model',digest,size:data.length}],...(remote.includes(name)?{remote_host:'https://ollama.com:443',remote_model:name}:{})}));}
 return dir;
}
export async function fakeOllama(root,config={}){
 const configPath=path.join(root,'fake-ollama.json'),binary=path.join(root,'bin','ollama'),log=path.join(root,'ollama.log'),pidFile=path.join(root,'ollama.pid');
 await mkdir(path.dirname(binary),{recursive:true});await writeFile(configPath,JSON.stringify({log,pidFile,models:MODELS,...config}));
 await writeFile(binary,`#!${process.execPath}\nglobalThis.__FAKE_OLLAMA_CONFIG=${JSON.stringify(configPath)};import(${JSON.stringify(fakeModule)});\n`,{mode:0o755});
 return{binary,configPath,log,pidFile,set:async patch=>writeFile(configPath,JSON.stringify({log,pidFile,models:MODELS,...config,...patch}))};
}

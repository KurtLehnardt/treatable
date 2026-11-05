import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {fileURLToPath} from 'node:url';import {build} from 'esbuild';
// zod's eval probe (`new Function("")`) logs a CSP violation on chrome://extensions even though zod catches the throw. The extension's only zod
// schemas (the scaffold profile and study contracts, reached through the removed page-source and profile helpers in core.ts) are gone, so no
// shipped bundle includes zod and the zod-jitless entry module was removed. These tests keep it that way: a bundle that brings zod back must
// set zod's jitless option before its first schema.
// Every bundle the build defines (scripts/build.mjs entryPoints, plus the separately built site-content script).
const BUILD=readFileSync(new URL('../scripts/build.mjs',import.meta.url),'utf8');
const ENTRY_NAMES=[...BUILD.match(/entryPoints:\{([^}]*)\}/)![1].matchAll(/'?([a-z-]+)'?:path\.join\(root,/g)].map(m=>m[1]);
const BUNDLES=[...ENTRY_NAMES,'site-content'];
const hasZod=(code:string)=>code.includes('__zod_globalConfig');
const shipped=(name:string)=>readFileSync(new URL(`../dist/${name}.js`,import.meta.url),'utf8');
function constructedFunctions(code:string){const context=vm.createContext({});const intrinsic=vm.runInContext('(function(){}).constructor',context);const calls:unknown[][]=[];context.Function=new Proxy(intrinsic,{construct(target,args){calls.push(args);return Reflect.construct(target,args)},apply(target,self,args){calls.push(args);return Reflect.apply(target,self,args)}});try{vm.runInContext(code,context)}catch{/* Browser globals are absent here; schema modules have already been evaluated by then. */}return calls}
test('the bundle list covers every build entry, and no shipped bundle includes zod',()=>{for(const name of ['background','overlay','score-badge'])assert.ok(ENTRY_NAMES.includes(name),name);for(const name of ['private-match','confirm-send'])assert.ok(!ENTRY_NAMES.includes(name),`the ${name} entry was removed`);for(const name of BUNDLES)assert.equal(hasZod(shipped(name)),false,`dist/${name}.js includes zod`)});
test('no shipped bundle constructs a Function while it loads',()=>{for(const name of BUNDLES)assert.deepEqual(constructedFunctions(shipped(name)),[],`dist/${name}.js constructed a Function`)});
test('the detectors are live: a bundle that defines a zod schema includes zod and probes with new Function unless jitless is set first',async()=>{
 const bundle=async(contents:string)=>(await build({stdin:{contents,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent'})).outputFiles[0].text;
 const probing=await bundle("import {z} from 'zod';z.object({a:z.string()});");assert.ok(hasZod(probing));assert.ok(constructedFunctions(probing).length>0,'zod probes when a schema is defined');
 const jitless=await bundle("import {z} from 'zod';z.config({jitless:true});z.object({a:z.string()});");assert.ok(hasZod(jitless));assert.deepEqual(constructedFunctions(jitless),[],'jitless set first prevents the probe');
});

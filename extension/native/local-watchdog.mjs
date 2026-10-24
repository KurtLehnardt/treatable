// Keeps the dedicated `ollama serve` tied to the native helper's lifetime. The helper starts this script with a pipe on stdin; when the
// helper exits for any reason, including SIGKILL from Chrome, the pipe closes and the runtime is stopped. argv[2] is the Ollama binary;
// the environment is the minimal one the helper built and is passed through unchanged. The only output is one line with the runtime pid.
// The runtime gets its own process group, so the model runners it starts are stopped with it.
import{spawn}from'node:child_process';import{rmSync}from'node:fs';import path from'node:path';
const binary=process.argv[2];
if(typeof binary!=='string'||!binary.startsWith('/'))process.exit(2);
// The runtime's private HOME (this process's working directory) is removed when the runtime ends, even if the helper never got to.
const home=process.cwd();
function removeHome(){if(path.basename(home).startsWith('treatable-ollama-'))try{rmSync(home,{recursive:true,force:true});}catch{}}
const child=spawn(binary,['serve'],{env:process.env,stdio:'ignore',cwd:home,detached:true});
function signalGroup(signal){try{if(child.pid)process.kill(-child.pid,signal);}catch{}}
let stopping=false;
function stop(){if(stopping)return;stopping=true;signalGroup('SIGTERM');const timer=setTimeout(()=>{signalGroup('SIGKILL');removeHome();process.exit(0);},1500);timer.unref();}
// When `serve` itself exits, anything left in its group (for example a model runner) is killed before the watchdog ends.
child.once('exit',()=>{signalGroup('SIGKILL');removeHome();process.exit(0);});
child.once('error',()=>{removeHome();process.exit(1);});
child.once('spawn',()=>{process.stdout.write(`${JSON.stringify({pid:child.pid})}\n`);});
process.stdout.on('error',stop);process.stdin.on('end',stop);process.stdin.on('error',stop);process.stdin.resume();
process.on('SIGTERM',stop);process.on('SIGINT',stop);process.on('SIGHUP',stop);
process.on('uncaughtException',()=>{signalGroup('SIGKILL');removeHome();process.exit(1);});

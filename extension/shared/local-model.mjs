// Local model (Ollama on this device) naming rules shared by the extension preferences, the apply contract and the native helper.
// A name is an Ollama library-style reference: optional namespace, repository, optional tag. Hosts, digests, paths, cloud models and
// anything else are refused, so a stored or requested name can never point outside the user's own ~/.ollama/models manifests.
export const LOCAL_MODEL_PATTERN=/^[a-z0-9][a-z0-9._:/-]{0,63}$/;
const STRUCTURE=/^(?:[a-z0-9][a-z0-9._-]{0,31}\/)?[a-z0-9][a-z0-9._-]{0,47}(?::[A-Za-z0-9][A-Za-z0-9._-]{0,47})?$/;
export const OLLAMA_DOWNLOAD_URL='https://ollama.com/download';
export function isLocalModelName(v){
 if(typeof v!=='string'||v.length>64||!STRUCTURE.test(v))return false;
 const[repository,tag='']=v.split(':');
 // The tag may carry quantization suffixes such as q4_K_M; everything before it must match the strict lowercase pattern.
 if(!LOCAL_MODEL_PATTERN.test(repository+(tag?':'+tag.toLowerCase():'')))return false;
 return!v.includes('..')&&!/cloud/i.test(v)&&!v.split(/[/:]/).some(part=>part.endsWith('.')||part.endsWith('-'));
}
export function localModelName(v){if(!isLocalModelName(v))throw Error('Choose an installed local model');return v;}

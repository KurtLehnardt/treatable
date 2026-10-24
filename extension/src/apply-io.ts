/** The only local outputs of "Help me apply", all started by the patient's click inside the extension frame:
 * write (never read) the clipboard, save a generated text file from an in-memory Blob, and hand a mailto: link to the
 * patient's email app. Nothing is uploaded. */
export function copyText(text:string){return navigator.clipboard.writeText(text)}
/** The one place a link is followed from script: a click on a temporary anchor, as if the patient had clicked a link. */
function activate(url:string,download?:string){
 const a=document.createElement('a');
 a.href=url;if(download)a.download=download;a.rel='noopener';document.body.appendChild(a);
 try{a.click()}finally{a.remove()}
}
export function downloadText(name:string,text:string,type:string){
 const url=URL.createObjectURL(new Blob([text],{type}));
 try{activate(url,name)}finally{setTimeout(()=>URL.revokeObjectURL(url),30000)}
}
/** Opens a mailto: link in the patient's email app. Callers only pass a URL built by emailHandoff; anything else is ignored. */
export function openMailto(url:string){if(url.startsWith('mailto:'))activate(url)}

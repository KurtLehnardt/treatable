/** The only local outputs of "Help me apply", both started by the patient's click inside the extension frame:
 * write (never read) the clipboard, and save a generated text file from an in-memory Blob. Nothing is uploaded. */
export function copyText(text:string){return navigator.clipboard.writeText(text)}
export function downloadText(name:string,text:string,type:string){
 const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');
 a.href=url;a.download=name;a.rel='noopener';document.body.appendChild(a);
 try{a.click()}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
}

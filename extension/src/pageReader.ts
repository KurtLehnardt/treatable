/** Serialized by chrome.scripting: all runtime dependencies are arguments or page globals. */
export function readPage(allowedOrigins:string[]){
 if(!allowedOrigins.includes(location.origin))throw new Error('Unsupported research site');
 const excluded='script,style,noscript,input,textarea,select,form,[contenteditable],[role="textbox"],[hidden],[aria-hidden="true"]';
 const inExcluded=(node:Node|null)=>{const element=node?.nodeType===1?node as Element:node?.parentElement;return Boolean(element?.closest(excluded))};
 const selection=window.getSelection();let text='';
 if(selection?.rangeCount&&selection.toString().trim()&&!inExcluded(document.activeElement)&&!inExcluded(selection.anchorNode)&&!inExcluded(selection.focusNode)){
  try{const range=selection.getRangeAt(0);const intersectsExcluded=Array.from(document.querySelectorAll(excluded)).some(node=>range.intersectsNode(node));if(!intersectsExcluded)text=selection.toString().trim().slice(0,24000);}catch{/* Fall back to the filtered DOM, never raw form text. */}
 }
 if(!text){const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())&&text.length<24000){const parent=node.parentElement;if(!parent||parent.closest(excluded))continue;const style=getComputedStyle(parent);if(style.display==='none'||style.visibility==='hidden')continue;const part=node.textContent?.trim();if(part)text+=part+'\n';}}
 return{url:location.href,title:document.title,text:text.slice(0,24000)};
}

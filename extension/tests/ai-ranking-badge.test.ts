import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installDom,settle} from './dom-harness';

/* The real content script on two cards captured from ClinicalTrials.gov: reorder, then a match ring inside each card's own box. */
const html=readFileSync(new URL('./fixtures/ctgov/search-cards.html',import.meta.url),'utf8');
const [FIRST,SECOND]=['NCT00410098','NCT02753764'];
async function rig(){
 const env=installDom(html,'https://clinicaltrials.gov/search?cond=asthma&viewType=Card');
 const {installSiteContent}=await import('../src/site-content');
 const handlers:any[]=[],sent:any[]=[];
 const api:any={runtime:{id:'test',getURL:(p:string)=>`chrome-extension://test/${p}`,sendMessage:async(m:any)=>{sent.push(m);return{ok:true,active:true}},onMessage:{addListener:(f:any)=>handlers.push(f),removeListener:(f:any)=>handlers.splice(handlers.indexOf(f),1)}}};
 const controller=installSiteContent(env.window,env.document,api);
 const command=(type:string,payload:unknown={})=>{let reply:any;handlers[0]({kind:'treatable.site.command',type,payload},{id:'test'},(v:any)=>{reply=v});return reply};
 /* jsdom has no layout. Desktop geometry from the live capture: the status panel fills the card's top-right corner. */
 let layout:'desktop'|'narrow'='desktop';
 const rect=(r:{left:number;top:number;width:number;height:number})=>({...r,right:r.left+r.width,bottom:r.top+r.height,x:r.left,y:r.top,toJSON(){}});
 env.window.HTMLElement.prototype.getBoundingClientRect=function(this:HTMLElement){if(this.classList.contains('usa-card__container'))return rect({left:0,top:100,width:1000,height:250});if(this.classList.contains('results-pns'))return layout==='desktop'?rect({left:758,top:125,width:217,height:150}):rect({left:17,top:313,width:340,height:63});return rect({left:0,top:0,width:0,height:0})};
 return{env,controller,command,sent,setLayout:(v:typeof layout)=>{layout=v}};
}
const order=(doc:Document)=>Array.from(doc.querySelectorAll('ctg-search-hit-card')).map(c=>c.querySelector('.nct-id')!.textContent);
const badges=(doc:Document)=>Array.from(doc.querySelectorAll<HTMLIFrameElement>('iframe[src*="score-badge.html"]'));

test('ranked cards are reordered and each gets a match ring inside its own card box, clear of the title and the status panel',async()=>{
 const t=await rig();try{
  const snapshot=t.controller.getSnapshot();assert.deepEqual(snapshot.nctIds,[FIRST,SECOND]);assert.equal(snapshot.supported,true);
  assert.equal(t.command('reorder',{generation:snapshot.generation,order:[SECOND,FIRST],expiresAt:Date.now()+60000}).ok,true);
  assert.deepEqual(order(t.env.document),[SECOND,FIRST]);
  for(const nctId of [SECOND,FIRST])t.controller.activate({purpose:'badge',nctId,capability:'a'.repeat(64)});
  const frames=badges(t.env.document);assert.equal(frames.length,2);
  const say=(frame:HTMLIFrameElement,data:Record<string,unknown>,origin='chrome-extension://test')=>t.env.window.dispatchEvent(new t.env.window.MessageEvent('message',{data:{type:'treatable.site.badgeSize',...data},origin,source:frame.contentWindow}));
  for(const frame of frames){assert.equal(frame.style.visibility,'hidden','hidden and click-through until the badge has something to show');assert.equal(frame.style.pointerEvents,'none');say(frame,{expanded:false,visible:true});assert.equal(frame.style.visibility,'visible');assert.equal(frame.style.pointerEvents,'auto')}
  for(const frame of frames){
   const box=frame.parentElement!;assert.ok(box.classList.contains('usa-card__container'),'inside the card, not floating over the page');assert.notEqual(box,t.env.document.body);
   assert.equal(frame.style.position,'absolute');assert.equal(frame.style.top,'20px');assert.equal(frame.style.right,'252px','just left of the status panel (1000 - 758 + 10)');assert.equal(frame.style.width,'44px');assert.equal(frame.style.height,'44px');
   assert.equal(new URL(frame.src).search,`?nct=${frame.closest('ctg-search-hit-card')!.querySelector('.nct-id')!.textContent}`,'the page sees only the public study ID');
  }
  assert.equal(t.env.document.body.textContent!.match(/% match|Not recruiting|Outside the listed/g),null,'no score or reason enters the page DOM');
  t.setLayout('narrow');t.env.window.dispatchEvent(new t.env.window.Event('resize'));
  for(const frame of badges(t.env.document)){assert.equal(frame.style.top,'7px');assert.equal(frame.style.right,'7px','top-right corner above the title on narrow layouts')}
  const frame=badges(t.env.document)[0];
  say(frame,{expanded:true,visible:true},'https://evil.example');assert.equal(frame.style.width,'44px','a message from another origin cannot resize it');
  say(frame,{expanded:true});assert.equal(frame.style.width,'44px','an incomplete message is ignored');
  say(frame,{expanded:true,visible:true});assert.equal(frame.style.width,'252px');assert.equal(frame.style.height,'150px');assert.equal(frame.style.right,'7px','it grows to the left and down from the same corner');
  say(frame,{expanded:false,visible:true});assert.equal(frame.style.width,'44px');
  say(frame,{expanded:true,visible:false});assert.equal(frame.style.width,'44px','an empty badge never grows');assert.equal(frame.style.visibility,'hidden');
  assert.equal(t.command('restore').ok,true);await settle();assert.deepEqual(order(t.env.document),[FIRST,SECOND],'Restore original order');assert.equal(badges(t.env.document).length,0);
 }finally{t.controller.dispose();t.env.teardown()}
});

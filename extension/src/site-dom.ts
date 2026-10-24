import{isNctId,sitePageUrl,type SiteSnapshot,type SiteScore}from'./site-contract';
export type SiteCard={nctId:string;element:HTMLElement};
export type CardDiscovery={cards:SiteCard[];container:HTMLElement|null;diagnostic:string;supported:boolean};
/** Candidate selector comes from current official search source; fail closed on any mismatch. */
export function discoverResultCards(doc:Document,url:string):CardDiscovery{
 const fail=(diagnostic:string):CardDiscovery=>({cards:[],container:null,diagnostic,supported:false});
 let base:URL;try{base=sitePageUrl(url);if(base.pathname!=='/search')return fail('Open ClinicalTrials.gov search results first.')}catch{return fail('Unsupported website.')}
 const elements=Array.from(doc.querySelectorAll<HTMLElement>('ctg-search-hit-card')).filter(e=>!e.closest('[hidden],[aria-hidden="true"]')&&doc.defaultView?.getComputedStyle(e).display!=='none');
 if(!elements.length)return fail('No supported result cards found. Table/map views and unknown layouts are read-only.');
 if(elements.length>100)return fail('Too many loaded cards to safely enhance. Use a smaller results page.');
 const cards:SiteCard[]=[];const ids=new Set<string>();let container:HTMLElement|null=null;
 for(const element of elements){const found=new Set<string>();for(const a of Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href]'))){try{const u=sitePageUrl(new URL(a.getAttribute('href')||'',base).href),m=/^\/study\/(NCT[0-9]{8})\/?$/.exec(u.pathname);if(m)found.add(m[1])}catch{}}
  if(found.size!==1)return fail('A result card does not have one unambiguous study ID. No cards were moved.');const nctId=[...found][0];if(ids.has(nctId))return fail('Duplicate result cards detected. No cards were moved.');ids.add(nctId);
  if(!element.parentElement||container&&element.parentElement!==container)return fail('Result cards do not share a verified container. No cards were moved.');container=element.parentElement;cards.push({nctId,element});
 }
 return{cards,container,diagnostic:`${cards.length} loaded studies on this results page. Ranking does not include other pages.`,supported:true};
}
export class SiteCardManager{
 private cards:SiteCard[]=[];private container:HTMLElement|null=null;private slots:Comment[]=[];private sequence=0;private signature='';private expectedOrder='';private current:SiteSnapshot;
 constructor(private doc:Document,private getUrl:()=>string,private prefix=''){this.current={generation:'0',url:getUrl(),nctIds:[],diagnostic:'Waiting for result cards.',supported:false}}
 get snapshot(){return structuredClone(this.current)}
 scan(){const url=this.getUrl();let found=discoverResultCards(this.doc,url);const order=found.cards.map(c=>c.nctId).join(','),signature=url+'|'+[...found.cards.map(c=>c.nctId)].sort().join(',');if(signature===this.signature&&order===this.expectedOrder&&found.supported===this.current.supported)return false;
  if(this.slots.length&&found.cards.length===this.cards.length&&found.cards.every(c=>this.cards.some(old=>old.nctId===c.nctId&&old.element===c.element))&&this.slots.every(slot=>slot.parentElement===this.container)){this.focusAfter(()=>this.cards.forEach((card,index)=>this.container!.insertBefore(card.element,this.slots[index].nextSibling)));found=discoverResultCards(this.doc,url)}this.dropSlots();this.cards=found.cards;this.container=found.container;this.signature=signature;this.expectedOrder=found.cards.map(c=>c.nctId).join(',');this.current={generation:this.prefix+String(++this.sequence),url,nctIds:this.cards.map(c=>c.nctId),diagnostic:found.diagnostic,supported:found.supported};return true;
 }
 private validated(){const found=discoverResultCards(this.doc,this.getUrl());if(!this.current.supported||this.getUrl()!==this.current.url||found.container!==this.container||found.cards.length!==this.cards.length||found.cards.some(c=>!this.cards.some(old=>old.nctId===c.nctId&&old.element===c.element)))throw Error('The results page changed. Refresh matching before moving cards.');return found}
 private focusAfter(action:()=>void){const active=this.doc.activeElement as HTMLElement|null;const contained=!!active&&this.cards.some(c=>c.element.contains(active));action();if(contained&&active?.isConnected)try{active.focus({preventScroll:true})}catch{}}
 reorder(order:string[],generation:string){if(!Array.isArray(order)||order.length!==this.cards.length||new Set(order).size!==order.length||order.some(id=>!this.cards.some(c=>c.nctId===id)))throw Error('Invalid current-page card order');return this.rank(order.map((nctId,index)=>({nctId,score:100-index})),generation)}
 rank(scores:SiteScore[],generation:string){this.validated();if(generation!==this.current.generation||!Array.isArray(scores)||scores.length!==this.cards.length||new Set(scores.map(s=>s?.nctId)).size!==scores.length||scores.some(s=>!isNctId(s?.nctId)||!Number.isFinite(s.score)||s.score<0||s.score>100||!this.cards.some(c=>c.nctId===s.nctId)))throw Error('Every loaded card needs a validated score for this page generation.');
  const byId=new Map(scores.map(s=>[s.nctId,s.score])),ordered=this.cards.map((card,index)=>({card,index})).sort((a,b)=>byId.get(b.card.nctId)!-byId.get(a.card.nctId)!||a.index-b.index).map(x=>x.card);
  if(!this.slots.length)this.slots=this.cards.map(card=>{const mark=this.doc.createComment('Treatable original card position');this.container!.insertBefore(mark,card.element);return mark});
  this.focusAfter(()=>ordered.forEach((card,index)=>this.container!.insertBefore(card.element,this.slots[index].nextSibling)));this.expectedOrder=ordered.map(c=>c.nctId).join(',');return this.snapshot;
 }
 restore(){this.validated();if(this.slots.length)this.focusAfter(()=>this.cards.forEach((card,index)=>this.container!.insertBefore(card.element,this.slots[index].nextSibling)));this.expectedOrder=this.cards.map(c=>c.nctId).join(',');this.dropSlots();return this.snapshot}
 private dropSlots(){for(const slot of this.slots)slot.remove();this.slots=[]}
 dispose(){try{if(this.slots.length)this.restore()}catch{this.dropSlots()}this.cards=[];this.container=null}
 getCards(){return [...this.cards]}
}

import{DEFAULT_AVAILABILITY,parseAvailability,publicAvailability,type SiteAvailabilityOptions}from'./site-availability';
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
 private hidden=new Map<HTMLElement,boolean>();private geoHidden=new Map<HTMLElement,boolean>();private statuses:Record<string,string>={};private options:SiteAvailabilityOptions={...DEFAULT_AVAILABILITY};
 constructor(private doc:Document,private getUrl:()=>string,private prefix=''){this.current={generation:'0',url:getUrl(),nctIds:[],diagnostic:'Waiting for result cards.',supported:false}}
 get snapshot(){return structuredClone(this.current)}
 private discover(){for(const[element,previous]of [...this.hidden,...this.geoHidden])if(element.isConnected)element.hidden=previous;try{return discoverResultCards(this.doc,this.getUrl())}finally{for(const[element]of [...this.hidden,...this.geoHidden])if(element.isConnected)element.hidden=true}}
 private visibleCards(){return this.cards.filter(c=>!this.hidden.has(c.element)&&!this.geoHidden.has(c.element))}
 private updateSnapshot(){const visible=this.visibleCards(),unverified=visible.filter(c=>!publicAvailability(this.statuses[c.nctId],this.options).verified).length;this.current={generation:this.prefix+String(++this.sequence),url:this.getUrl(),nctIds:visible.map(c=>c.nctId),supported:!!this.container,diagnostic:this.container?`${visible.length} visible studies on this results page; ${this.cards.length-visible.length} hidden by public recruitment status. Other pages are not ranked.`:this.current.diagnostic,totalCards:this.cards.length,hiddenCards:this.hidden.size,distanceHiddenCards:this.geoHidden.size,unverifiedCards:unverified,allNctIds:this.cards.map(c=>c.nctId)}}
 scan(){const url=this.getUrl();let found=this.discover();const order=found.cards.map(c=>c.nctId).join(','),signature=url+'|'+[...found.cards.map(c=>c.nctId)].sort().join(',');if(signature===this.signature&&order===this.expectedOrder&&found.supported===this.current.supported)return false;
  if(this.slots.length&&found.cards.length===this.cards.length&&found.cards.every(c=>this.cards.some(old=>old.nctId===c.nctId&&old.element===c.element))&&this.slots.every(slot=>slot.parentElement===this.container)){this.focusAfter(()=>this.cards.forEach((card,index)=>this.slots[index].nextSibling===card.element?undefined:this.container!.insertBefore(card.element,this.slots[index].nextSibling)));found=this.discover()}this.dropSlots();this.restoreVisibility();this.cards=found.cards;this.container=found.container;this.signature=signature;this.expectedOrder=found.cards.map(c=>c.nctId).join(',');this.current={generation:'',url,nctIds:[],diagnostic:found.diagnostic,supported:found.supported};this.applyVisibility();this.updateSnapshot();return true;
 }
 private validated(){const found=this.discover();if(!this.current.supported||this.getUrl()!==this.current.url||found.container!==this.container||found.cards.length!==this.cards.length||found.cards.some(c=>!this.cards.some(old=>old.nctId===c.nctId&&old.element===c.element)))throw Error('The results page changed. Refresh matching before moving cards.');return found}
 private focusAfter(action:()=>void){const active=this.doc.activeElement as HTMLElement|null;const contained=!!active&&this.cards.some(c=>c.element.contains(active));action();if(contained&&active?.isConnected)try{active.focus({preventScroll:true})}catch{}}
 private restoreGeoVisibility(){for(const[element,previous]of this.geoHidden)if(element.isConnected)element.hidden=previous;this.geoHidden.clear()}
 private restoreVisibility(){this.restoreGeoVisibility();for(const[element,previous]of this.hidden)if(element.isConnected)element.hidden=previous;this.hidden.clear()}
 private applyVisibility(){this.restoreVisibility();for(const card of this.cards)if(!publicAvailability(this.statuses[card.nctId],this.options).visible){this.hidden.set(card.element,card.element.hidden);card.element.hidden=true}}
 setAvailability(statuses:Record<string,string>,options:SiteAvailabilityOptions){this.validated();const before=JSON.stringify([this.current.nctIds,this.current.unverifiedCards,this.options]);this.restore();this.statuses={...statuses};this.options=parseAvailability(options);this.applyVisibility();const after=JSON.stringify([this.visibleCards().map(c=>c.nctId),this.visibleCards().filter(c=>!publicAvailability(this.statuses[c.nctId],this.options).verified).length,this.options]);if(before!==after)this.updateSnapshot();return this.snapshot}
 setDistanceVisibility(ids:string[],generation:string){this.validated();if(generation!==this.current.generation||!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>!this.cards.some(c=>c.nctId===id&&!this.hidden.has(c.element))))throw Error('Invalid local distance target');this.restore();this.restoreGeoVisibility();for(const card of this.cards)if(!this.hidden.has(card.element)&&!ids.includes(card.nctId)){this.geoHidden.set(card.element,card.element.hidden);card.element.hidden=true}this.updateSnapshot();return this.snapshot}
 restoreDerived(){const changed=this.geoHidden.size>0;try{this.restore()}catch{this.dropSlots()}finally{this.restoreGeoVisibility()}if(this.scan()||changed)this.updateSnapshot();return this.snapshot}
 clearAvailability(){try{this.restore()}catch{this.dropSlots()}finally{this.options={onlyAccepting:false,includeSoon:false,includeInvitation:false};this.statuses={};this.restoreVisibility()}this.scan();this.updateSnapshot();return this.snapshot}
 reorder(order:string[],generation:string){const visible=this.visibleCards();if(!Array.isArray(order)||order.length!==visible.length||new Set(order).size!==order.length||order.some(id=>!visible.some(c=>c.nctId===id)))throw Error('Invalid current-page card order');return this.rank(order.map((nctId,index)=>({nctId,score:100-index})),generation)}
 rank(scores:SiteScore[],generation:string){this.validated();const visible=this.visibleCards();if(generation!==this.current.generation||!Array.isArray(scores)||scores.length!==visible.length||new Set(scores.map(s=>s?.nctId)).size!==scores.length||scores.some(s=>!isNctId(s?.nctId)||!Number.isFinite(s.score)||s.score<0||s.score>100||!visible.some(c=>c.nctId===s.nctId)))throw Error('Every visible card needs a validated score for this page generation.');
  const byId=new Map(scores.map(s=>[s.nctId,s.score])),ordered=visible.map((card,index)=>({card,index})).sort((a,b)=>byId.get(b.card.nctId)!-byId.get(a.card.nctId)!||a.index-b.index).map(x=>x.card);
  if(!this.slots.length)this.slots=this.cards.map(card=>{const mark=this.doc.createComment('Treatable original card position');this.container!.insertBefore(mark,card.element);return mark});
  const positions=this.cards.flatMap((c,index)=>this.hidden.has(c.element)||this.geoHidden.has(c.element)?[]:[index]);this.focusAfter(()=>ordered.forEach((card,index)=>this.slots[positions[index]].nextSibling===card.element?undefined:this.container!.insertBefore(card.element,this.slots[positions[index]].nextSibling)));this.expectedOrder=this.discover().cards.map(c=>c.nctId).join(',');return this.snapshot;
 }
 restore(){this.validated();if(this.slots.length)this.focusAfter(()=>this.cards.forEach((card,index)=>this.slots[index].nextSibling===card.element?undefined:this.container!.insertBefore(card.element,this.slots[index].nextSibling)));this.expectedOrder=this.cards.map(c=>c.nctId).join(',');this.dropSlots();return this.snapshot}
 private dropSlots(){for(const slot of this.slots)slot.remove();this.slots=[]}
 dispose(){try{if(this.slots.length)this.restore()}catch{this.dropSlots()}this.restoreVisibility();this.cards=[];this.container=null}
 getCards(){return [...this.visibleCards()]}
 getAllCards(){return [...this.cards]}
}

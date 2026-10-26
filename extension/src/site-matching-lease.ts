/** Nonsensitive, bounded page lease. No profile or score values cross the heartbeat. */
export class PageMatchingLease{
 private heartbeat?:ReturnType<typeof setInterval>;private expiry?:ReturnType<typeof setTimeout>;private generation?:string;private expires=0;private busy=false;
 /** maxMs is the longest deadline a caller may set. The page lease keeps its five-minute bound; the overlay's editing session passes its own. */
 constructor(private check:(generation:string)=>Promise<boolean>,private clear:()=>void,private now=()=>Date.now(),private maxMs=5*60*1000){}
 start(generation:string,expires:number){this.stop(false);if(typeof generation!=='string'||!Number.isSafeInteger(expires)||expires<=this.now()||expires>this.now()+this.maxMs+1000)throw Error('Invalid page matching lease');this.generation=generation;this.expires=expires;this.heartbeat=setInterval(()=>void this.tick(),10000);this.expiry=setTimeout(()=>this.stop(),Math.max(0,expires-this.now()));(this.heartbeat as any).unref?.();(this.expiry as any).unref?.()}
 /** Slides the deadline forward. It never shortens the deadline, never extends past maxMs from now, and cannot revive a lease that has ended or run out. */
 extend(expires:number){if(!this.generation||!Number.isSafeInteger(expires)||expires<=this.expires||this.now()>=this.expires||expires>this.now()+this.maxMs+1000)return false;this.expires=expires;clearTimeout(this.expiry);this.expiry=setTimeout(()=>this.stop(),Math.max(0,expires-this.now()));(this.expiry as any).unref?.();return true}
 async tick(){const generation=this.generation;if(!generation||this.busy)return;if(this.now()>=this.expires){this.stop();return}this.busy=true;try{if(!await this.check(generation)&&this.generation===generation)this.stop()}catch{if(this.generation===generation)this.stop()}finally{this.busy=false}}
 /** The current deadline, or 0 when the lease is not running. */
 deadline(){return this.generation?this.expires:0}
 stop(clear=true){const active=!!this.generation;this.generation=undefined;clearInterval(this.heartbeat);clearTimeout(this.expiry);this.heartbeat=undefined;this.expiry=undefined;if(active&&clear)this.clear()}
}

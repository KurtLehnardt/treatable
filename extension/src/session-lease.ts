/** Timing shared by the study and search editing session. The session lasts 30 minutes from the last renewal and slides forward
 * while the person types or clicks in the overlay. Nothing here reads, stores or sends what was typed. */
export const SESSION_TTL_MS=30*60*1000;
/** The countdown is shown only for the last five minutes of the session. */
export const SESSION_COUNTDOWN_MS=5*60*1000;
/** The Keep working button is offered for the last minute. */
export const SESSION_KEEP_WORKING_MS=60*1000;
/** Typing and clicking renew the study session at most this often, so a busy keyboard never floods the extension port. */
export const ACTIVITY_RENEW_MS=20*1000;
const ACTIVITY_EVENTS=['keydown','pointerdown','input'] as const;
type ActivityTarget=Pick<Document,'addEventListener'|'removeEventListener'>;
/** Calls onActivity for each key press, pointer press or input in the document. The event itself is never read. Returns a function that stops listening. */
export function watchActivity(doc:ActivityTarget|undefined,onActivity:()=>void):()=>void{
 if(typeof doc?.addEventListener!=='function')return()=>{};
 for(const type of ACTIVITY_EVENTS)doc.addEventListener(type,onActivity,{capture:true,passive:true});
 return()=>{for(const type of ACTIVITY_EVENTS)doc.removeEventListener(type,onActivity,{capture:true})};
}
/** Minutes and seconds left, such as 4:05. */
export function formatCountdown(seconds:number){const s=Math.max(0,Math.ceil(seconds));return`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}

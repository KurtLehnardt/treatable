/**
 * The AI-matched results switch. It is off unless the person turns it on, and turning it on is their consent. The one-line disclosure
 * beside the switch says what that sends for the model provider chosen in Settings, and the background records which of the two
 * disclosures the person turned it on beside (ranking-consent.ts). Nothing here touches storage, so the overlay and the background share it.
 */
import type {AiRanking,ModelProvider} from './ui-prefs';
/** Which disclosure was beside the switch when the person turned it on: the OpenAI one or the local model one. */
export type AiConsent='openai'|'local';
export const isAiConsent=(value:unknown):value is AiConsent=>value==='openai'||value==='local';
/**
 * The line beside the switch. Every word must stay literally true: with OpenAI, a ranking sends the condition terms (each at most 80
 * characters, see shared/rank-contract.mjs) and the public records of the studies on the results page (native/rank.mjs); with the local
 * model it sends nothing to OpenAI.
 */
export const AI_SWITCH_DISCLOSURE:Readonly<Record<ModelProvider,string>>=Object.freeze({
 openai:'Sends short condition words and the page’s public study records to OpenAI to sort results. Off unless you turn it on.',
 local:'Sorts results with the local model on this device. Nothing is sent to OpenAI.',
});
/** Whether AI-matched results run for this provider. OpenAI ranking needs the switch turned on beside the OpenAI disclosure. The local
 * model sends nothing to OpenAI, so it runs when the switch was turned on beside either disclosure. */
export function aiRankingFor(consent:AiConsent|null|undefined,provider:ModelProvider|undefined):AiRanking{return consent==='openai'||consent==='local'&&provider==='local'?'on':'off'}
/**
 * The overlay is a frame inside the ClinicalTrials.gov page, so script on that page could hide it, fade it, clip it, cover it with a
 * decoy or move it under the pointer between two clicks. A turn-on therefore counts only when, for at least this long before the click
 * or key press:
 * - the browser has reported the whole switch row (switch and disclosure) in view and fully visible (IntersectionObserver with
 *   trackVisibility: not clipped, covered, faded, filtered or transformed by anything in the page or the frame); and
 * - the pointer has been inside the frame, or the frame has had keyboard focus. A frame moved under the pointer, or a click that comes
 *   straight from the website, starts both clocks again.
 */
export const AI_SWITCH_MIN_SHOWN_MS=500;
/** performance.now() times since when each condition above has held, or undefined while it does not. */
export interface SwitchExposure{shown?:number;pointer?:number;focus?:number}
export function exposedLongEnough(exposure:SwitchExposure,now:number):boolean{
 const held=(since:number|undefined)=>since!==undefined&&Number.isFinite(now)&&now-since>=AI_SWITCH_MIN_SHOWN_MS;
 return held(exposure.shown)&&(held(exposure.pointer)||held(exposure.focus));
}
/** True only for a person's own click or key press on the switch: a trusted browser event while this frame has transient user activation.
 * A script that sets the switch, a synthetic event or a call without an event is not consent. */
export function fromUserGesture(event:unknown):boolean{
 const native=(event as {nativeEvent?:{isTrusted?:unknown}}|null|undefined)?.nativeEvent;
 return native?.isTrusted===true&&(globalThis as {navigator?:{userActivation?:{isActive?:unknown}}}).navigator?.userActivation?.isActive===true;
}

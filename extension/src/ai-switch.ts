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
 * The overlay is a frame inside the ClinicalTrials.gov page, so script on that page could hide it, fade it or cover it with a decoy and
 * line the switch up under something else. A turn-on therefore counts only when the browser reports the switch and its disclosure fully
 * visible (IntersectionObserver with trackVisibility: not covered, faded, filtered or transformed by anything in the page or the frame)
 * and has kept reporting that for at least this long.
 */
export const AI_SWITCH_MIN_SHOWN_MS=500;
/** True only for a person's own click or key press on the switch: a trusted browser event while this frame has transient user activation.
 * A script that sets the switch, a synthetic event or a call without an event is not consent. */
export function fromUserGesture(event:unknown):boolean{
 const native=(event as {nativeEvent?:{isTrusted?:unknown}}|null|undefined)?.nativeEvent;
 return native?.isTrusted===true&&(globalThis as {navigator?:{userActivation?:{isActive?:unknown}}}).navigator?.userActivation?.isActive===true;
}

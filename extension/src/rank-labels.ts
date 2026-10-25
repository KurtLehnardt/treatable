/** Short, factual card labels for AI-matched results. They describe the record or the relevance score, never a person's chances.
 * Kept free of imports so the small badge frame stays small. */
export type ProviderReason='strong_match'|'possible_match'|'unclear'|'unrelated';
export type CheckReason='not_recruiting'|'outside_age_range'|'sex_mismatch';
export type RankReasonId=ProviderReason|CheckReason|'not_scored';
export const REASON_TEXT:Readonly<Record<RankReasonId,string>>=Object.freeze({
 strong_match:'Strong match for your condition',possible_match:'Possible match',unclear:'Relevance unclear',unrelated:'Not about your condition',
 not_recruiting:'Not recruiting',outside_age_range:'Outside the listed age range',sex_mismatch:'Listed for a different sex',not_scored:'Not scored'
});
export const isReasonId=(v:unknown):v is RankReasonId=>typeof v==='string'&&Object.hasOwn(REASON_TEXT,v);
export const CHECK_REASONS:readonly CheckReason[]=Object.freeze(['not_recruiting','outside_age_range','sex_mismatch']);

import type {ApplyRecord} from './apply-contract.mjs';
export function normalizeApplyRecord(raw:unknown,fetchedAt:number,maxBytes?:number):ApplyRecord;

export function normalizeStudyBrief(raw:unknown,fetchedAt:number):import('./apply-contract.mjs').PublicStudyBrief;

/** Maximum number of consecutive source excerpts the study purpose is split into for a model request. */
export const PURPOSE_MAX_EXCERPTS:number;
/** Splits text into trimmed exact substrings within the limits, cutting at sentence ends, line breaks or spaces. */
export function splitExcerpt(value:unknown,maxChars?:number,maxBytes?:number):string[];
/** The complete sanitized brief summary for display on this device only; empty when the record has none. */
export function studyPurposeText(raw:unknown):string;

export const MAX_PUBLIC_SUMMARY_CHARS:number;export const MAX_PUBLIC_CRITERIA_CHARS:number;
export const UNTRUSTED_FIELD:'untrusted_public_record_text';export const UNTRUSTED_TEXT_RULE:string;
export function sanitizeUntrustedText(value:unknown,max?:number):string;
export function sanitizeUntrustedList(values:unknown):string[];
export interface UntrustedPublicRecordText{title:string;conditions:string[];summary:string;criteria:string}
export function untrustedPublicRecordText(fields:{title?:unknown;conditions?:unknown;summary?:unknown;criteria?:unknown}):UntrustedPublicRecordText;

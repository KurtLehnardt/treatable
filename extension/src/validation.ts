/** Validation at browser/native boundaries. Errors never echo patient or model input. */
export const MAX_MESSAGE_BYTES = 96 * 1024;
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const SINGLE_LINE = /[\r\n\t]/u;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
export type FormInput = {condition:string;notes:string;age:string;sex:string;zip:string;radius:string};
export function record(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&Object.prototype.toString.call(value)==='[object Object]';}
export function exactKeys(value:Record<string,unknown>,keys:string[]){if(Object.keys(value).some(key=>!keys.includes(key)))throw new Error('Unsupported input format.');}
export function boundedText(value:unknown,label:string,max:number,{multiline=false,empty=true}:{multiline?:boolean;empty?:boolean}={}):string{
 if(typeof value!=='string'||value.length>max||CONTROLS.test(value)||LONE_SURROGATE.test(value)||(!multiline&&SINGLE_LINE.test(value)))throw new Error(`${label} contains unsupported text or exceeds its limit.`);
 const text=value.normalize('NFC').trim();if(!empty&&!text)throw new Error(`${label} is required.`);return text;
}
/** Longest prefix of at most `max` UTF-16 units that ends on a code-point boundary (never a lone high surrogate). */
export function cutCodePoints(value:string,max:number):string{let out=value.length>max?value.slice(0,max):value;const last=out.charCodeAt(out.length-1);if(last>=0xd800&&last<=0xdbff)out=out.slice(0,-1);return out;}
// Controls, format/bidi/zero-width/tag characters, every default-ignorable code point and (with /u) lone surrogates.
const PAGE_INVISIBLE=/[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}]/gu;
/** Display-only text read from an exact-origin study page (never model input). Harmless invisible or control characters are
 * stripped instead of rejected, and the result is cut on a code-point boundary; an overlong single-line value ends in an
 * ellipsis. Callers type-check first: anything other than a primitive string, or a raw value over `rawMax`, is rejected. */
export function sanitizePageText(value:unknown,label:string,max:number,{multiline=false,rawMax=100000}:{multiline?:boolean;rawMax?:number}={}):string{
 if(typeof value!=='string'||value.length>rawMax)throw new Error(`${label} contains unsupported text or exceeds its limit.`);
 let text=value.replace(/\r\n?|[\u2028\u2029]/g,'\n');if(!multiline)text=text.replace(/[\n\t]+/g,' ');
 text=text.replace(PAGE_INVISIBLE,ch=>ch==='\n'||ch==='\t'?ch:'').normalize('NFC').trim();
 if(text.length<=max)return text;
 return multiline?cutCodePoints(text,max).trimEnd():cutCodePoints(text,max-1).trimEnd()+'\u2026';
}
export function withinMessageBudget(value:unknown):void{let body:string|undefined;try{body=JSON.stringify(value)}catch{throw new Error('Unsupported local message.')}if(!body||new TextEncoder().encode(body).byteLength>MAX_MESSAGE_BYTES)throw new Error('Local message exceeds its size limit.');}
export function parseFormInput(value:unknown):FormInput{
 if(!record(value))throw new Error('Check your profile fields.');const fields=['condition','notes','age','sex','zip','radius'];exactKeys(value,fields);if(fields.some(key=>!Object.prototype.hasOwnProperty.call(value,key)))throw new Error('Check your profile fields.');
 const condition=boundedText(value.condition,'Conditions',2400,{multiline:true});
 const diagnoses=condition.split(/[,;\n]/).map(v=>v.trim()).filter(Boolean);
 if(diagnoses.length>12||diagnoses.some(v=>v.length>200))throw new Error('Enter at most 12 conditions, each no longer than 200 characters.');
 const notes=boundedText(value.notes,'Notes',12000,{multiline:true});if(!diagnoses.length&&!notes)throw new Error('Describe at least one condition or symptom.');
 const age=boundedText(value.age,'Age',8,{empty:false});if(!/^\d{1,3}(?:\.\d{1,3})?$/.test(age)||!Number.isFinite(Number(age))||Number(age)<0||Number(age)>120)throw new Error('Enter an age from 0 to 120 years using decimal digits.');
 const sex=boundedText(value.sex,'Sex',24,{empty:false});if(!['female','male','prefer_not_to_say'].includes(sex))throw new Error('Choose one of the listed sex options.');
 const zip=boundedText(value.zip,'ZIP code',10);if(zip&&!/^\d{5}(?:-\d{4})?$/.test(zip))throw new Error('Enter a five-digit US ZIP code, optionally ZIP+4.');
 const radius=boundedText(value.radius,'Travel radius',8,{empty:false});if(!['25','50','100','250','anywhere'].includes(radius))throw new Error('Choose one of the listed travel distances.');
 return {condition,notes,age,sex,zip,radius};
}
export function parsePageReply(value:unknown):unknown{if(!record(value)||value.ok!==true||!record(value.source))throw new Error('The current page could not be read. Open a supported study page and retry.');return value.source;}

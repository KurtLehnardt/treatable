/** Bounded single-line text (the offline ZIP lookup). Errors never echo the input. */
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const SINGLE_LINE = /[\r\n\t]/u;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
export function boundedText(value:unknown,label:string,max:number,{multiline=false,empty=true}:{multiline?:boolean;empty?:boolean}={}):string{
 if(typeof value!=='string'||value.length>max||CONTROLS.test(value)||LONE_SURROGATE.test(value)||(!multiline&&SINGLE_LINE.test(value)))throw new Error(`${label} contains unsupported text or exceeds its limit.`);
 const text=value.normalize('NFC').trim();if(!empty&&!text)throw new Error(`${label} is required.`);return text;
}

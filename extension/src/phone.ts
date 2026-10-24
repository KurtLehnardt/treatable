/** Dial links for study contact phone numbers.
 * A tel: link is built only from the structured contact fields of the official record (phone, phoneExt and the listed
 * country). It is never built from model output or other free text. The patient clicks the link; nothing dials by itself.
 * Output is an E.164 number plus an optional ;ext= extension, so the href holds only "tel:", "+", digits and ";ext=". */
export interface DialNumber{
 /** Exact link target, for example tel:+18015550101;ext=22. */
 href:string;
 /** E.164 form, for example +18015550101. */
 e164:string;
 /** Extension digits, when the record lists one. */
 ext?:string;
 /** Readable number with any extension, for example "+1 801-555-0101 ext. 22". */
 display:string;
}
/** Countries and territories in the North American Numbering Plan (+1), as ClinicalTrials.gov names them. */
const NANP=new Set(['united states','united states of america','usa','u.s.','canada','puerto rico','guam','virgin islands (u.s.)','virgin islands, u.s.','u.s. virgin islands','united states virgin islands','northern mariana islands','american samoa']);
/** Calling code, whether national numbers carry a leading 0 trunk prefix that is dropped in E.164, and the allowed
 * national significant number lengths. Countries missing here need the number written with its + country code. */
const COUNTRIES:Record<string,{cc:string;trunk:boolean;min:number;max:number}>={
 'united kingdom':{cc:'44',trunk:true,min:9,max:10},germany:{cc:'49',trunk:true,min:6,max:13},france:{cc:'33',trunk:true,min:9,max:9},
 netherlands:{cc:'31',trunk:true,min:9,max:9},belgium:{cc:'32',trunk:true,min:8,max:9},switzerland:{cc:'41',trunk:true,min:9,max:9},
 austria:{cc:'43',trunk:true,min:4,max:13},australia:{cc:'61',trunk:true,min:9,max:9},'new zealand':{cc:'64',trunk:true,min:8,max:10},
 israel:{cc:'972',trunk:true,min:8,max:9},japan:{cc:'81',trunk:true,min:9,max:10},'korea, republic of':{cc:'82',trunk:true,min:8,max:10},
 ireland:{cc:'353',trunk:true,min:7,max:9},sweden:{cc:'46',trunk:true,min:7,max:9},taiwan:{cc:'886',trunk:true,min:8,max:9},
 spain:{cc:'34',trunk:false,min:9,max:9},italy:{cc:'39',trunk:false,min:6,max:11},denmark:{cc:'45',trunk:false,min:8,max:8},
 norway:{cc:'47',trunk:false,min:8,max:8},poland:{cc:'48',trunk:false,min:9,max:9},portugal:{cc:'351',trunk:false,min:9,max:9},greece:{cc:'30',trunk:false,min:10,max:10}
};
/** The only shape a tel: link may take. */
export const TEL_HREF=/^tel:\+[1-9]\d{6,14}(?:;ext=\d{1,8})?$/;
/** An extension written at the end of the number: "x22", "ext. 22", "extension 22", "#22" or ";ext=22". */
const EXT_TAIL=/^(.*?)[\s,;]*(?:ext(?:ension)?\.?|x|#)\s*[:.=]?\s*(\d{1,8})$/i;
const EXT_FIELD=/^(?:(?:ext(?:ension)?\.?|x|#)\s*[:.=]?\s*)?(\d{1,8})$/i;
/** Digits with common separators only. Letters, a second +, or any other character means the field is not a plain number. */
const NUMBER=/^[\d\s().\-\/]+$/;
const countryKey=(country:string|null|undefined)=>typeof country==='string'?country.trim().toLowerCase().replace(/\s+/g,' '):'';
export const isNanpCountry=(country:string|null|undefined)=>NANP.has(countryKey(country));
/** Ten-digit NANP number: area code and exchange start with 2-9 and are not N11 service codes. */
function nanp(n:string){return /^[2-9]\d{2}[2-9]\d{6}$/.test(n)&&n.slice(1,3)!=='11'&&n.slice(4,6)!=='11'}
/** Normalizes one structured contact phone field. Returns undefined, and so no Call button, unless the value is
 * unambiguously a complete phone number for the given country (or written with its + country code). */
export function dialNumber(phone:unknown,phoneExt?:unknown,country?:string|null):DialNumber|undefined{
 if(typeof phone!=='string'||phone.length>40)return;
 let main=phone.trim(),ext:string|undefined;
 const tail=EXT_TAIL.exec(main);if(tail){main=tail[1].trim();ext=tail[2]}
 if(phoneExt!==null&&phoneExt!==undefined&&phoneExt!==''){
  if(typeof phoneExt!=='string')return;const field=EXT_FIELD.exec(phoneExt.trim());if(!field)return;
  if(ext&&ext!==field[1])return;ext=field[1];
 }
 const plus=main.startsWith('+');
 // "+44 (0)20 ..." marks a trunk 0 that is never dialled after the country code.
 if(plus)main=main.slice(1).replace(/\s*\(0\)\s*/,' ');
 if(!main||!NUMBER.test(main))return;
 const digits=main.replace(/\D/g,'');let e164:string,display:string;
 if(plus){
  if(digits[0]==='0'||digits.length<8||digits.length>15)return;
  if(digits[0]==='1'&&!(digits.length===11&&nanp(digits.slice(1))))return;
  e164='+'+digits;display=digits[0]==='1'?`+1 ${digits.slice(1,4)}-${digits.slice(4,7)}-${digits.slice(7)}`:e164;
 }else if(isNanpCountry(country)){
  const n=digits.length===11&&digits[0]==='1'?digits.slice(1):digits;if(!nanp(n))return;
  e164='+1'+n;display=`+1 ${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}`;
 }else{
  const rule=COUNTRIES[countryKey(country)];if(!rule||digits.startsWith('00'))return;
  let nsn=digits;if(rule.trunk){if(!nsn.startsWith('0'))return;nsn=nsn.slice(1)}
  if(nsn.length<rule.min||nsn.length>rule.max||rule.cc.length+nsn.length>15)return;
  e164='+'+rule.cc+nsn;display=`+${rule.cc} ${nsn}`;
 }
 const href=`tel:${e164}${ext?`;ext=${ext}`:''}`;if(!TEL_HREF.test(href))return;
 return{href,e164,...(ext?{ext}:{}),display:display+(ext?` ext. ${ext}`:'')};
}

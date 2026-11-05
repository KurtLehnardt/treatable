const controls=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
/** The condition in a ClinicalTrials.gov results URL (its `cond` parameter), as the website's own search put it there. Treatable never builds
 * or sends a search; this only reads what the person already searched for, so AI ranking can name it. Returns undefined when absent or empty,
 * and throws on text that is too long or holds control or bidirectional-override characters. */
export function readSiteCondition(value:string):string|undefined{
 const raw=new URL(value).searchParams.get('cond');
 if(raw===null)return undefined;
 if(raw.length>500||controls.test(raw))throw Error('Invalid search text');
 return raw.normalize('NFC').trim()||undefined;
}

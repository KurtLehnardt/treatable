/** Verified against ClinicalTrials.gov published filter definitions, 2026-10-24. */
export type FilterInput='text'|'select'|'multi'|'boolean'|'date-range'|'age-range'|'location';
export type SiteFilterField={key:string;label:string;group:string;input:FilterInput;options?:readonly{value:string;label:string}[];supported:boolean;hint?:string};
const choices=(items:readonly(readonly[string,string])[])=>items.map(([value,label])=>({value,label}));
const field=(key:string,label:string,group:string,input:FilterInput,options?:SiteFilterField['options'],hint?:string):SiteFilterField=>({key,label,group,input,supported:true,...(options?{options}:{}),...(hint?{hint}:{})});
export const SITE_FILTERS:readonly SiteFilterField[]=[
 field('cond','Condition/disease','Search','text'),field('term','Other terms','Search','text'),field('intr','Intervention/treatment','Search','text'),
 field('loc','Location','Search','location',undefined,'US ZIP codes use approximate offline postal centers. For other addresses, cities, states or countries, use the website location controls unless verified coordinates are provided.'),
 field('status','Study status','Study status','multi',choices([['not','Not yet recruiting'],['rec','Recruiting'],['act','Active, not recruiting'],['com','Completed'],['ter','Terminated'],['enr','Enrolling by invitation'],['sus','Suspended'],['wit','Withdrawn'],['unk','Unknown'],['ava','Expanded access available'],['nla','No longer available'],['tna','Temporarily not available'],['afm','Approved for marketing']])),
 field('sex','Sex','Eligibility','select',choices([['all','All'],['f','Female'],['m','Male']])),
 field('ages','Age groups','Eligibility','multi',choices([['child','Child (birth–17)'],['adult','Adult (18–64)'],['older','Older adult (65+)']])),
 field('manualAge','Manual age range','Eligibility','age-range',choices([['y','Years'],['M','Months'],['w','Weeks'],['d','Days'],['H','Hours'],['m','Minutes']])),
 field('healthy','Accepts healthy volunteers','Eligibility','boolean',undefined,'Accepts healthy volunteers does not mean healthy volunteers only.'),
 field('phase','Study phase','Study phase','multi',choices([['0','Early Phase 1'],['1','Phase 1'],['2','Phase 2'],['3','Phase 3'],['4','Phase 4'],['NA','Not applicable']])),
 field('studyType','Study type','Study type','multi',choices([['int','Interventional'],['obs','Observational'],['obs_patreg','Patient registries'],['exp','Expanded access'],['exp_indiv','Individual patients'],['exp_inter','Intermediate-size population'],['exp_treat','Treatment IND/Protocol']])),
 field('results','Study results','Results and documents','multi',choices([['with','With results'],['without','Without results']])),
 field('docs','Study documents','Results and documents','multi',choices([['prot','Study protocols'],['sap','Statistical analysis plans (SAPs)'],['icf','Informed consent forms (ICFs)']])),
 field('funderType','Funder type','Funder','multi',choices([['nih','NIH'],['fed','Other U.S. federal agency'],['industry','Industry'],['other','All others']])),
 ...([['start','Study start'],['primComp','Primary completion'],['firstPost','First posted'],['resFirstPost','Results first posted'],['lastUpdPost','Last update posted'],['studyComp','Study completion']]as const).map(([key,label])=>field(key,label,'Date ranges','date-range')),
 ...([['titles','Title and/or title acronym'],['outc','Outcome measure'],['spons','Sponsor and/or collaborator'],['lead','Sponsor (lead)'],['id','Study IDs'],['locn','Facility name']]as const).map(([key,label])=>field(key,label,'More ways to search','text')),
 field('violation','FDAAA 801 violations','More ways to search','boolean'),
 field('ressub','Results submitted','More ways to search','select',choices([['','No selection'],['n','No results submitted'],['y','Submitted, QC review not concluded'],['c','Submission with QC comments available']]))
];
export const SITE_FILTER_GROUPS=Array.from(new Set(SITE_FILTERS.map(f=>f.group))).map(label=>({label,fields:SITE_FILTERS.filter(f=>f.group===label)}));
export const SITE_QUERY_EVIDENCE={verifiedAt:'2026-10-24',definitions:'https://clinicaltrials.gov/chunk-N3WLMKWZ.js',serialization:'https://clinicaltrials.gov/chunk-N5W3TRDQ.js',form:'https://clinicaltrials.gov/chunk-4NVWBHFX.js',note:'Public source inspection verifies encoding; real-browser result behavior remains to be verified. Hashed bundles are evidence, not runtime dependencies.'};

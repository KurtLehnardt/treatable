import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {dialNumber,TEL_HREF} from '../src/phone';
import {buildApplyPlan,callContacts,recordCountry,contactHref,telUrl} from '../src/apply-plan';
import {ApplyView} from '../src/apply-view';
import {record,rawStudy,SALT_LAKE,TODAY,patient} from './apply-fixture';
import {normalizeApplyRecord} from '../shared/apply-record.mjs';

test('US numbers with dashes, dots, parentheses, spaces and a leading 1 become exact E.164 tel links',()=>{
 for(const raw of ['801-555-0100','(801) 555-0100','801.555.0100','801 555 0100','1-801-555-0100','1 (801) 555-0100','+1 801 555 0100','+1 (801) 555-0100','+18015550100','  801-555-0100  '])
  assert.deepEqual(dialNumber(raw,null,'United States'),{href:'tel:+18015550100',e164:'+18015550100',display:'+1 801-555-0100'},raw);
 assert.equal(dialNumber('1-800-555-0199',null,'United States')?.href,'tel:+18005550199');
 assert.equal(dialNumber('416-555-0123',null,'Canada')?.href,'tel:+14165550123');
 assert.equal(dialNumber('787-555-0123',null,'Puerto Rico')?.href,'tel:+17875550123');
});
test('extensions use ;ext= in the link and stay visible in the display text',()=>{
 for(const raw of ['801-555-0101 x22','801-555-0101 x 22','801-555-0101 ext. 22','801-555-0101 ext 22','801-555-0101, ext. 22','801-555-0101 extension 22','801-555-0101#22','801-555-0101;ext=22','801-555-0101 Ext: 22'])
  assert.deepEqual(dialNumber(raw,null,'United States'),{href:'tel:+18015550101;ext=22',e164:'+18015550101',ext:'22',display:'+1 801-555-0101 ext. 22'},raw);
 for(const ext of ['22','x22','ext. 22',' 22 '])assert.equal(dialNumber('801-555-0101',ext,'United States')?.href,'tel:+18015550101;ext=22',ext);
 assert.equal(dialNumber('801-555-0101 x22','22','United States')?.href,'tel:+18015550101;ext=22','the same extension in both fields is accepted');
 assert.equal(dialNumber('801-555-0101 x22','23','United States'),undefined,'conflicting extensions are ambiguous');
 for(const ext of ['22A','press 2','123456789',' ',42 as any])assert.equal(dialNumber('801-555-0101',ext,'United States'),undefined,String(ext));
});
test('international numbers: + country code anywhere, and national formats where the listed country is known',()=>{
 assert.equal(dialNumber('+44 20 7946 0000',null,null)?.href,'tel:+442079460000');
 assert.equal(dialNumber('+44 (0)20 7946 0000',null,'United Kingdom')?.href,'tel:+442079460000','the (0) trunk marker is not dialled');
 assert.equal(dialNumber('+33 1 23 45 67 89',null,'United States')?.href,'tel:+33123456789','an explicit + country code wins over the listing country');
 assert.equal(dialNumber('020 7946 0000',null,'United Kingdom')?.href,'tel:+442079460000');
 assert.equal(dialNumber('01 23 45 67 89',null,'France')?.href,'tel:+33123456789');
 assert.equal(dialNumber('030 1234567',null,'Germany')?.href,'tel:+49301234567');
 assert.equal(dialNumber('06 1234 5678',null,'Italy')?.href,'tel:+390612345678','Italian numbers keep their leading 0');
 assert.equal(dialNumber('912 345 678',null,'Spain')?.href,'tel:+34912345678');
 assert.equal(dialNumber('02-1234-5678',null,'Korea, Republic of')?.display,'+82 212345678');
 assert.equal(dialNumber('+86 10 1234 5678 ext 9',null,'China')?.href,'tel:+861012345678;ext=9');
 for(const [raw,country] of [['010 1234 5678','China'],['020 7946 0000',null],['020 7946 0000','Narnia'],['20 7946 0000','United Kingdom'],['0049 30 1234567','Germany'],['01 23','France']] as const)
  assert.equal(dialNumber(raw,null,country),undefined,`${raw} / ${country}`);
});
test('junk, model-style text and malformed numbers never produce a tel link',()=>{
 for(const raw of ['','N/A','Please call','See website','555-0100','12','801-555-010','801-555-01000','(011) 555-0100','911-555-0100','801-911-0100','101-555-0100','801-055-0100',
  'Call 801-555-0100','Phone: 801-555-0100','801-555-0100 or 801-555-0101','801-555-0100/0101','1-800-FLOWERS','tel:+18015550100','javascript:alert(1)','+1 801 555 0100 +1','++18015550100','+0 801 555 0100','+1 211 555 0100',
  '801-555-0100\nBcc: x','801<555>0100','801_555_0100','８０１-５５５-０１００','+12345','+1234567890123456','0018015550100','x22','ext. 22',42 as any,null,undefined,{} as any,'8'.repeat(41)])
  assert.equal(dialNumber(raw,null,'United States'),undefined,JSON.stringify(raw));
 assert.equal(telUrl('Call the coordinator at 801-555-0100',null,'United States'),undefined);
});
test('every produced href has the exact strict shape; contactHref refuses any other tel value',()=>{
 for(const raw of ['801-555-0100','801-555-0101 x22','+44 20 7946 0000','+861012345678'])assert.match(dialNumber(raw,null,'United States')!.href,TEL_HREF);
 for(const bad of ['tel:8015550100','tel:+1 801 555 0100','tel:+18015550100;ext=2a','tel:+18015550100?body=x','tel:+18015550100;phone-context=x','tel:javascript:alert(1)','mailto:x@example.org'])assert.equal(contactHref(bad,'tel:'),undefined,bad);
 assert.equal(contactHref('tel:+18015550101;ext=22','tel:'),'tel:+18015550101;ext=22');
});
test('central contacts use the US default only for US records; site contacts use their site country',()=>{
 assert.equal(recordCountry(record()),'United States');
 const mixed=normalizeApplyRecord(rawStudy({sites:[{facility:'A',status:'RECRUITING',country:'United States',contacts:[]},{facility:'B',status:'RECRUITING',country:'Germany',contacts:[]}]}),1);assert.equal(recordCountry(mixed),undefined);
 const uk=normalizeApplyRecord(rawStudy({contacts:[{name:'UK desk',phone:'020 7946 0000'}],sites:[{facility:'A',status:'RECRUITING',country:'United Kingdom',contacts:[{name:'Site desk',phone:'0161 496 0000'}]}]}),1);
 assert.equal(recordCountry(uk),'United Kingdom');
 const calls=callContacts(uk,uk.sites[0],[{...uk.sites[0].contacts[0],source:'site'},{...uk.centralContacts[0],source:'central'}]);
 assert.deepEqual(calls.map(c=>c.dial?.href),['tel:+441614960000','tel:+442079460000']);
 const unknown=callContacts(mixed,undefined,[{id:'c9',name:'Desk',role:null,phone:'801-555-0100',phoneExt:null,email:null,source:'central'}]);
 assert.equal(unknown[0].dial,undefined,'a multinational record without a + country code gets no Call button');
});
test('the contact plan lists each phone contact; Call and Copy number render only for valid numbers, with the exact href',()=>{
 const r=record(),plan=buildApplyPlan({record:r,patient:patient(),origin:SALT_LAKE,today:TODAY});
 assert.deepEqual(plan.callContacts.map(c=>[c.contact.name,c.dial?.href]),[['Sam Lee','tel:+18015550100'],['Pat Kim','tel:+18015550101;ext=22'],['Study Coordinator','tel:+18015550199']]);
 assert.equal(plan.followUpCall?.contact.name,'Sam Lee');assert.equal(plan.followUpCall?.dial?.href,'tel:+18015550100');assert.equal(plan.tel,'tel:+18015550100');
 const junk=normalizeApplyRecord(rawStudy({contacts:[{name:'Desk',phone:'Call 801-555-0199 after 5pm',email:'trials@example.org'}],sites:[{facility:'Only',status:'RECRUITING',country:'United States',contacts:[]}]}),1),junkPlan=buildApplyPlan({record:junk,patient:patient(),today:TODAY});
 assert.equal(junkPlan.callContacts.length,1);assert.equal(junkPlan.callContacts[0].dial,undefined);assert.equal(junkPlan.tel,undefined);assert.equal(junkPlan.followUpCall?.dial,undefined);
 const vm=(p:typeof plan):any=>({phase:'ready',nctId:r.nctId,activity:[],candidates:[],selectedIds:[r.nctId],records:[r],record:r,agentBusy:false,patient:patient(),zipNote:'',plan:p,draftEdited:false,draftOutdated:false,draftHeaders:false,copied:'',reminder:'',selectStudies(){},viewStudy(){},edit(){},answer(){},chooseSite(){},requestReview(){},editDraft(){},updateDraft(){},copyEmail(){},copyMessage(){},copyNumber(){},saveReminder(){},end(){}});
 const html=renderToStaticMarkup(React.createElement(ApplyView,{vm:vm(plan)}));
 const hrefs=[...html.matchAll(/href="(tel:[^"]*)"/g)].map(m=>m[1].replace(/&amp;/g,'&'));
 assert.deepEqual(hrefs,['tel:+18015550100','tel:+18015550101;ext=22','tel:+18015550199','tel:+18015550100'],'three script numbers plus the follow-up call');
 assert.equal((html.match(/>Copy number</g)??[]).length,4);assert.match(html,/Phone: 801-555-0101 ext\. 22/);assert.match(html,/Dials \+1 801-555-0101 ext\. 22/);
 assert.match(html,/Phone Link on Windows/);assert.match(html,/FaceTime/);assert.match(html,/use Copy number instead/);assert.doesNotMatch(html,/autoplay|onload/i);
 const junkHtml=renderToStaticMarkup(React.createElement(ApplyView,{vm:{...vm(junkPlan),record:junk,records:[junk],nctId:junk.nctId,selectedIds:[junk.nctId]}}));
 assert.doesNotMatch(junkHtml,/href="tel:/);assert.doesNotMatch(junkHtml,/>Copy number</);assert.doesNotMatch(junkHtml,/>Call</);assert.match(junkHtml,/Phone: Call 801-555-0199 after 5pm/,'the listed text stays visible');assert.match(junkHtml,/No Call button/);
});

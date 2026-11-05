import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{resolveZip}from'../src/core';import{studyPageNctId}from'../src/apply-page';
/* The bundled-corpus search, profile form and page-source adapter these tests first covered were removed with the private-matching form.
 * The offline ZIP lookup (study page site distances) and study-page detection remain. */
const zips=JSON.parse(readFileSync(new URL('../../scaffold/data/us-zip-centroids.json',import.meta.url),'utf8'));
test('offline ZIP lookup preserves a leading zero, reduces ZIP+4 to its five-digit ZIP and refuses short or unknown codes',()=>{assert.equal(resolveZip('01001-1234',zips).zip,'01001');assert.equal(resolveZip('83702',zips).city,'Boise');assert.throws(()=>resolveZip('8370',zips));assert.throws(()=>resolveZip('00000',zips));});
test('malformed or longer NCT routes never identify a study page',()=>{for(const path of ['/study/NCT123456789','/study/NCT12345678x','/study/NCT12345678/other','/search'])assert.equal(studyPageNctId('https://clinicaltrials.gov'+path),undefined,path);assert.equal(studyPageNctId('https://clinicaltrials.gov/study/NCT12345678/?tab=history'),'NCT12345678');});

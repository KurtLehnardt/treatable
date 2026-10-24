import type{FixtureId}from './demo-contract.mjs';
export interface DemoFixture{id:FixtureId;label:string;fictional:true;profile:{ageYears:number;sex:string;conditions:string[]};studies:{id:string;title:string;conditions:string[];status?:string;summary:string;criteria:string;sourceUrl:string;minAgeYears:number|null;maxAgeYears:number|null;sex:string}[]}
export const DEMO_FIXTURES:readonly DemoFixture[];
export function getDemoFixture(id:FixtureId):DemoFixture;

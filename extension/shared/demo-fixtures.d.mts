import type{FixtureId}from './demo-contract.mjs';
export interface DemoFixture{id:FixtureId;label:string;fictional:true;profile:{ageYears:number;sex:string;conditions:string[]};studies:{id:string;title:string;conditions:string[];status?:string;summary:string;criteria:string;sourceUrl:string;minAgeYears:number|null;maxAgeYears:number|null;sex:string}[]}
export const DEMO_FIXTURES:readonly DemoFixture[];
export function getDemoFixture(id:FixtureId):DemoFixture;
export const SCORING_LEVELS:readonly {label:string;description:string}[];
export function decisionsPayload(fixture:DemoFixture):Record<string,unknown>;
export function agentPayload(fixture:DemoFixture):Record<string,unknown>;
export function getDemoPreview(id:FixtureId,studyIds?:string[]):{decisionsRequest:Record<string,unknown>;agentsRequest:Record<string,unknown>;toolResults:{public:true;study:DemoFixture["studies"][number]}[]};

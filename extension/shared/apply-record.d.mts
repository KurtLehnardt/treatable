import type {ApplyRecord} from './apply-contract.mjs';
export function normalizeApplyRecord(raw:unknown,fetchedAt:number,maxBytes?:number):ApplyRecord;

export function normalizeStudyBrief(raw:unknown,fetchedAt:number):import('./apply-contract.mjs').PublicStudyBrief;

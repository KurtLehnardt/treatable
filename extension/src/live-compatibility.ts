import type{LiveCatalog,LivePacket}from'../shared/live-analysis-contract.mjs';
import{structuredChecks}from'./structured-checks';
export function compatibilityBuckets(catalog:LiveCatalog,packet:LivePacket){return Object.fromEntries(catalog.studies.map(study=>[study.id,structuredChecks(study,packet).bucket]))}

import type {StudySearchResult} from "../lib/contracts/studyMatch";
/** Stopping optional explanations must preserve every retrieved candidate and stop all rings. */
export function settleStoppedResult(result:StudySearchResult):StudySearchResult{return {...result,matches:result.matches.map(match=>({...match,provisional:false,final:true})),notices:Array.from(new Set([...result.notices,"Explanations stopped. Retrieved studies and any explanations already received are kept."]))};}

export function finishStudyStream(result:StudySearchResult,complete:boolean,hadError:boolean):StudySearchResult{return complete&&!hadError?result:settleStoppedResult(result);}

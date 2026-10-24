/** Deletion-only compatibility migration. Never reads or writes patient values. */
export const STORAGE_KEY='treatable.patient.v1';
export const LEGACY_STORAGE_KEYS=[STORAGE_KEY] as const;
export interface CleanupArea {remove:(key:string)=>Promise<void>}
export async function clearLegacyPatientData(session:CleanupArea|undefined,local:CleanupArea|undefined):Promise<void>{
 if(!session||!local||typeof session.remove!=='function'||typeof local.remove!=='function')throw new Error('Legacy data cleanup is unavailable. Patient entry remains blocked.');
 try{await Promise.all(LEGACY_STORAGE_KEYS.flatMap(key=>[session.remove(key),local.remove(key)]))}catch{throw new Error('Legacy data cleanup did not finish. Retry before entering patient details.')}
}

import type { PatientProfile } from "./contracts/patientProfile";
import { PatientProfileSchema } from "./contracts/patientProfile";
import { safeStorage, writeJSON } from "./localStore";
export const PATIENT_KEY="treatable:patient";
export function savePatient(profile:PatientProfile){writeJSON(PATIENT_KEY,profile);}
export function loadPatient():PatientProfile|null {try {const raw=safeStorage()?.getItem(PATIENT_KEY);if(!raw)return null;const parsed=PatientProfileSchema.safeParse(JSON.parse(raw));return parsed.success?parsed.data:null;}catch{return null;}}
export function clearPatientData(){const store=safeStorage();if(!store)return;for(let i=store.length-1;i>=0;i--){const key=store.key(i);if(key?.startsWith("treatable:"))store.removeItem(key);}}

/**
 * Session-only state of the local model check (Ollama on this device) shared by Settings and the study brief section. The check runs
 * through the study brief's own validated native session, so this store holds only a detector registered by that section and the last
 * validated result. Nothing here is persisted, and the check sends no study, patient or model input to the helper.
 */
import {createContext, useContext, useSyncExternalStore} from 'react';
import type {LocalModelsResult} from '../shared/apply-contract.mjs';
import {failureCodeOf} from './failures';
export type LocalCheck = {status: 'idle'} | {status: 'unavailable'} | {status: 'checking'} | {status: 'ready'; result: LocalModelsResult} | {status: 'failed'; code: string};
export type LocalDetector = () => Promise<LocalModelsResult>;
export class LocalModelsStore {
 private state: LocalCheck = {status: 'idle'};
 private detector?: LocalDetector;
 private ticket = 0;
 private listeners = new Set<() => void>();
 get = (): LocalCheck => this.state;
 subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener)}};
 get hasDetector() {return !!this.detector}
 private set(next: LocalCheck) {this.state = next; for (const listener of [...this.listeners]) listener()}
 /** The study brief section registers its native session here and removes it when that session ends. Returns the unregister function. */
 setDetector(detector: LocalDetector) {
  this.detector = detector;
  if (this.state.status === 'unavailable') this.set({status: 'idle'}); else this.set(this.state);
  return () => {if (this.detector !== detector) return; this.detector = undefined; this.ticket++; if (this.state.status === 'checking') this.set({status: 'idle'})};
 }
 check() {
  const detector = this.detector, ticket = ++this.ticket;
  if (!detector) {this.set({status: 'unavailable'}); return}
  this.set({status: 'checking'});
  detector().then(result => {if (ticket === this.ticket) this.set({status: 'ready', result})}, error => {if (ticket === this.ticket) this.set({status: 'failed', code: failureCodeOf(error)})});
 }
 clear() {this.ticket++; this.set({status: 'idle'})}
}
export const LocalModelsContext = createContext<LocalModelsStore | undefined>(undefined);
const IDLE: LocalCheck = {status: 'idle'};
export function useLocalModels(): {store?: LocalModelsStore; state: LocalCheck} {
 const store = useContext(LocalModelsContext);
 const state = useSyncExternalStore(store?.subscribe ?? (() => () => {}), store?.get ?? (() => IDLE), store?.get ?? (() => IDLE));
 return {store, state};
}

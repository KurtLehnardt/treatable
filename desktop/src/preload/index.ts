import { contextBridge, ipcRenderer } from "electron";
import { IPC, type TreatableApi } from "../shared/ipc";

// Exactly the contract's methods, each a thin ipcRenderer.invoke wrapper.
const api: TreatableApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  setProvider: (provider, model) => ipcRenderer.invoke(IPC.setProvider, provider, model),
  saveKey: (key) => ipcRenderer.invoke(IPC.saveKey, key),
  clearKey: () => ipcRenderer.invoke(IPC.clearKey),
  grantConsent: (kind, accepted) => ipcRenderer.invoke(IPC.grantConsent, kind, accepted),
  revokeConsent: (kind) => ipcRenderer.invoke(IPC.revokeConsent, kind),
  setSettings: (partial) => ipcRenderer.invoke(IPC.setSettings, partial),
  score: (profile) => ipcRenderer.invoke(IPC.score, profile),
  cancelScore: () => ipcRenderer.invoke(IPC.cancelScore),
  loadDemoProfiles: () => ipcRenderer.invoke(IPC.loadDemoProfiles),
  getRememberedProfile: () => ipcRenderer.invoke(IPC.getRememberedProfile),
  clearAll: () => ipcRenderer.invoke(IPC.clearAll),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  checkForUpdate: () => ipcRenderer.invoke(IPC.checkForUpdate),
};

contextBridge.exposeInMainWorld("treatable", api);

import type { TreatableApi } from "../shared/ipc";

declare global {
  interface Window {
    treatable: TreatableApi;
  }
}

export {};

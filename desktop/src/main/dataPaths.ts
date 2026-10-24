import { join } from "node:path";

export interface DataPathOptions {
  isPackaged: boolean;
  /** process.resourcesPath when packaged. */
  resourcesPath?: string;
  /** The built main bundle's directory (out/main), used to find resources/ in development. */
  mainDir: string;
}

/** Directory holding studies.json and us-zip-centroids.json. */
export function dataDir(options: DataPathOptions): string {
  if (options.isPackaged) {
    if (!options.resourcesPath) throw new Error("resourcesPath is required when packaged.");
    return join(options.resourcesPath, "data");
  }
  // In development the built bundle is desktop/out/main, so resources/ is two levels up.
  return join(options.mainDir, "..", "..", "resources", "data");
}

export const studiesPath = (options: DataPathOptions): string => join(dataDir(options), "studies.json");
export const zipsPath = (options: DataPathOptions): string => join(dataDir(options), "us-zip-centroids.json");

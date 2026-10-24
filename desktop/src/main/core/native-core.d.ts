// Type shim for extension/native/core.mjs, which is plain JavaScript.
declare module "*/extension/native/core.mjs" {
  export const MODEL_PATTERN: RegExp;
  export function hasLocalWeights(modelsDir: string, model: string): Promise<boolean>;
  export function localModels(
    tags: unknown,
    showModel: (name: string) => Promise<{ remote_host?: unknown; remote_model?: unknown; capabilities?: unknown }>,
    modelsDir: string,
  ): Promise<Array<{ name: string; size?: number }>>;
}

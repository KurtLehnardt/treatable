import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// One copy of zod for the desktop code and for the imported extension and
// scaffold files, which have no node_modules of their own in this build.
const zodAlias = { zod: resolve(__dirname, "node_modules/zod") };

export default defineConfig({
  main: {
    // zod and react are bundled so the imported extension/scaffold TypeScript
    // and its zod import resolve to the single aliased copy.
    plugins: [externalizeDepsPlugin({ exclude: ["zod"] })],
    resolve: { alias: zodAlias },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts"),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: { alias: zodAlias },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
    plugins: [react()],
  },
});

import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { port: 5173, strictPort: true },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 12000,
    assetsInlineLimit: 0,
  },
  // Pre-bundle the engine: its thousands of modules would otherwise be fetched one by one in dev.
  optimizeDeps: {
    include: ["@babylonjs/core", "@babylonjs/loaders/glTF"],
  },
});

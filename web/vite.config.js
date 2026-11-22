import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" lets the build run from any folder (GitHub Pages project sites, IPFS, a plain file server).
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          genlayer: ["genlayer-js", "viem"],
        },
      },
    },
  },
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: path.join(root, "renderer", "generated"),
    emptyOutDir: true,
    sourcemap: false,
    minify: "esbuild",
    lib: {
      entry: path.join(root, "renderer", "app-shell", "main.tsx"),
      formats: ["es"],
      fileName: () => "app-shell.js",
    },
    rollupOptions: {
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});

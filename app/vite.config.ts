import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In dev the app calls /api on its own origin; Vite forwards to the dev server.
    proxy: { "/api": { target: "http://localhost:7071", changeOrigin: true } },
  },
  build: { outDir: "dist", sourcemap: true },
});

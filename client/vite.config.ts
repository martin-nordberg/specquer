import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: {
    // Fixed port; the documentation dev server owns 5174
    port: 5173,
    strictPort: true,
    // Forward API calls to the Hono server (server/src/index.ts)
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});

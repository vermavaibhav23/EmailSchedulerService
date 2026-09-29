import { defineConfig } from "vite";
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
      "/integrations": "http://localhost:3000",
      "/admin": "http://localhost:3000",
    },
  },
});

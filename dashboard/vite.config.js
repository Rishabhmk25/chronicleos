import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ask": "http://localhost:8000",
      "/reconstruct": "http://localhost:8000",
      "/weekly": "http://localhost:8000",
      "/cluster": "http://localhost:8000",
      "/search": "http://localhost:8000",
      "/sessions": "http://localhost:8000",
      "/status": "http://localhost:8000",
      "/captures": "http://localhost:8000",
      "/capture": "http://localhost:8000",
    },
  },
});

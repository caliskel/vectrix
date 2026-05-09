import { defineConfig } from "vite";

export default defineConfig({
  server: {
    allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".trycloudflare.com"],
  },
});

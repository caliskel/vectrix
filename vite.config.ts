import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/vectrix/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        sandbox: resolve(__dirname, "sandbox.html"),
        rooms: resolve(__dirname, "rooms.html"),
        tutorial: resolve(__dirname, "tutorial.html"),
        intro: resolve(__dirname, "intro.html"),
        epilogue: resolve(__dirname, "epilogue.html"),
        sandboxPhaser: resolve(__dirname, "sandbox-phaser.html"),
      },
    },
  },
  server: {
    allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".trycloudflare.com"],
  },
});

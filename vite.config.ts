import { resolve } from "path";
import { defineConfig } from "vite";
import editorPlugin from "./vite-plugin-editor";

export default defineConfig({
  base: "/vectrix/",
  plugins: [editorPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        sandbox: resolve(__dirname, "sandbox.html"),
        rooms: resolve(__dirname, "rooms.html"),
        tutorial: resolve(__dirname, "tutorial.html"),
        intro: resolve(__dirname, "intro.html"),
        epilogue: resolve(__dirname, "epilogue.html"),
      },
    },
  },
  server: {
    allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".trycloudflare.com"],
  },
});

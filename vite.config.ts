import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    /* 5173 by default, but overridable — another project on this machine also
       answers to "sentinel" and claims 5173, and a hardcoded port turns that
       collision into a dev server that silently serves someone else's app. */
    port: Number(process.env.PORT) || 5173,
  },
});

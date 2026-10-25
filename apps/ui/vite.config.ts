import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const HOST = `http://127.0.0.1:${process.env.PISTA_HOST_PORT ?? 4317}`;

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the same build loads from file:// (Electron), tauri:// and the host.
  base: "./",
  server: {
    port: Number(process.env.PISTA_UI_PORT ?? 5317),
    strictPort: true,
    proxy: { "/ws": { target: HOST, ws: true } },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ isPreview }) => ({
  // Production output contains real HTML files. Unknown URLs must return 404.
  appType: isPreview ? "mpa" : "spa",
  plugins: [react()],
  preview: { headers: { "X-Robots-Tag": "noindex, follow" } },
  build: { target: "es2022" },
}));

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  // Android 7-10 phones may run an old system WebView (Chrome 69+ is supported);
  // iPhone PWA needs Safari 14+.
  build: { target: ["chrome69", "safari14", "firefox78"] },
  worker: { format: "iife" },
});

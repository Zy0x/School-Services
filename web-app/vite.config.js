import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  envDir: "..",
  build: {
    outDir: "../Output/web-app",
    emptyOutDir: true,
  },
  plugins: [react()],
});

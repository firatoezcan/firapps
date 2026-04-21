import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@firapps/foundation": fileURLToPath(
        new URL("../../packages/foundation/src/index.ts", import.meta.url),
      ),
    },
  },
});

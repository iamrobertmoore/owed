import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // Off deliberately. A sourcemap ships `sourcesContent`, which is the whole
    // of `src/` as text, and it is served from the same public root as the app.
    // With this on, a comment that was removed from the source before a commit
    // still went out on the judged URL inside the previous build's map, so a log
    // entry could say "caught before publication" while the map published it.
    // Nothing here needs to be debuggable in production.
    sourcemap: false,
  },
});

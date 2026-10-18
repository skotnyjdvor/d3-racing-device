import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: false,
  },
  server: {
    // Native app projects and installer output are not part of the web app; watching them also
    // locks folders on Windows while electron-builder renames them.
    watch: { ignored: ["**/android/**", "**/ios/**", "**/release/**", "**/desktop/**", "**/resources/**"] },
  },
});

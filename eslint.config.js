import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/", "release/", "android/", "ios/", "desktop/app/web/", "src/domain/track-catalog.generated.js"] },
  js.configs.recommended,
  {
    rules: {
      // Storage, parsing and native calls are often allowed to fail silently: `catch {}` is intended.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  {
    files: ["src/**/*.js", "public/**/*.js", "desktop/app/picker.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["server/**/*.mjs", "scripts/**/*.mjs", "tests/**/*.js", "e2e/**/*.js", "vite.config.js", "playwright.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    // Input sanitizers strip control characters on purpose.
    files: ["server/**/*.mjs"],
    rules: { "no-control-regex": "off" },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
];

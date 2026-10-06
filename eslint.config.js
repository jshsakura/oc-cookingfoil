// Static guard, not a style linter.
//
// Exists because of the v0.8.2 outage: `isLoopbackIp` was used in
// auth-guard.js without its import. `node --check` only parses, so it saw
// nothing; under ESM the call became a runtime ReferenceError on a path every
// request crosses, and the shop returned 500 for everything.
//
// Keep the rule set narrow — this runs in CI and pre-commit, and its job is to
// catch "symbol used but never bound", not to argue about formatting.
import globals from "globals";

const IGNORED = [
  "node_modules/**",
  "test-results/**",
  "playwright-report/**",
  "public/vendor/**",
];

export default [
  { ignores: IGNORED },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      "no-undef": "error",
      // Unused imports are the other half of the same story: they mean the
      // import block and the code below it have drifted apart.
      "no-unused-vars": [
        "warn",
        {
          args: "none",
          caughtErrors: "none", // `catch (_)` is idiomatic here, not a defect
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ["src/views/assets/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-undef": "error",
    },
  },
];

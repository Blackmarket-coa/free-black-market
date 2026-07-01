// Flat ESLint config for the @bmc/*-portal apps and shared packages.
// Named distinctly (not eslint.config.mjs) and passed via --config from the
// `portals:lint` script so it never lints the backend/services trees.
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Catch genuine hook misuse; exhaustive-deps left off to avoid noise.
      "react-hooks/rules-of-hooks": "error",
    },
  },
]

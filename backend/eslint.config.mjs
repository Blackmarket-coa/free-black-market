import eslint from "@eslint/js"
import tseslint from "typescript-eslint"

/**
 * Real ESLint flat config for the backend (audit-debt LR-4).
 *
 * Replaces the former `lint` = `tsc --noEmit` alias with actual linting of
 * `src/**​/*.{ts,tsx}` at `--max-warnings 0`. Mirrors the repo's modern flat-config
 * precedent (`vendor-panel/eslint.config.mjs`: ESLint 9 + the unified `typescript-eslint`
 * package) but enables real correctness rules.
 *
 * Pragmatic rule tier: high-volume / low-value rules are parked (see overrides) so this
 * stays a bounded config task rather than a large refactor. `tsc --noEmit` still runs as
 * the separate `typecheck` script.
 */
export default tseslint.config(
  {
    ignores: [
      ".medusa/**",
      ".cache/**",
      ".yalc/**",
      "dist/**",
      "build/**",
      "node_modules/**",
      "restaurant-marketplace/**",
      "integration-tests/**",
      // Lint TypeScript only; skip JS/config/build files.
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      // Parked as tracked debt: backend src has ~1,215 `any` across ~401 files. Typing
      // them away is a separate workstream (see docs/AUDIT_DEBT.md), not LR-4.
      "@typescript-eslint/no-explicit-any": "off",
      // Dynamic Medusa/Mercur framework module resolution uses require() intentionally.
      "@typescript-eslint/no-require-imports": "off",
      // Parked (tracked debt): low-value style rule with 13 control-flow sites
      // (try { … } catch (e) { throw e }); not worth reworking error handling here.
      "no-useless-catch": "off",
      // Repo convention (mirrors admin-panel): underscore prefix = intentionally unused.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          // Idiomatic for the `const { omit, ...rest } = x` property-omit pattern.
          ignoreRestSiblings: true,
        },
      ],
    },
  }
)

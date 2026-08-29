#!/usr/bin/env node
// Shared environment validator. Used by:
//   - backend/medusa-config.ts (production startup guard)
//   - storefront/instrumentation.ts (production startup guard)
//   - .github/workflows/ci.yml (lint-time check that no banned literal slips into a real env)
//
// Run as a CLI:
//   node scripts/assert-env.mjs --app=backend
//   node scripts/assert-env.mjs --app=storefront
//
// Or import as a module:
//   import { assertProductionEnv } from "../scripts/assert-env.mjs"
//   assertProductionEnv("backend", process.env)

const BANNED_LITERALS = new Set([
  "supersecret",
  "changeme",
  "change-me",
  "change_me",
  "dev-only-secret-change-in-production-32chars",
  "test",
  "secret",
  "password",
  // docker-compose.yml dev fallback for MEDUSA_ADMIN_PASSWORD (14 chars, would
  // otherwise pass). Keep in sync with backend/medusa-config.ts.
  "localadmin1234",
])

const MIN_SECRET_LENGTH = 32

// Conditional rules — applied only when a gating env var matches a value.
// Used for opt-in integrations whose secrets only need validation when on.
const CONDITIONAL_RULES = {
  backend: [
    {
      when: { key: "FBM_BLACKOUT_INTEGRATION", equals: "1" },
      rules: [
        { key: "BLACKOUT_CLIENT_ID", required: true },
        { key: "BLACKOUT_CLIENT_SECRET", required: true, minLength: MIN_SECRET_LENGTH, banPrefixes: ["CHANGE_ME"] },
      ],
    },
    {
      when: { key: "FBM_BLACKSTAR_INTEGRATION", equals: "1" },
      rules: [
        { key: "FBM_BLACKSTAR_API_KEY", required: true, minLength: MIN_SECRET_LENGTH, banPrefixes: ["CHANGE_ME"] },
      ],
    },
    {
      // Matrix/Synapse (Blackout) chat — only validated when enabled by
      // setting MATRIX_HOMESERVER_URL.
      when: { key: "MATRIX_HOMESERVER_URL", present: true },
      rules: [
        { key: "MATRIX_SERVER_NAME", required: true, banPrefixes: ["CHANGE_ME"] },
        { key: "MATRIX_ADMIN_TOKEN", required: true, banPrefixes: ["CHANGE_ME"] },
      ],
    },
    {
      // Matrix OIDC login via MAS (W2, docs/contracts/mas-identity-consumer.md)
      // — validated only when the issuer is set.
      when: { key: "MAS_OIDC_ISSUER", present: true },
      rules: [
        { key: "MAS_OIDC_CLIENT_ID", required: true, banPrefixes: ["CHANGE_ME"] },
        { key: "MAS_OIDC_CLIENT_SECRET", required: true, minLength: MIN_SECRET_LENGTH, banPrefixes: ["CHANGE_ME"] },
      ],
    },
    {
      // Extension bundle signing (W3, docs/contracts/extension-manifest.md) —
      // an opt-in PAIR: half a pair in production is a misconfiguration, so
      // each side requires the other.
      when: { key: "MARKETPLACE_SIGNING_PRIVATE_KEY_PEM", present: true },
      rules: [
        { key: "MARKETPLACE_SIGNING_KEY_ID", required: true, banPrefixes: ["CHANGE_ME"] },
      ],
    },
    {
      when: { key: "MARKETPLACE_SIGNING_KEY_ID", present: true },
      rules: [
        { key: "MARKETPLACE_SIGNING_PRIVATE_KEY_PEM", required: true, minLength: 64, banPrefixes: ["CHANGE_ME"] },
      ],
    },
  ],
}

const RULES = {
  backend: [
    { key: "JWT_SECRET", required: true, minLength: MIN_SECRET_LENGTH, banPrefixes: ["CHANGE_ME", "local-dev-"] },
    { key: "COOKIE_SECRET", required: true, minLength: MIN_SECRET_LENGTH, banPrefixes: ["CHANGE_ME", "local-dev-"] },
    { key: "DATABASE_URL", required: true, pattern: /^postgres(ql)?:\/\// },
    { key: "MEDUSA_ADMIN_PASSWORD", required: true, minLength: 12, banPrefixes: ["CHANGE_ME"] },
  ],
  storefront: [
    { key: "REVALIDATE_SECRET", required: true, minLength: MIN_SECRET_LENGTH, banPrefixes: ["CHANGE_ME", "local-dev-"] },
    { key: "NEXT_PUBLIC_STRIPE_KEY", required: true, pattern: /^pk_(live|test)_/ },
    { key: "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", required: true },
  ],
}

function isBanned(value) {
  if (!value) return false
  return BANNED_LITERALS.has(String(value).trim().toLowerCase())
}

function startsWithBannedPrefix(value, prefixes) {
  if (!value || !prefixes) return false
  return prefixes.some((p) => String(value).startsWith(p))
}

export function assertProductionEnv(app, env = process.env) {
  if (env.NODE_ENV !== "production") return { ok: true, errors: [] }

  const baseRules = RULES[app]
  if (!baseRules) {
    throw new Error(`assertProductionEnv: unknown app "${app}"`)
  }

  // Layer in any conditional rules whose gate matches.
  const conditional = CONDITIONAL_RULES[app] || []
  const activeConditional = conditional
    .filter(({ when }) =>
      when.present
        ? String(env[when.key] ?? "") !== ""
        : String(env[when.key] ?? "") === String(when.equals)
    )
    .flatMap(({ rules }) => rules)
  const rules = [...baseRules, ...activeConditional]

  const errors = []

  for (const rule of rules) {
    const raw = env[rule.key]
    const value = raw === undefined ? "" : String(raw)

    if (rule.required && value.length === 0) {
      errors.push(`${rule.key} is required in production`)
      continue
    }

    if (isBanned(value)) {
      errors.push(`${rule.key} matches a banned placeholder literal; replace it with a real secret`)
      continue
    }

    if (startsWithBannedPrefix(value, rule.banPrefixes)) {
      errors.push(`${rule.key} starts with a banned placeholder prefix; replace it with a real secret`)
      continue
    }

    if (rule.minLength && value.length < rule.minLength) {
      errors.push(`${rule.key} must be at least ${rule.minLength} characters (got ${value.length})`)
      continue
    }

    if (rule.pattern && !rule.pattern.test(value)) {
      errors.push(`${rule.key} does not match expected format (${rule.pattern})`)
      continue
    }
  }

  return { ok: errors.length === 0, errors }
}

function parseArgs(argv) {
  const args = {}
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/)
    if (m) args[m[1]] = m[2]
  }
  return args
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app } = parseArgs(process.argv)
  if (!app) {
    console.error("usage: node scripts/assert-env.mjs --app=<backend|storefront>")
    process.exit(2)
  }
  const { ok, errors } = assertProductionEnv(app, process.env)
  if (!ok) {
    console.error(`[assert-env] production env check failed for ${app}:`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  console.log(`[assert-env] ${app} production env OK`)
}

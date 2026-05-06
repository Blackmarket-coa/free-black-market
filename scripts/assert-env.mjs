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
])

const MIN_SECRET_LENGTH = 32

const RULES = {
  backend: [
    { key: "JWT_SECRET", required: true, minLength: MIN_SECRET_LENGTH, banPrefixes: ["CHANGE_ME"] },
    { key: "COOKIE_SECRET", required: true, minLength: MIN_SECRET_LENGTH, banPrefixes: ["CHANGE_ME"] },
    { key: "DATABASE_URL", required: true, pattern: /^postgres(ql)?:\/\// },
    { key: "MEDUSA_ADMIN_PASSWORD", required: true, minLength: 12, banPrefixes: ["CHANGE_ME"] },
  ],
  storefront: [
    { key: "REVALIDATE_SECRET", required: true, minLength: MIN_SECRET_LENGTH, banPrefixes: ["CHANGE_ME"] },
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

  const rules = RULES[app]
  if (!rules) {
    throw new Error(`assertProductionEnv: unknown app "${app}"`)
  }

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

// Production fail-closed env validator for the storefront.
// Mirrors scripts/assert-env.mjs and refuses to start when banned
// placeholders or under-length secrets are detected.

const BANNED_LITERALS = new Set<string>([
  "supersecret",
  "changeme",
  "change-me",
  "change_me",
  "dev-only-secret-change-in-production-32chars",
  "test",
  "secret",
  "password",
])
const BANNED_PREFIXES = ["CHANGE_ME"]
const MIN_SECRET_LENGTH = 32
const STRIPE_KEY_PATTERN = /^pk_(live|test)_/

const isBanned = (value: string): boolean => {
  const lower = value.trim().toLowerCase()
  if (BANNED_LITERALS.has(lower)) return true
  return BANNED_PREFIXES.some((p) => value.startsWith(p))
}

type Rule = {
  key: string
  required: boolean
  minLength?: number
  pattern?: RegExp
}

const RULES: Rule[] = [
  { key: "REVALIDATE_SECRET", required: true, minLength: MIN_SECRET_LENGTH },
  { key: "NEXT_PUBLIC_STRIPE_KEY", required: true, pattern: STRIPE_KEY_PATTERN },
  { key: "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", required: true },
]

export function assertProductionEnv(env: NodeJS.ProcessEnv = process.env): {
  ok: boolean
  errors: string[]
} {
  if (env.NODE_ENV !== "production") return { ok: true, errors: [] }

  const errors: string[] = []
  for (const rule of RULES) {
    const value = (env[rule.key] ?? "").toString()

    if (rule.required && value.length === 0) {
      errors.push(`${rule.key} is required in production`)
      continue
    }
    if (isBanned(value)) {
      errors.push(`${rule.key} matches a banned placeholder literal`)
      continue
    }
    if (rule.minLength && value.length < rule.minLength) {
      errors.push(`${rule.key} must be at least ${rule.minLength} characters (got ${value.length})`)
      continue
    }
    if (rule.pattern && !rule.pattern.test(value)) {
      errors.push(`${rule.key} does not match expected format ${rule.pattern}`)
      continue
    }
  }

  return { ok: errors.length === 0, errors }
}

export function assertProductionEnvOrThrow(env: NodeJS.ProcessEnv = process.env): void {
  const { ok, errors } = assertProductionEnv(env)
  if (!ok) {
    const msg = ["[storefront] production env check failed:", ...errors.map((e) => `  - ${e}`)].join("\n")
    throw new Error(msg)
  }
}

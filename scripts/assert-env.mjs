#!/usr/bin/env node
// Pre-deploy environment check. Run it from a repo checkout, against the env
// file a deploy is about to use, and nothing else:
//   env -i PATH="$PATH" node --env-file=.env.production scripts/assert-env.mjs --app=backend
// `env -i` matters: Node lets a variable already in the shell win over the
// file, so a shell with NODE_ENV=development (or its own JWT_SECRET) would
// otherwise be what gets checked. The file must itself say
// NODE_ENV=production, as .env.production.example does: the stack runs under
// that value, and docker-compose.yml falls back to development without it.
// Against a running stack, copy it into the container and run it there
// (docs/runbooks/FBM_MIGRATION_TO_PRIMARY_SERVER.md step 7).
//
// Run as a CLI, it refuses (exit 2, "nothing was checked") when NODE_ENV is not
// production, instead of reporting OK about rules it skipped. It exits 1 when
// a value fails. `pnpm --dir backend assert-env` checks the shell's own env,
// so it too refuses unless that shell has NODE_ENV=production.
//
// What it is NOT (checked 2026-11-15; SD-78):
//   - Not a boot guard. Nothing imports or runs it at startup or in CI.
//     medusa-config.ts copies some of its base rules, and so does
//     storefront/src/lib/config/assertEnv.ts, which does not run either (its
//     caller, storefront/instrumentation.ts, is outside src/ where Next looks).
//     The conditional rules below are enforced at boot only where
//     backend/src/shared/config.ts repeats them (the Blackstar ones do).
//   - Not in the backend image. The image is built with context backend/, so
//     /app/scripts is backend/scripts and this file is absent:
//     `docker compose exec backend node scripts/assert-env.mjs` fails with
//     MODULE_NOT_FOUND.
//
// Or import as a module:
//   import { assertProductionEnv } from "../scripts/assert-env.mjs"
//   assertProductionEnv("backend", process.env)

import { realpathSync } from "node:fs"
import { pathToFileURL } from "node:url"

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

// The same check as isHttpsBaseUrl in backend/src/shared/config.ts (see the
// reasons there): https, parses with a host, and no whitespace, query or
// fragment, because marketplace-webhooks appends a path to it as a string.
function isHttpsBaseUrl(value) {
  if (/[\s?#]/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname !== ""
  } catch {
    return false
  }
}

// Shared by the three blocks that switch the Blackstar outbound channel on
// (the flag, or either value set); one object per rule so a key checked by
// more than one active block reports once.
const BLACKSTAR_OUTBOUND_RULES = [
  // node.operator.approved carries a per-node secret in its body, and a value
  // that does not parse fails every delivery.
  {
    key: "BLACKSTAR_API_BASE",
    required: true,
    banPrefixes: ["CHANGE_ME"],
    check: { test: isHttpsBaseUrl, rule: "must be an https:// URL with a host, and no whitespace, query or fragment" },
  },
  { key: "BLACKSTAR_WEBHOOK_SECRET", required: true, minLength: MIN_SECRET_LENGTH, banPrefixes: ["CHANGE_ME"] },
]

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
      // Blackout spatial consumer (W5) — enabling the flag requires the
      // service token and the base URL it authenticates against.
      when: { key: "FBM_BLACKOUT_SPATIAL", equals: "1" },
      rules: [
        { key: "BLACKOUT_API_BASE", required: true, banPrefixes: ["CHANGE_ME"] },
        { key: "BLACKOUT_SPATIAL_TOKEN", required: true, minLength: MIN_SECRET_LENGTH, banPrefixes: ["CHANGE_ME"] },
      ],
    },
    {
      // Blackstar parcel bridge. The rule used to require FBM_BLACKSTAR_API_KEY,
      // which no code reads (it belonged to the retired static-key
      // /v1/integrations/blackstar/shipments route), so it passed a deploy
      // that set it and nothing the bridge actually needs. What the code reads:
      //   - outbound (FBM -> Blackstar), marketplace-webhooks
      //     blackstarEmitConfig(): BLACKSTAR_WEBHOOK_SECRET signs,
      //     BLACKSTAR_API_BASE is the destination; either missing and nothing
      //     is sent.
      //   - inbound (Blackstar -> FBM), /v1/integrations/blackstar/events:
      //     BLACKSTAR_OUTBOUND_SECRET verifies, unless BLACKSTAR_REQUIRE_KEY_ID=1
      //     moves verification to per-partner credentials (the `unless`
      //     block below).
      // The outbound channel does not read the flag: either value set means
      // it is being configured, so both are checked (the two presence blocks
      // below), and the flag forces them too. backend/src/shared/config.ts
      // repeats these rules at boot; config-blackstar-boot.unit.spec.ts fails
      // when the two disagree.
      when: { key: "FBM_BLACKSTAR_INTEGRATION", equals: "1" },
      rules: BLACKSTAR_OUTBOUND_RULES,
    },
    {
      when: { key: "BLACKSTAR_API_BASE", present: true },
      rules: BLACKSTAR_OUTBOUND_RULES,
    },
    {
      when: { key: "BLACKSTAR_WEBHOOK_SECRET", present: true },
      rules: BLACKSTAR_OUTBOUND_RULES,
    },
    {
      when: { key: "FBM_BLACKSTAR_INTEGRATION", equals: "1" },
      unless: { key: "BLACKSTAR_REQUIRE_KEY_ID", equals: "1" },
      rules: [
        { key: "BLACKSTAR_OUTBOUND_SECRET", required: true, minLength: MIN_SECRET_LENGTH, banPrefixes: ["CHANGE_ME"] },
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
    {
      // Retired verification keys (W3-2) are meaningless without an active
      // signing key: the key endpoints 503 on the active pair before they
      // ever reach the retired list, so retired keys alone publish nothing
      // while looking configured.
      when: { key: "MARKETPLACE_SIGNING_RETIRED_KEYS", present: true },
      rules: [
        { key: "MARKETPLACE_SIGNING_KEY_ID", required: true, banPrefixes: ["CHANGE_ME"] },
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
    // LEG-8: without a real salt the attribution IP hash is either skipped
    // (helper stores null) or, with a placeholder, salted with a public string.
    { key: "CREATOR_ATTRIBUTION_IP_SALT", required: true, minLength: MIN_SECRET_LENGTH, banPrefixes: ["CHANGE_ME", "local-dev-"] },
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

  // Layer in any conditional rules whose gate matches (and whose optional
  // `unless` gate does not).
  const gateMatches = (gate) =>
    gate.present
      ? String(env[gate.key] ?? "") !== ""
      : String(env[gate.key] ?? "") === String(gate.equals)
  const conditional = CONDITIONAL_RULES[app] || []
  const activeConditional = conditional
    .filter(({ when, unless }) => gateMatches(when) && !(unless && gateMatches(unless)))
    .flatMap(({ rules }) => rules)
  const rules = [...new Set([...baseRules, ...activeConditional])]

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

    if (rule.check && !rule.check.test(value)) {
      errors.push(`${rule.key} ${rule.check.rule}`)
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

// Whether this file is the entry point. It used to compare import.meta.url
// with `file://${process.argv[1]}`, which never matches when the path has a
// character a URL escapes (a space) or the script is run through a symlink
// (Node loads the real path): the check then did nothing and exited 0.
function invokedAsCli() {
  if (!process.argv[1]) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
}

if (invokedAsCli()) {
  const { app } = parseArgs(process.argv)
  if (!app) {
    console.error("usage: node scripts/assert-env.mjs --app=<backend|storefront>")
    process.exit(2)
  }
  // assertProductionEnv() passes anything outside production, which is right
  // for an importer but not for someone asking this CLI about a production
  // env: with `node --env-file`, a NODE_ENV already in the shell beats the
  // file's, and the check used to print "production env OK" having checked
  // nothing. Refuse instead.
  if (process.env.NODE_ENV !== "production") {
    const seen = process.env.NODE_ENV === undefined ? "unset" : JSON.stringify(process.env.NODE_ENV)
    console.error(`[assert-env] NODE_ENV is ${seen}, not production: nothing was checked.`)
    console.error(
      `  For an env file: env -i PATH="$PATH" node --env-file=<file> scripts/assert-env.mjs --app=${app}` +
        " (the file must set NODE_ENV=production; the stack runs under it)."
    )
    console.error(
      "  Inside a running container: it is not running in production, so its boot guards are off too."
    )
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

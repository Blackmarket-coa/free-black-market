import { readFileSync } from "fs"
import { join } from "path"
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  VENDOR_FEATURE_KEYS,
  VENDOR_PLAN_CATALOG,
} from "../modules/vendor-plan/catalog"
import { VENDOR_ADDON_CATALOG } from "../modules/vendor-plan/addons"
import {
  TIER_ORDER,
  vendorFeatureKeysForTier,
} from "../modules/tenancy/gates"

/**
 * Read-only audit of what gates what.
 *
 * Prints every gated route matcher against the plans, add-ons and tenancy tiers
 * that grant its feature key, so the route table and the commercial catalog can
 * be diffed by eye at review time.
 *
 * The complement to `api/middlewares/__tests__/plan-gate-coverage.unit.spec.ts`,
 * not a duplicate of it. That spec fails a build when an invariant breaks; this
 * answers the question a human actually asks before changing pricing — *"if I
 * move this key, what stops working, and for whom?"* — which no pass/fail
 * assertion can express.
 *
 * Touches no database and mutates nothing: it reads `api/middlewares.ts` off
 * disk and the catalogs out of code, which is also why it stays correct when
 * run against an environment whose `vendor_plan` rows have drifted from the
 * catalog they were seeded from.
 *
 * Run:
 *   pnpm medusa exec ./src/scripts/audit-vendor-plan-coverage.ts
 */

type GatedRoute = {
  matcher: string
  featureKey: string
  /** True when a platform kill switch is evaluated before the paywall. */
  flagGated: boolean
}

const MIDDLEWARES_PATH = join(__dirname, "..", "api", "middlewares.ts")

/**
 * Pull the gated route registrations out of `api/middlewares.ts`.
 *
 * Parsed from source rather than imported, because importing that module
 * executes every middleware factory and drags most of the container in with
 * it — for a script whose entire contract is that it changes nothing, reading
 * the text is both safer and more honest about what it knows.
 */
function readGatedRoutes(source: string): GatedRoute[] {
  const routes: GatedRoute[] = []

  // Registration blocks are `{ matcher: "…", middlewares: [ … ] }` objects.
  // Splitting on the opening brace of each is the same shape the coverage spec
  // uses, so the two cannot disagree about what counts as one registration.
  for (const block of source.split(/\n\s*\{\s*\n/)) {
    const gate = block.match(/requirePlanFeature\(\s*"([^"]+)"/)
    if (!gate) continue

    const matcher = block.match(/matcher:\s*"([^"]+)"/)
    routes.push({
      matcher: matcher?.[1] ?? "(unknown matcher)",
      featureKey: gate[1],
      flagGated: block.includes("requireFeatureFlagMiddleware("),
    })
  }

  return routes
}

/** Plan codes granting a key, cheapest first — the catalog's own order. */
function plansGranting(key: string): string[] {
  return VENDOR_PLAN_CATALOG.filter((p) =>
    (p.feature_keys as readonly string[]).includes(key)
  ).map((p) => p.code)
}

/** Add-on codes granting a key. The buy-one-feature path. */
function addonsGranting(key: string): string[] {
  return VENDOR_ADDON_CATALOG.filter((a) =>
    (a.feature_keys as readonly string[]).includes(key)
  ).map((a) => a.code)
}

/** Tenancy tiers whose floor grants a key. The enterprise path. */
function tiersGranting(key: string): string[] {
  return TIER_ORDER.filter((tier) =>
    (vendorFeatureKeysForTier(tier) as readonly string[]).includes(key)
  )
}

const list = (values: string[]) => (values.length ? values.join(", ") : "—")

export default async function auditVendorPlanCoverage({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const routes = readGatedRoutes(readFileSync(MIDDLEWARES_PATH, "utf8"))
  const lines: string[] = []

  lines.push("")
  lines.push("Gated routes")
  lines.push("─".repeat(78))

  if (!routes.length) {
    // Almost certainly a parse failure rather than a real absence — the gates
    // exist. Say so, instead of printing an empty table that reads as "nothing
    // is gated", which is the most misleading thing this script could output.
    lines.push(
      "  No gated routes found. Either every gate was removed, or the parse in"
    )
    lines.push(
      "  this script no longer matches how middlewares.ts registers them."
    )
  }

  for (const route of routes.sort((a, b) => a.matcher.localeCompare(b.matcher))) {
    const plans = plansGranting(route.featureKey)
    const addons = addonsGranting(route.featureKey)
    const tiers = tiersGranting(route.featureKey)

    lines.push(`  ${route.matcher}`)
    lines.push(`    key    ${route.featureKey}`)
    lines.push(`    plans  ${list(plans)}`)
    lines.push(`    addons ${list(addons)}`)
    lines.push(`    tiers  ${list(tiers)}`)

    // A gate no plan, add-on or tier grants is closed for everyone — the route
    // is effectively deleted, and nobody can buy their way in.
    if (!plans.length && !addons.length && !tiers.length) {
      lines.push("    ⚠  UNREACHABLE — nothing grants this key")
    }
    // A paywall in front of a kill switch offers to sell something the
    // platform may have switched off.
    if (!route.flagGated) {
      lines.push("    ·  no feature-flag gate (paywall only)")
    }
    lines.push("")
  }

  const gatedKeys = new Set(routes.map((r) => r.featureKey))
  const ungated = VENDOR_FEATURE_KEYS.filter((k) => !gatedKeys.has(k))

  lines.push("Catalog keys with no gate")
  lines.push("─".repeat(78))
  if (ungated.length) {
    // Being sold but not enforced: a vendor without the key reaches the route
    // anyway, so the plan difference is invisible to the person paying for it.
    for (const key of ungated) {
      lines.push(`  ⚠  ${key} — sold by [${list(plansGranting(key))}], enforced nowhere`)
    }
  } else {
    lines.push("  none — every catalog key is enforced by at least one route")
  }
  lines.push("")

  lines.push("What each plan opens")
  lines.push("─".repeat(78))
  for (const plan of VENDOR_PLAN_CATALOG) {
    const matchers = routes
      .filter((r) => (plan.feature_keys as readonly string[]).includes(r.featureKey))
      .map((r) => r.matcher)
    lines.push(
      `  ${plan.code.padEnd(9)} ${String(plan.feature_keys.length).padStart(2)} keys → ${
        matchers.length
      } routes`
    )
    if (matchers.length) lines.push(`             ${[...new Set(matchers)].join(", ")}`)
  }
  lines.push("")

  lines.push("What each tenancy tier floors")
  lines.push("─".repeat(78))
  for (const tier of TIER_ORDER) {
    const keys = vendorFeatureKeysForTier(tier)
    lines.push(`  ${tier.padEnd(18)} ${list([...keys])}`)
  }
  lines.push("")

  const unreachable = routes.filter(
    (r) =>
      !plansGranting(r.featureKey).length &&
      !addonsGranting(r.featureKey).length &&
      !tiersGranting(r.featureKey).length
  )

  lines.push(
    `Summary: ${routes.length} gated routes, ${VENDOR_FEATURE_KEYS.length} catalog keys, ` +
      `${ungated.length} unenforced, ${unreachable.length} unreachable.`
  )

  logger.info(lines.join("\n"))
}

// Exported for the unit spec — parsing is the part that can silently break, and
// it should be assertable without running `medusa exec`.
export { readGatedRoutes, plansGranting, addonsGranting, tiersGranting }
export type { GatedRoute }

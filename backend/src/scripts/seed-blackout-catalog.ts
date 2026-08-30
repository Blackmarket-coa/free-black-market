import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { MARKETPLACE_LISTING_MODULE } from "../modules/marketplace-listing"
import { CreatorListingStatus } from "../modules/marketplace-listing/models/creator-listing"

/**
 * Seed the first-party Blackout monetization catalog: the individual items and
 * subscription tiers that should surface in Blackout's marketplace once the
 * commerce integration is enabled. Idempotent — upserts by (seller_id, slug).
 *
 * These are PUBLISHED `creator_listing` rows carrying the Blackout catalog
 * columns (category / price_cents / currency / entitlement_kind / feature_keys /
 * media_urls / tags), so `GET /v1/integrations/blackout/commerce/catalog/listings`
 * returns them. `feature_keys` bridges each item/tier to the Blackout
 * `features.*` entitlement system.
 *
 * Run:
 *   pnpm medusa exec ./src/scripts/seed-blackout-catalog.ts
 */

const SELLER_ID = "blackout-first-party"

interface CandidateListing {
  slug: string
  title: string
  description: string
  category: string
  price_cents: number
  entitlement_kind: string
  feature_keys: string[]
  tags: string[]
  /** For subscription tiers: the consumer tier this listing grants. */
  tier?: "signal" | "coalition" | "sovereign"
  /** Recurrence shape (W1b checkout bridge); subscription category only. */
  interval?: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly"
  period_days?: number
  /**
   * Publication state. Defaults to PUBLISHED. The Canopy plan placeholders
   * ship DRAFT with price 0 — publishing them WITH real prices is an operator
   * go-live step (docs/MONETIZATION_GO_LIVE.md), not a seed side effect.
   */
  status?: CreatorListingStatus
  /** Extra metadata merged over the tier stamp (e.g. canopy_plan_code). */
  extra_metadata?: Record<string, unknown>
}

/**
 * Individual items (one-off purchase → single feature or artifact grant) plus
 * the three package subscriptions (tier → feature bundle). Feature keys mirror
 * the per-family tier tables in `@blackout/protocol`; the tier bundles list the
 * headline advanced features each rung unlocks.
 */
export const CANDIDATES: CandidateListing[] = [
  // ---- Individual privacy tools ----
  {
    slug: "burner-pro",
    title: "Burner Pro",
    description: "Disposable, compartmentalized burner identities on demand.",
    category: "security-tool",
    price_cents: 399,
    entitlement_kind: "privacy_tool",
    feature_keys: ["features.persona.rotation"],
    tags: ["privacy", "identity"],
  },
  {
    slug: "ephemeral-pro",
    title: "Ephemeral Pro",
    description: "Advanced disappearing-message controls and timers.",
    category: "security-tool",
    price_cents: 299,
    entitlement_kind: "privacy_tool",
    feature_keys: ["features.deaddrop.ephemeral"],
    tags: ["privacy", "messaging"],
  },
  {
    slug: "metadata-scrubber",
    title: "Metadata Scrubber",
    description: "Strip EXIF and sanitize links before they ever leave your device.",
    category: "security-tool",
    price_cents: 0,
    entitlement_kind: "privacy_tool",
    feature_keys: ["features.hardening.imagePerturbation"],
    tags: ["privacy", "metadata"],
  },
  {
    slug: "stego-advanced",
    title: "Stego Advanced",
    description: "Advanced steganographic embedding and extraction toolkit.",
    category: "stego-software",
    price_cents: 599,
    entitlement_kind: "privacy_tool",
    feature_keys: ["features.stego.advanced"],
    tags: ["privacy", "steganography"],
  },
  // ---- Cosmetics / assets / content ----
  {
    slug: "aurora-avatar-ring",
    title: "Aurora Avatar Ring",
    description: "An animated aurora ring cosmetic for your profile avatar.",
    category: "profile-cosmetic",
    price_cents: 299,
    entitlement_kind: "profile_cosmetic",
    feature_keys: [],
    tags: ["cosmetic", "profile"],
  },
  {
    slug: "cat-sticker-pack",
    title: "Cat Sticker Pack",
    description: "A pack of expressive cat stickers for chats.",
    category: "emoji-sticker",
    price_cents: 199,
    entitlement_kind: "emoji_pack",
    feature_keys: [],
    tags: ["stickers", "fun"],
  },
  {
    slug: "neon-stream-overlay",
    title: "Neon Stream Overlay Pack",
    description: "A neon overlay + alert pack for your live streams.",
    category: "creator-asset",
    price_cents: 499,
    entitlement_kind: "stream_asset",
    feature_keys: [],
    tags: ["streaming", "overlay"],
  },
  {
    slug: "study-hall-template",
    title: "Study Hall Community Template",
    description: "A ready-made community template for study groups.",
    category: "community-template",
    price_cents: 0,
    entitlement_kind: "community_template",
    feature_keys: [],
    tags: ["template", "community"],
  },
  {
    slug: "study-mentor-persona",
    title: "Study Mentor AI Persona",
    description: "An AI mentor persona tuned to help you learn.",
    category: "ai-automation",
    price_cents: 199,
    entitlement_kind: "plugin_flag",
    feature_keys: [],
    tags: ["ai", "persona"],
  },
  {
    slug: "welcome-bot",
    title: "Welcome Bot",
    description: "An automation recipe that greets new members.",
    category: "ai-automation",
    price_cents: 99,
    entitlement_kind: "plugin_flag",
    feature_keys: [],
    tags: ["automation", "community"],
  },

  // ---- Package subscriptions (tier → feature bundle) ----
  {
    slug: "signal-tier",
    title: "Signal",
    description:
      "Advanced per-person privacy: anonymized transport, decoy traffic, persona roster, and hardening.",
    category: "subscription",
    price_cents: 500,
    entitlement_kind: "subscription_tier",
    tier: "signal",
    interval: "monthly",
    period_days: 30,
    feature_keys: [
      "features.hardening.torTransport",
      "features.hardening.decoyTraffic",
      "features.hardening.imagePerturbation",
      "features.persona.rotation",
      "features.persona.compartments",
    ],
    tags: ["subscription", "tier", "signal"],
  },
  {
    slug: "coalition-tier",
    title: "Coalition",
    description:
      "Everything in Signal plus shared governance, org transparency exports, and coalition tooling.",
    category: "subscription",
    price_cents: 1500,
    entitlement_kind: "subscription_tier",
    tier: "coalition",
    interval: "monthly",
    period_days: 30,
    feature_keys: [
      "features.hardening.torTransport",
      "features.persona.compartments",
      "features.transparency.auditExport",
    ],
    tags: ["subscription", "tier", "coalition"],
  },
  {
    slug: "sovereign-tier",
    title: "Sovereign",
    description:
      "Everything in Coalition plus self-hosting, mesh transport, federation policy, and active defense.",
    category: "subscription",
    price_cents: 3000,
    entitlement_kind: "subscription_tier",
    tier: "sovereign",
    interval: "monthly",
    period_days: 30,
    feature_keys: [
      "features.transparency.auditExport",
      "features.mesh.topology",
      "features.activedefense.canary",
    ],
    tags: ["subscription", "tier", "sovereign"],
  },

  // ---- Canopy platform plans (W1b placeholders — DRAFT, price 0) ----
  // Canopy pricing never existed anywhere (the Stripe Prices were never
  // created), so these are deliberately unpriced and unpublished: the
  // delegation path from Blackout resolves plan → listing by
  // metadata.canopy_plan_code, and go-live means an operator sets real
  // price_cents and publishes (see docs/MONETIZATION_GO_LIVE.md). Feature
  // gating for Canopy stays on Blackout's side (routes/entitlements.ts);
  // these listings carry no feature_keys.
  {
    slug: "canopy-sprout-monthly",
    title: "Canopy Sprout (Monthly)",
    description: "Canopy platform plan: Sprout, billed monthly.",
    category: "subscription",
    price_cents: 0,
    entitlement_kind: "subscription_tier",
    interval: "monthly",
    period_days: 30,
    feature_keys: [],
    tags: ["subscription", "canopy", "sprout"],
    status: CreatorListingStatus.DRAFT,
    extra_metadata: { canopy_plan_code: "canopy_sprout_monthly", canopy_plan: "sprout" },
  },
  {
    slug: "canopy-sprout-annual",
    title: "Canopy Sprout (Annual)",
    description: "Canopy platform plan: Sprout, billed yearly.",
    category: "subscription",
    price_cents: 0,
    entitlement_kind: "subscription_tier",
    interval: "yearly",
    period_days: 365,
    feature_keys: [],
    tags: ["subscription", "canopy", "sprout"],
    status: CreatorListingStatus.DRAFT,
    extra_metadata: { canopy_plan_code: "canopy_sprout_annual", canopy_plan: "sprout" },
  },
  {
    slug: "canopy-pro-monthly",
    title: "Canopy Pro (Monthly)",
    description: "Canopy platform plan: Canopy Pro, billed monthly.",
    category: "subscription",
    price_cents: 0,
    entitlement_kind: "subscription_tier",
    interval: "monthly",
    period_days: 30,
    feature_keys: [],
    tags: ["subscription", "canopy", "canopy_pro"],
    status: CreatorListingStatus.DRAFT,
    extra_metadata: { canopy_plan_code: "canopy_pro_monthly", canopy_plan: "canopy_pro" },
  },
  {
    slug: "canopy-pro-annual",
    title: "Canopy Pro (Annual)",
    description: "Canopy platform plan: Canopy Pro, billed yearly.",
    category: "subscription",
    price_cents: 0,
    entitlement_kind: "subscription_tier",
    interval: "yearly",
    period_days: 365,
    feature_keys: [],
    tags: ["subscription", "canopy", "canopy_pro"],
    status: CreatorListingStatus.DRAFT,
    extra_metadata: { canopy_plan_code: "canopy_pro_annual", canopy_plan: "canopy_pro" },
  },
]

export default async function seedBlackoutCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: any = container.resolve(MARKETPLACE_LISTING_MODULE)

  logger.info("[seed-blackout-catalog] starting")

  let upserted = 0
  for (const item of CANDIDATES) {
    const metadata: Record<string, unknown> = {
      ...(item.tier ? { tier: item.tier, blackout_tier: item.tier } : {}),
      ...(item.extra_metadata ?? {}),
    }
    const payload = {
      seller_id: SELLER_ID,
      slug: item.slug,
      title: item.title,
      description: item.description,
      manifest: {},
      version: "1.0.0",
      status: item.status ?? CreatorListingStatus.PUBLISHED,
      signed_at: new Date(),
      category: item.category,
      price_cents: item.price_cents,
      currency: "USD",
      entitlement_kind: item.entitlement_kind,
      feature_keys: item.feature_keys,
      media_urls: [],
      tags: item.tags,
      interval: item.interval ?? null,
      period_days: item.period_days ?? null,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    }

    const [existing] = await service.listCreatorListings({
      seller_id: SELLER_ID,
      slug: item.slug,
    })
    if (existing) {
      await service.updateCreatorListings({ id: existing.id, ...payload })
    } else {
      await service.createCreatorListings(payload)
    }
    upserted++
  }

  logger.info(`[seed-blackout-catalog] upserted ${upserted} listings`)
  logger.info("[seed-blackout-catalog] done")
}

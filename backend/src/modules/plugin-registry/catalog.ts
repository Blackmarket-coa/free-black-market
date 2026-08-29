/**
 * First-party seed catalog for the plugin ecosystem (§16). Code is the source
 * of truth; seeded into `plugin_listing` at boot. Third-party plugins are added
 * as rows by their author sellers.
 */

// Pure helpers from the signing side file (never the module index — that
// calls Module() and pulls the container). Reusing them keeps the seed's
// manifest hash byte-identical to what signing/verification compute.
import { canonicalJson, sha256 } from "../marketplace-signing/service"

export type PluginSeed = {
  slug: string
  name: string
  category: "MARKETPLACE_EXTENSION" | "ANALYTICS" | "AUTOMATION"
  description: string
  version: string
  /** Inclusive host-version compatibility bounds; omit for "no bound". */
  minHostVersion?: string
  maxHostVersion?: string
  /**
   * Optional distribution manifest (W3, docs/contracts/extension-manifest.md).
   * Seeds carrying one also get a `plugin_version` row + manifest_url; the
   * original five seeds omit it and behave byte-identically to pre-W3.
   */
  manifest?: Record<string, unknown>
}

/**
 * The W3 demonstrator: a `manifest_plugin` whose home card deep-links to the
 * marketplace's featured vendors. Pure and deterministic — the declarative
 * payload (card + data source) is the "bundle", and its canonical hash is the
 * manifest's `sha256`. Data source: the public `GET /store/vendors?featured=true`
 * read side, whose `featured` flag is backed by the purchasable, time-bound
 * `vendor.promoted_listing` entitlement (shared/promoted-listing.ts).
 * `homepageCard.to` is advisory by protocol — the Blackout host routes clicks
 * to `/plugins/<id>` until a featured-vendors view lands there.
 */
export function buildFeaturedVendorWidgetManifest(): Record<string, unknown> {
  const homepageCard = {
    title: "Featured Vendors",
    subtitle: "Today's promoted Black Market vendors",
    to: "/marketplace/featured-vendors",
    order: 30,
  }
  const dataSource = {
    vendorsUrl: "/store/vendors?featured=true",
    entitlementFeatureKey: "vendor.promoted_listing",
  }
  const payloadSha256 = sha256(canonicalJson({ homepageCard, dataSource }))
  return {
    id: "coop.fbm.featured-vendor-widget",
    name: "Featured Vendor Widget",
    version: "1.0.0",
    protocolVersion: 2,
    artifactKind: "manifest_plugin",
    capabilities: ["http.fetch"],
    listing: {
      providerId: "freeblackmarket",
      providerListingId: "seed:featured-vendor-widget",
      publicSlug: "featured-vendor-widget",
    },
    sha256: payloadSha256,
    description:
      "A home-surface card spotlighting currently promoted Black Market vendors.",
    homepageCard,
    fbm: { minHostVersion: "1.0.0", dataSource },
  }
}

export const PLUGIN_SEED: PluginSeed[] = [
  {
    slug: "storefront-themes",
    name: "Storefront Themes",
    category: "MARKETPLACE_EXTENSION",
    description: "Swappable storefront themes and layout blocks for your shop.",
    version: "1.0.0",
  },
  {
    slug: "sales-analytics",
    name: "Sales & Conversion Analytics",
    category: "ANALYTICS",
    description:
      "Dashboards for revenue, conversion, and product performance over time.",
    version: "1.0.0",
  },
  {
    slug: "creator-attribution-insights",
    name: "Creator Attribution Insights",
    category: "ANALYTICS",
    description:
      "Break down sales by creator, campaign, and referral link with trends.",
    version: "1.0.0",
  },
  {
    slug: "auto-restock-alerts",
    name: "Auto Restock Alerts",
    category: "AUTOMATION",
    description:
      "Automatic low-inventory alerts and reorder reminders by threshold.",
    version: "1.0.0",
  },
  {
    slug: "bounty-autoposter",
    name: "Bounty Auto-Poster",
    category: "AUTOMATION",
    description:
      "Automatically open marketing bounties when you launch new products.",
    version: "1.0.0",
  },
  {
    slug: "featured-vendor-widget",
    name: "Featured Vendor Widget",
    category: "MARKETPLACE_EXTENSION",
    description:
      "A home-surface card spotlighting currently promoted Black Market vendors.",
    version: "1.0.0",
    minHostVersion: "1.0.0",
    manifest: buildFeaturedVendorWidgetManifest(),
  },
]

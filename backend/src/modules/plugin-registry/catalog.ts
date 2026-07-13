/**
 * First-party seed catalog for the plugin ecosystem (§16). Code is the source
 * of truth; seeded into `plugin_listing` at boot. Third-party plugins are added
 * as rows by their author sellers.
 */

export type PluginSeed = {
  slug: string
  name: string
  category: "MARKETPLACE_EXTENSION" | "ANALYTICS" | "AUTOMATION"
  description: string
  version: string
  /** Inclusive host-version compatibility bounds; omit for "no bound". */
  minHostVersion?: string
  maxHostVersion?: string
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
]

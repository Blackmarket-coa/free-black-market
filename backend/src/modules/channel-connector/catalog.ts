import type { ChannelCapability } from "./types"

/**
 * The channels a vendor can connect.
 *
 * Code is the source of truth, as with `vendor-plan/catalog.ts` — the route
 * registrations and the adapter registry reference these ids as literals, so a
 * union makes a typo a compile error rather than a channel that silently does
 * nothing.
 *
 * **Hybrid, per the locked decision:** native adapters for the wedge channels,
 * an aggregator behind a single adapter for the long tail. Only what exists is
 * listed — a catalogue entry for a channel with no adapter would show a vendor
 * a connect button that cannot work.
 */

export const CHANNEL_IDS = ["faire"] as const
export type ChannelId = (typeof CHANNEL_IDS)[number]

export function isChannelId(value: unknown): value is ChannelId {
  return typeof value === "string" && (CHANNEL_IDS as readonly string[]).includes(value)
}

export type ChannelDefinition = {
  id: ChannelId
  display_name: string
  description: string
  /** Must match the adapter's own declaration; a drift test holds them equal. */
  capabilities: readonly ChannelCapability[]
  /** Default API root. A connection may override it to reach a sandbox. */
  api_base_url: string
  /** What the vendor has to go and fetch before they can connect. */
  credential_hint: string
  /** Where they fetch it from. Shown next to the hint. */
  credential_url: string
}

export const CHANNEL_CATALOG: ChannelDefinition[] = [
  {
    id: "faire",
    display_name: "Faire",
    description:
      "Wholesale marketplace. Lists your products to retail buyers and pulls their orders back into FBM.",
    // Must stay exactly equal to the adapter's own declaration — a drift test
    // holds them equal, because this table is what the UI reads as a promise.
    capabilities: [
      "push_listing",
      "push_inventory",
      "pull_orders",
      "push_fulfillment",
    ],
    api_base_url: "https://www.faire.com/external-api/v2",
    credential_hint:
      "Create an access token in your Faire brand portal under Integrations.",
    credential_url: "https://www.faire.com/brand-portal/integrations",
  },
]

export function getChannelDefinition(id: string): ChannelDefinition | null {
  return CHANNEL_CATALOG.find((c) => c.id === id) ?? null
}

/**
 * Faire is the pilot deliberately, and the reasoning belongs next to the code
 * rather than only in a roadmap document:
 *
 * - Wholesale is the closest fit to the farm/producer/maker base FBM already
 *   serves, and it composes with the vendor-rules wholesale engine (customer
 *   tiers, minimums, standing orders) rather than duplicating it.
 * - There is no lengthy app-approval gate, so the interface can be exercised
 *   against a real channel rather than designed against documentation.
 * - The first adapter fixes the shape every later channel inherits, so it
 *   should be one whose semantics are understood. Amazon and Etsy have
 *   stricter penalties for getting fulfilment reporting wrong, which is a bad
 *   place to discover the interface was shaped wrong.
 */
export const PILOT_CHANNEL: ChannelId = "faire"

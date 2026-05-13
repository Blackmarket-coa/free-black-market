/**
 * Threshold (mutual-aid) module — invariants.
 *
 * Threshold is the mutual-aid surface: free stores, community
 * fridges, tool libraries, mutual-aid asks, mutual-aid funds, skill
 * shares, and repair cafés. It is structurally separate from the
 * commerce spine; Threshold posts are not products, do not have
 * prices, and do not move money for the post itself (donations to
 * mutual-aid FUNDS go through the donation module + fiscal sponsor;
 * gifting between members goes through Karma, not Credits).
 *
 * This module is framework-free. It encodes:
 *   - the closed enum of post types
 *   - the no-price rule (the gift economy collapses if mutual-aid
 *     posts can carry a price — donations are separate and gated
 *     through the donation module)
 *   - the hyperlocal-by-default visibility rule
 *
 * See `docs/COMPOSITION_LAYER.md` § "Threshold surface" and § "Not a
 * Buy Nothing fork".
 */

export type ThresholdPostType =
  | "free_store"
  | "community_fridge"
  | "tool_library"
  | "mutual_aid_ask"
  | "mutual_aid_fund"
  | "skill_share"
  | "repair_cafe"

export const THRESHOLD_POST_TYPES: readonly ThresholdPostType[] = [
  "free_store",
  "community_fridge",
  "tool_library",
  "mutual_aid_ask",
  "mutual_aid_fund",
  "skill_share",
  "repair_cafe",
] as const

export const POST_TYPE_LABELS: Record<ThresholdPostType, string> = {
  free_store: "Free store",
  community_fridge: "Community fridge",
  tool_library: "Tool library",
  mutual_aid_ask: "Mutual-aid ask",
  mutual_aid_fund: "Mutual-aid fund",
  skill_share: "Skill share",
  repair_cafe: "Repair café",
}

/**
 * Hyperlocal-by-default visibility. Threshold posts default to a 5 km
 * radius from the origin point; the maximum allowed for a single
 * post is 50 km (above which it's not really hyperlocal — encourage
 * the poster to make multiple region-scoped posts instead).
 */
export const DEFAULT_VISIBILITY_RADIUS_KM = 5
export const MAX_VISIBILITY_RADIUS_KM = 50

/**
 * Field names that, if present in the input, MUST be rejected.
 * Threshold posts cannot carry prices. Donations to mutual-aid funds
 * go through the donation module (which routes via the fiscal
 * sponsor); gifting between members goes through Karma. Neither
 * pathway involves a price on the Threshold post itself.
 */
const FORBIDDEN_PRICE_FIELDS: readonly string[] = [
  "price",
  "price_minor",
  "amount",
  "amount_minor",
  "cost",
  "fee",
  "rate",
  "currency_code",
]

export function isThresholdPostType(value: unknown): value is ThresholdPostType {
  return (
    typeof value === "string" &&
    (THRESHOLD_POST_TYPES as readonly string[]).includes(value)
  )
}

export type ThresholdPostCreateInput = {
  type: ThresholdPostType
  title: string
  description?: string | null
  /**
   * Origin point of the post. Either both latitude and longitude are
   * provided, or neither (in which case the post is "no fixed
   * location", surfaced under the poster's BMC node's geo only).
   */
  latitude?: number | null
  longitude?: number | null
  visibility_radius_km?: number
  posted_by_member_id: string
}

/**
 * Validate a Threshold post creation. Throws on the first violation.
 *
 * Hard invariants:
 *   1. No price-like field in the input.
 *   2. `type` is one of the seven canonical post types.
 *   3. `title` is non-empty.
 *   4. If lat/lon are given, both must be valid coordinates and the
 *      radius must be ∈ [1, MAX_VISIBILITY_RADIUS_KM].
 *   5. `posted_by_member_id` is non-empty.
 */
export function validateThresholdPostCreate(
  input: unknown
): ThresholdPostCreateInput {
  if (!input || typeof input !== "object") {
    throw new Error("threshold post input must be an object")
  }
  const i = input as Record<string, unknown>

  // (1) No price-like fields. This is THE rule — the gift economy
  // collapses if the platform lets a mutual-aid post carry a price.
  for (const field of FORBIDDEN_PRICE_FIELDS) {
    if (i[field] !== undefined && i[field] !== null) {
      throw new Error(
        `Threshold posts cannot carry "${field}". Mutual-aid is gift economy; ` +
          `route money through the donation module + fiscal sponsor instead.`
      )
    }
  }

  // (2) Closed post-type enum.
  if (!isThresholdPostType(i.type)) {
    throw new Error(
      `threshold post type must be one of: ${THRESHOLD_POST_TYPES.join(", ")}`
    )
  }

  // (3) Title.
  if (typeof i.title !== "string" || i.title.trim().length === 0) {
    throw new Error("threshold post.title is required")
  }

  // (4) Optional geo + radius.
  const lat = i.latitude
  const lon = i.longitude
  if ((lat == null) !== (lon == null)) {
    throw new Error(
      "threshold post latitude and longitude must be set together (or both omitted)"
    )
  }
  if (lat != null) {
    if (
      typeof lat !== "number" ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90
    ) {
      throw new Error("threshold post.latitude must be a valid degree (-90..90)")
    }
    if (
      typeof lon !== "number" ||
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180
    ) {
      throw new Error(
        "threshold post.longitude must be a valid degree (-180..180)"
      )
    }
  }

  const requestedRadius = i.visibility_radius_km
  let radius = DEFAULT_VISIBILITY_RADIUS_KM
  if (requestedRadius !== undefined && requestedRadius !== null) {
    if (
      typeof requestedRadius !== "number" ||
      !Number.isFinite(requestedRadius) ||
      requestedRadius < 1 ||
      requestedRadius > MAX_VISIBILITY_RADIUS_KM
    ) {
      throw new Error(
        `threshold post.visibility_radius_km must be in [1, ${MAX_VISIBILITY_RADIUS_KM}]`
      )
    }
    radius = Math.round(requestedRadius)
  }

  // (5) Poster.
  if (
    typeof i.posted_by_member_id !== "string" ||
    i.posted_by_member_id.trim().length === 0
  ) {
    throw new Error("threshold post.posted_by_member_id is required")
  }

  return {
    type: i.type,
    title: i.title.trim(),
    description:
      typeof i.description === "string" ? i.description.trim() : null,
    latitude: lat == null ? null : (lat as number),
    longitude: lon == null ? null : (lon as number),
    visibility_radius_km: radius,
    posted_by_member_id: i.posted_by_member_id.trim(),
  }
}

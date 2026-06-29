import { isLaunchConfigured } from "./site-provisioning";

/**
 * Shared serialization for the vendor "My Website" tab. Kept pure so both
 * `/vendor/website` and `/vendor/website/launch` return an identical shape.
 */

export type WebsiteMeta = {
  connect_domains: string[] | null;
  site_status: string | null;
  site_url: string | null;
  site_repo: string | null;
  embed_features: string[] | null;
};

/**
 * Embed surfaces a vendor can toggle on/off for their FBM Connect embed. These
 * are the `data-fbm="<key>"` blocks connect.js renders and the sections the
 * public Store API returns. This is the single source of truth shared by the
 * Store API (gating) and the vendor "My Website" route (read/write).
 */
export const EMBED_FEATURE_KEYS = [
  "vendor",
  "products",
  "digital",
  "services",
  "events",
  "reviews",
  "booking",
  "chat",
] as const;

export type EmbedFeatureKey = (typeof EMBED_FEATURE_KEYS)[number];

export type EmbedFeatures = Record<EmbedFeatureKey, boolean>;

/**
 * Resolve a stored `embed_features` value into an explicit on/off map.
 *
 * `null`/non-array (the default) means "all surfaces enabled" — so existing
 * vendors who never touched the toggles keep their full embed. When a vendor
 * saves a custom selection it is stored as the array of enabled keys; any key
 * not in the array is off. An empty array therefore means "everything off".
 */
export function resolveEmbedFeatures(
  embed_features: string[] | null | undefined,
): EmbedFeatures {
  const all = !Array.isArray(embed_features);
  const enabled = new Set(all ? [] : (embed_features as string[]));
  return EMBED_FEATURE_KEYS.reduce((acc, key) => {
    acc[key] = all || enabled.has(key);
    return acc;
  }, {} as EmbedFeatures);
}

/** Public base URL the embedded SDK calls (the storefront-facing API host). */
export function apiBase(): string {
  return (
    process.env.PUBLIC_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "https://api.freeblackmarket.com"
  ).replace(/\/$/, "");
}

/** Where connect.js is served from (storefront /public). */
export function storefrontBase(): string {
  return (process.env.STOREFRONT_URL || "https://freeblackmarket.com").replace(
    /\/$/,
    "",
  );
}

/** The exact, ready-to-paste Connect snippet for a vendor handle. */
export function buildSnippet(handle: string): string {
  return [
    `<script src="${storefrontBase()}/connect.js"`,
    `        data-fbm-vendor="${handle}"`,
    `        data-fbm-api="${apiBase()}" async></script>`,
  ].join("\n");
}

export function serializeWebsite(handle: string, meta: WebsiteMeta | null) {
  return {
    handle,
    connect_domains: meta?.connect_domains ?? [],
    site_status: meta?.site_status ?? "none",
    site_url: meta?.site_url ?? null,
    site_repo: meta?.site_repo ?? null,
    // Resolved on/off map for every embed surface, so the portal renders the
    // toggles without re-deriving the "null means all on" default.
    embed_features: resolveEmbedFeatures(meta?.embed_features),
    launch_available: isLaunchConfigured(),
    api_base: apiBase(),
    storefront_url: storefrontBase(),
    sdk_url: `${storefrontBase()}/connect.js`,
    snippet: buildSnippet(handle),
  };
}

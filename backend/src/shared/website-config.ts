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
};

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
    launch_available: isLaunchConfigured(),
    api_base: apiBase(),
    storefront_url: storefrontBase(),
    sdk_url: `${storefrontBase()}/connect.js`,
    snippet: buildSnippet(handle),
  };
}

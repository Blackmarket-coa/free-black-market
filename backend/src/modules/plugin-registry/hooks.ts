/**
 * Plugin event/hook registry contract (roadmap §1.4 2A-tail). Plugin hooks are
 * ordinary `marketplace_webhook_subscription` rows filed under a synthetic
 * per-plugin channel id (`plugin:<slug>`) — the same overloading precedent as
 * the `blackout-global` sentinel — so the existing delivery queue, per-row
 * HMAC signing, retry/backoff, and the every-minute drainer are reused
 * verbatim. This module holds the pure contract pieces; routes do the I/O.
 */

export const PLUGIN_EVENTS = [
  "plugin.installed",
  "plugin.uninstalled",
  // Defined for the contract; emitted when a deprecation flow lands.
  "plugin.deprecated",
] as const

export type PluginEvent = (typeof PLUGIN_EVENTS)[number]

/** The synthetic webhook-subscription channel a plugin's hooks live under. */
export function pluginHookChannelId(slug: string): string {
  return `plugin:${slug}`
}

export function isPluginEvent(value: unknown): value is PluginEvent {
  return (
    typeof value === "string" && (PLUGIN_EVENTS as readonly string[]).includes(value)
  )
}

/**
 * Payload for `plugin.installed`. Privacy posture: seller installs identify
 * the installing seller (a business relationship with the plugin author);
 * customer installs carry only the installer type — customer ids are never
 * shipped to third-party hook endpoints.
 */
export function buildPluginInstalledPayload(args: {
  slug: string
  installer_type: "seller" | "customer"
  installer_seller_id?: string | null
  install_count?: number | null
}): Record<string, unknown> {
  return {
    plugin_slug: args.slug,
    installer_type: args.installer_type,
    ...(args.installer_type === "seller" && args.installer_seller_id
      ? { installer_seller_id: args.installer_seller_id }
      : {}),
    ...(args.install_count != null ? { install_count: args.install_count } : {}),
  }
}

export function buildPluginUninstalledPayload(args: {
  slug: string
  installer_seller_id: string
}): Record<string, unknown> {
  return {
    plugin_slug: args.slug,
    installer_type: "seller",
    installer_seller_id: args.installer_seller_id,
  }
}

/**
 * Diff two `enabled_extensions` arrays (the set-whole-array vendor route) into
 * the plugin installs/uninstalls the change represents. Order-insensitive;
 * duplicates collapse.
 */
export function diffExtensions(
  previous: readonly string[] | null | undefined,
  next: readonly string[] | null | undefined
): { installed: string[]; uninstalled: string[] } {
  const before = new Set(previous ?? [])
  const after = new Set(next ?? [])
  return {
    installed: [...after].filter((slug) => !before.has(slug)),
    uninstalled: [...before].filter((slug) => !after.has(slug)),
  }
}

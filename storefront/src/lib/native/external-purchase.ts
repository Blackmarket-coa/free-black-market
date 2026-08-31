import {
  getCapacitorBridge,
  getNativePlatform,
  isNativeApp,
  type NativePlatform,
} from "./native-app-context"

/**
 * External purchase policy for the FBM native shell.
 *
 * Apple's no-entitlement external purchase link rule (US v. Epic
 * injunction, May 2025) lets iOS apps link out to web checkout WITHOUT
 * the StoreKit External Purchase Link entitlement — but only on the US
 * App Store storefront. Outside the US the shell must not surface the
 * "complete purchase on web" button until the EU/other-region
 * entitlement addendum ships. Android always allows the external-browser
 * flow. On the plain web the button is moot (the user is already on the
 * web checkout).
 *
 * Storefront detection: the device region (Capacitor Device plugin
 * language tag, falling back to `navigator.language`) approximates the
 * App Store storefront. That is the documented v1 tradeoff — a real
 * StoreKit `Storefront` lookup can replace `resolveDeviceRegion()`
 * without touching any call site. Unknown region on iOS fails CLOSED.
 */

export type ExternalPurchasePolicy = {
  /** Whether the buy-on-web button may be shown at all. */
  allowed: boolean
  reason:
    | "not-native"
    | "android-external-checkout"
    | "ios-us-storefront-link-out"
    | "ios-storefront-not-us"
}

/**
 * ISO 3166-1 alpha-2 region from a BCP-47 language tag ("en-US" → "US").
 * Tolerates underscore separators and returns null for region-less tags.
 */
export function regionFromLanguageTag(
  tag: string | null | undefined
): string | null {
  if (!tag) return null
  const normalized = tag.trim().replace(/_/g, "-")
  if (!normalized) return null
  try {
    const region = new Intl.Locale(normalized).region
    if (region && /^[A-Za-z]{2}$/.test(region)) return region.toUpperCase()
  } catch {
    // Fall through to the manual parse below.
  }
  const match = /^[A-Za-z]{2,3}-([A-Za-z]{2})(?:-|$)/.exec(normalized)
  return match ? match[1].toUpperCase() : null
}

/**
 * Device region via the Capacitor Device plugin when the shell exposes
 * it, otherwise the WebView's `navigator.language`.
 */
export async function resolveDeviceRegion(): Promise<string | null> {
  const device = getCapacitorBridge()?.Plugins?.Device
  if (device?.getLanguageTag) {
    try {
      const { value } = await device.getLanguageTag()
      const region = regionFromLanguageTag(value)
      if (region) return region
    } catch {
      // Plugin present but call failed — fall back to navigator.
    }
  }
  if (typeof navigator !== "undefined") {
    return regionFromLanguageTag(navigator.language)
  }
  return null
}

/**
 * Pure policy resolution — unit-tested platform × region matrix. Keep
 * environment reads out of here so tests and call sites share one
 * decision table.
 */
export function resolveExternalPurchasePolicy(input: {
  platform: NativePlatform | null
  region: string | null
}): ExternalPurchasePolicy {
  const { platform, region } = input
  if (platform === null) {
    return { allowed: false, reason: "not-native" }
  }
  if (platform === "android") {
    return { allowed: true, reason: "android-external-checkout" }
  }
  if (region === "US") {
    return { allowed: true, reason: "ios-us-storefront-link-out" }
  }
  return { allowed: false, reason: "ios-storefront-not-us" }
}

/** Detect platform + region and resolve the policy in one call. */
export async function getExternalPurchasePolicy(): Promise<ExternalPurchasePolicy> {
  const platform = getNativePlatform()
  const region = platform === "ios" ? await resolveDeviceRegion() : null
  return resolveExternalPurchasePolicy({ platform, region })
}

export type ExternalOpenOutcome = "capacitor-browser" | "window-open" | "failed"

function isOpenableUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "https:") return true
    // Plain http only against local dev servers.
    return (
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    )
  } catch {
    return false
  }
}

/**
 * Open a URL outside the shell WebView: `@capacitor/browser`
 * (SFSafariViewController / Chrome Custom Tabs — their persistent,
 * app-scoped cookie jar is what carries the handed-off checkout session
 * across opens) when native, `window.open` otherwise.
 */
export async function openExternalUrl(url: string): Promise<ExternalOpenOutcome> {
  if (!isOpenableUrl(url)) return "failed"

  if (isNativeApp()) {
    const browser = getCapacitorBridge()?.Plugins?.Browser
    if (browser?.open) {
      try {
        await browser.open({ url, presentationStyle: "fullscreen" })
        return "capacitor-browser"
      } catch {
        // Plugin failed — fall through to window.open below.
      }
    }
  }

  if (typeof window !== "undefined") {
    const opened = window.open(url, "_blank", "noopener,noreferrer")
    if (opened) return "window-open"
  }
  return "failed"
}

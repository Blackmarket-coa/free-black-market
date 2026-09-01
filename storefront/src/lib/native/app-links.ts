/**
 * Android App Links / iOS Universal Links well-known payload builders for
 * the native shell (mobile/, app id co.bmc.freeblackmarket).
 *
 * Pure builders + env parsers; the `/.well-known/*` route handlers
 * consume them and stay fail-closed: without the env values the routes
 * 404 and OS-level link verification simply never turns on (the `fbm://`
 * custom scheme keeps working regardless).
 */

export const ANDROID_PACKAGE_NAME = "co.bmc.freeblackmarket"

/**
 * Parse `NATIVE_ANDROID_CERT_SHA256` — one or more signing-cert SHA-256
 * fingerprints, comma-separated, in the colon-separated hex form Play /
 * keytool print (`AA:BB:…`, 32 bytes). Invalid entries are dropped;
 * an empty result means "not configured".
 */
export function parseCertFingerprints(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(entry))
}

/** assetlinks.json payload granting the shell app link-handling. */
export function buildAssetLinks(fingerprints: string[]): unknown[] {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE_NAME,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]
}

/**
 * Validate `NATIVE_APPLE_APP_ID` — `TEAMID.bundle.id` (team id is 10
 * alphanumerics). Returns null when unset/malformed.
 */
export function parseAppleAppId(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  return /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(trimmed) ? trimmed : null
}

/** apple-app-site-association payload for Universal Links. */
export function buildAppleAppSiteAssociation(appId: string): Record<string, unknown> {
  return {
    applinks: {
      apps: [],
      details: [
        {
          appID: appId,
          // Everything except the API and handoff surfaces, which must
          // stay in the browser that requested them.
          paths: ["NOT /api/*", "*"],
        },
      ],
    },
  }
}

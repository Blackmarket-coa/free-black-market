import { NextResponse } from "next/server"
import {
  buildAssetLinks,
  parseCertFingerprints,
} from "@/lib/native/app-links"

/**
 * Android App Links statement for the native shell (mobile/).
 *
 * Fail-closed: 404 until `NATIVE_ANDROID_CERT_SHA256` carries the release
 * signing cert fingerprint(s), so an unconfigured deploy never publishes
 * a statement (and Android verification for https links simply stays
 * off — the `fbm://` scheme is unaffected). The manifest's autoVerify
 * intent filter starts matching once this goes live and the app updates.
 */
export async function GET() {
  const fingerprints = parseCertFingerprints(
    process.env.NATIVE_ANDROID_CERT_SHA256
  )
  if (fingerprints.length === 0) {
    return NextResponse.json(
      { code: "not_configured", message: "Set NATIVE_ANDROID_CERT_SHA256" },
      { status: 404 }
    )
  }

  return NextResponse.json(buildAssetLinks(fingerprints), {
    headers: {
      "cache-control": "public, max-age=3600",
    },
  })
}

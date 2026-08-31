import { NextResponse } from "next/server"
import {
  buildAppleAppSiteAssociation,
  parseAppleAppId,
} from "@/lib/native/app-links"

/**
 * iOS Universal Links association for the native shell (mobile/).
 *
 * Fail-closed: 404 until `NATIVE_APPLE_APP_ID` is set to
 * `TEAMID.co.bmc.freeblackmarket`. Served as application/json with no
 * extension, per Apple's requirements; the app additionally needs the
 * Associated Domains capability (`applinks:freeblackmarket.com`).
 */
export async function GET() {
  const appId = parseAppleAppId(process.env.NATIVE_APPLE_APP_ID)
  if (!appId) {
    return NextResponse.json(
      { code: "not_configured", message: "Set NATIVE_APPLE_APP_ID" },
      { status: 404 }
    )
  }

  return NextResponse.json(buildAppleAppSiteAssociation(appId), {
    headers: {
      "cache-control": "public, max-age=3600",
    },
  })
}

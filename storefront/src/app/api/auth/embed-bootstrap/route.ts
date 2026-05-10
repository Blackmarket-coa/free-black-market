import { NextRequest, NextResponse } from "next/server"
import { detectEmbedContext } from "@/lib/runtime/embed-context"

/**
 * Capacitor / in-app webview auth bootstrap per
 * AGGRESSIVE_OPERATIONS_GUIDE.md §2.8 and §5.1.
 *
 * Blackout's Capacitor wrapper POSTs a Blackout-issued JWT to this
 * endpoint after the webview loads. We validate the embed origin
 * matches the allowlist, set the `_medusa_jwt` cookie scoped to the
 * webview session, and return 204.
 *
 * Token signature/audience verification will be added once Blackout
 * publishes the signing keys; the substrate today is the
 * entitlements OAuth surface (see backend
 * `/v1/integrations/blackout/oauth/token`). This route accepts the
 * token shape but does not yet verify the JWS — that lands in a
 * follow-up commit when the Blackout pubkey is available to pin.
 */
export async function POST(request: NextRequest) {
  const ctx = detectEmbedContext({
    get: (name) => request.headers.get(name),
  })
  if (!ctx.isEmbedded) {
    return NextResponse.json(
      { code: "not_embedded", message: "X-FBM-Embed-Origin header is required" },
      { status: 400 }
    )
  }
  if (!ctx.isAllowedOrigin || !ctx.origin) {
    return NextResponse.json(
      { code: "origin_not_allowed", message: "Embed origin is not in BLACKOUT_EMBED_ALLOWED_ORIGINS" },
      { status: 403 }
    )
  }

  let body: { token?: string }
  try {
    body = (await request.json()) as { token?: string }
  } catch {
    return NextResponse.json(
      { code: "bad_request", message: "Invalid JSON body" },
      { status: 400 }
    )
  }

  const token = body?.token?.trim()
  if (!token) {
    return NextResponse.json(
      { code: "bad_request", message: "token is required" },
      { status: 400 }
    )
  }

  const response = NextResponse.json(
    { ok: true, embed_origin: ctx.origin },
    { status: 200 }
  )
  response.cookies.set("_medusa_jwt", token, {
    // Webview-friendly: not httpOnly so the embedded page can read it
    // back when the in-app session needs to refresh; sameSite=none with
    // secure=true is required for cross-origin webview cookies.
    sameSite: "none",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 12, // 12h aligns with Blackout token TTL
  })
  return response
}

export async function GET() {
  // Probe endpoint so the Capacitor wrapper can confirm the bootstrap
  // surface exists before posting the token.
  return NextResponse.json({ ok: true, surface: "embed-bootstrap" })
}

import { NextRequest, NextResponse } from "next/server"
import { detectEmbedContext } from "@/lib/runtime/embed-context"

/**
 * Capacitor / in-app webview auth bootstrap per
 * AGGRESSIVE_OPERATIONS_GUIDE.md §2.8 and §5.1.
 *
 * Blackout's Capacitor wrapper POSTs a Blackout-issued JWT to this
 * endpoint after the webview loads. We validate the embed origin
 * matches the allowlist, set the `_medusa_jwt` cookie scoped to the
 * webview session, and return 200.
 *
 * Fail-closed posture: this route is DISABLED by default and only
 * accepts a token when an operator explicitly opts in via
 * `BLACKOUT_EMBED_ENABLED=true`. Cryptographic JWS signature/audience
 * verification lands once Blackout publishes its signing key (pinned via
 * a follow-up); until then the route does structural token sanity checks
 * only, and the FBM backend remains the real authorization gate — it
 * independently validates `_medusa_jwt` against its own `JWT_SECRET`, so
 * a token not signed by FBM cannot authorize backend calls even if set
 * here. We therefore never write an unverified token into the auth cookie
 * unless the embed flow is explicitly enabled.
 */

/** True only when an operator has explicitly enabled the embed auth flow. */
function isEmbedAuthEnabled(): boolean {
  return process.env.BLACKOUT_EMBED_ENABLED === "true"
}

/**
 * Structural sanity for a compact JWS: three non-empty base64url segments
 * within a sane length bound. Not a signature check — that requires the
 * Blackout pubkey — but it stops arbitrary/oversized values from being
 * written into the auth cookie.
 */
function looksLikeCompactJws(token: string): boolean {
  if (token.length > 4096) return false
  const parts = token.split(".")
  if (parts.length !== 3) return false
  return parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p) && p.length > 0)
}

export async function POST(request: NextRequest) {
  // Fail closed: the embed auth path is off unless explicitly enabled.
  if (!isEmbedAuthEnabled()) {
    return NextResponse.json(
      {
        code: "embed_auth_disabled",
        message: "Embed auth bootstrap is not enabled (set BLACKOUT_EMBED_ENABLED=true)",
      },
      { status: 501 }
    )
  }

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

  if (!looksLikeCompactJws(token)) {
    return NextResponse.json(
      { code: "invalid_token", message: "token is not a well-formed JWS" },
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
  // surface exists (and whether it's enabled) before posting the token.
  return NextResponse.json({
    ok: true,
    surface: "embed-bootstrap",
    enabled: isEmbedAuthEnabled(),
  })
}

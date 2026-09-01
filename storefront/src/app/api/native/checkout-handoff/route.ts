import { NextRequest, NextResponse } from "next/server"
import { detectEmbedContext } from "@/lib/runtime/embed-context"
import { isNativeAppUserAgent } from "@/lib/native/native-app-context"
import { sanitizeRedirectPath } from "@/lib/native/deep-links"
import {
  mintHandoffToken,
  verifyHandoffToken,
} from "@/lib/native/checkout-handoff"

/**
 * Cart handoff for the native shell's region-gated "complete purchase on
 * web" button (mobile/README.md).
 *
 * POST — called from inside the shell WebView (which holds the
 * `_medusa_cart_id` cookie): mints a short-lived signed token and returns
 * the absolute GET URL to open in the external system browser.
 *
 * GET — the external browser lands here with `?token=…&redirect=…`: the
 * token is verified, the cart cookie is re-set in THIS browser's jar, and
 * the request 307s to the sanitized same-origin redirect path (the
 * checkout). Invalid/expired tokens redirect to the fallback path with
 * `?native_handoff=invalid` instead of dead-ending the user on JSON.
 *
 * Fail-closed posture (same as /api/auth/embed-bootstrap): the whole
 * surface is disabled until an operator sets NATIVE_HANDOFF_SECRET. The
 * HMAC signature is the actual protection against link-crafted cart
 * fixation — the POST-side shell check (native UA marker or allowlisted
 * embed origin) is hygiene only, since a UA-spoofing caller can only ever
 * mint a token for the cart cookie they already hold.
 */

function getHandoffSecret(): string | null {
  const secret = process.env.NATIVE_HANDOFF_SECRET?.trim()
  return secret ? secret : null
}

function isShellRequest(request: NextRequest): boolean {
  if (isNativeAppUserAgent(request.headers.get("user-agent"))) return true
  const ctx = detectEmbedContext({
    get: (name) => request.headers.get(name),
  })
  return ctx.isEmbedded && ctx.isAllowedOrigin
}

export async function POST(request: NextRequest) {
  const secret = getHandoffSecret()
  if (!secret) {
    return NextResponse.json(
      {
        code: "handoff_disabled",
        message:
          "Native checkout handoff is not enabled (set NATIVE_HANDOFF_SECRET)",
      },
      { status: 501 }
    )
  }

  if (!isShellRequest(request)) {
    return NextResponse.json(
      {
        code: "not_native_shell",
        message: "This endpoint only serves the native app shell",
      },
      { status: 403 }
    )
  }

  const cartId = request.cookies.get("_medusa_cart_id")?.value
  if (!cartId) {
    return NextResponse.json(
      { code: "no_cart", message: "No cart cookie present to hand off" },
      { status: 400 }
    )
  }

  let redirect = "/"
  try {
    const body = (await request.json()) as { redirect?: string }
    redirect = sanitizeRedirectPath(body?.redirect, "/")
  } catch {
    // No/invalid body — keep the fallback redirect.
  }

  const token = mintHandoffToken(cartId, secret)
  const url = new URL("/api/native/checkout-handoff", request.nextUrl.origin)
  url.searchParams.set("token", token)
  url.searchParams.set("redirect", redirect)

  return NextResponse.json({ ok: true, url: url.toString() })
}

export async function GET(request: NextRequest) {
  const secret = getHandoffSecret()
  if (!secret) {
    return NextResponse.json(
      {
        code: "handoff_disabled",
        message:
          "Native checkout handoff is not enabled (set NATIVE_HANDOFF_SECRET)",
      },
      { status: 501 }
    )
  }

  const redirect = sanitizeRedirectPath(
    request.nextUrl.searchParams.get("redirect"),
    "/"
  )
  const token = request.nextUrl.searchParams.get("token") ?? ""
  const cartId = verifyHandoffToken(token, secret)

  if (!cartId) {
    const fallback = new URL(redirect, request.nextUrl.origin)
    fallback.searchParams.set("native_handoff", "invalid")
    return NextResponse.redirect(fallback, 307)
  }

  const destination = new URL(redirect, request.nextUrl.origin)
  const response = NextResponse.redirect(destination, 307)
  // Mirror lib/data/cookies.ts setCartId so the adopted cart behaves
  // exactly like one created in this browser.
  response.cookies.set("_medusa_cart_id", cartId, {
    maxAge: 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  })
  return response
}

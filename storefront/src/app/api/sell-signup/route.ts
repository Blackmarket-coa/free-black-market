import { logger } from "@/lib/logger"
import { NextResponse } from "next/server"

/**
 * Captures from the storefront "Sell on Free Black Market" landing
 * page (storefront/src/app/[locale]/(main)/sell/SellPageClient.tsx).
 *
 * The client POSTs `{ email, store_name, selling[] }` here before
 * redirecting to the vendor-panel registration flow. This route
 * does light shape validation, then forwards to the backend
 * `/store/sell-signup` endpoint which persists into the `sell_signup`
 * leads table.
 *
 * Failure modes are intentionally absorbed: if the backend is
 * unreachable, we log server-side and return 202 anyway so the
 * client-side flow never blocks the user's redirect.
 */

type SellSignupBody = {
  email?: unknown
  store_name?: unknown
  selling?: unknown
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
}

const BACKEND_URL =
  process.env.MEDUSA_BACKEND_URL ||
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
  ""
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

export async function POST(request: Request) {
  let body: SellSignupBody
  try {
    body = (await request.json()) as SellSignupBody
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  if (
    typeof body.email !== "string" ||
    typeof body.store_name !== "string" ||
    !isStringArray(body.selling)
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }

  const payload = {
    email: body.email,
    store_name: body.store_name,
    selling: body.selling,
  }

  if (!BACKEND_URL || !PUBLISHABLE_KEY) {
    logger.warn(
      "[sell-signup] backend not configured; capture not persisted",
      { email: payload.email, store_name: payload.store_name },
    )
    return NextResponse.json({ status: "accepted" }, { status: 202 })
  }

  const forwardHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "x-publishable-api-key": PUBLISHABLE_KEY,
  }

  const forwardedFor = request.headers.get("x-forwarded-for")
  if (forwardedFor) forwardHeaders["x-forwarded-for"] = forwardedFor
  const userAgent = request.headers.get("user-agent")
  if (userAgent) forwardHeaders["user-agent"] = userAgent
  const referer = request.headers.get("referer")
  if (referer) forwardHeaders["referer"] = referer

  try {
    const backendRes = await fetch(`${BACKEND_URL.replace(/\/$/, "")}/store/sell-signup`, {
      method: "POST",
      headers: forwardHeaders,
      body: JSON.stringify(payload),
    })

    if (backendRes.status === 400) {
      const detail = await backendRes.json().catch(() => null)
      return NextResponse.json(detail ?? { error: "invalid_body" }, { status: 400 })
    }

    if (!backendRes.ok) {
      logger.warn("[sell-signup] backend rejected capture", {
        status: backendRes.status,
        email: payload.email,
      })
      // Don't propagate 5xx to the client — capture is best-effort and
      // must never block the user's redirect to vendor-panel.
      return NextResponse.json({ status: "accepted" }, { status: 202 })
    }

    const data = await backendRes.json().catch(() => ({ status: "accepted" }))
    return NextResponse.json(data, { status: 202 })
  } catch (err) {
    logger.warn("[sell-signup] backend forward failed", {
      email: payload.email,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ status: "accepted" }, { status: 202 })
  }
}

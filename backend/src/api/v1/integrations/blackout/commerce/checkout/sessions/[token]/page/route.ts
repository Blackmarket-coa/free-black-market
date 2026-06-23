import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import jwt from "jsonwebtoken"
import { config } from "../../../../../../../../../shared/config"

interface BlackoutSessionPayload {
  id: string
  userId: string
  listingId: string
  sku: string | null
  embed: boolean
  returnUrl: string | null
}

function decodeSession(token: string): BlackoutSessionPayload | null {
  if (!config.JWT_SECRET) return null
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, {
      audience: "fbm-blackout-checkout",
    })
    if (typeof decoded !== "object" || !decoded || !("listingId" in decoded)) return null
    return decoded as unknown as BlackoutSessionPayload
  } catch {
    return null
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Hosted FBM checkout page for a Blackout-initiated session (§5). This is the
 * page the session `url` points at. The terminal purchase settles through FBM's
 * normal order flow, which posts `purchase.succeeded` back to Blackout via the
 * §2 webhook — so this page is a lightweight shell, not a second payment path.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const token = String(req.params.token || "")
  const session = decodeSession(token)
  if (!session) {
    return res
      .status(401)
      .type("text/html")
      .send("<!doctype html><h1>Invalid or expired checkout session</h1>")
  }

  const continueHref = session.returnUrl ? escapeHtml(session.returnUrl) : ""
  return res
    .status(200)
    .type("text/html")
    .send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'">
  <title>Free Black Market — Checkout</title>
  <style>body{font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px}</style>
</head>
<body>
  <h1>Checkout</h1>
  <p>Listing <strong>${escapeHtml(session.listingId)}</strong>${
    session.sku ? ` (sku ${escapeHtml(session.sku)})` : ""
  }</p>
  <p>Session <code>${escapeHtml(session.id)}</code></p>
  ${continueHref ? `<p><a href="${continueHref}">Continue</a></p>` : ""}
</body>
</html>`)
}

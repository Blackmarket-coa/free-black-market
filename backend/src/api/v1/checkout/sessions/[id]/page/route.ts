import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import jwt from "jsonwebtoken"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { config } from "../../../../../../shared/config"
import createDigitalProductOrderWorkflow from "../../../../../../workflows/create-digital-product-order"

interface SessionTokenPayload {
  cart_id: string
  embed: boolean
  embed_origin?: string
  return_url?: string
}

function decodeSession(token: string): SessionTokenPayload | null {
  if (!config.JWT_SECRET) return null
  try {
    const decoded = (jwt.verify as any)(token, config.JWT_SECRET, {
      audience: "fbm-checkout",
    })
    if (typeof decoded !== "object" || !decoded || !("cart_id" in decoded)) {
      return null
    }
    return decoded as unknown as SessionTokenPayload
  } catch {
    return null
  }
}

/**
 * Render the embed-checkout page. When ?embed=1, the rendered HTML emits
 * `postMessage(... , embedOrigin)` events for `checkout.ready`,
 * `checkout.completed`, `checkout.cancelled`, and `checkout.error`. The
 * postMessage target is the origin captured at session creation, never `*`,
 * so a malicious top frame on a different origin cannot intercept the events.
 *
 * GET serves the page (and triggers cart completion when called with
 * ?action=complete). For non-embed callers the page is still useful as a
 * lightweight redirect/loading shell.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const token = String(req.params.id || "")
  const session = decodeSession(token)
  if (!session) {
    res.status(401).type("text/html").send(renderError("Invalid or expired session"))
    return
  }

  const action = String(req.query.action || "")
  const embed = req.query.embed === "1" || session.embed
  const embedOrigin = session.embed_origin

  // The global securityHeadersMiddleware sets X-Frame-Options: SAMEORIGIN.
  // For embed sessions we explicitly allow framing only from the
  // origin captured at session creation (signed into the JWT), and remove
  // the legacy X-Frame-Options header which lacks an allow-list form.
  if (embed && embedOrigin) {
    res.removeHeader("X-Frame-Options")
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors ${embedOrigin}`
    )
  }

  if (action === "complete") {
    try {
      const { result } = await createDigitalProductOrderWorkflow(req.scope).run({
        input: { cart_id: session.cart_id },
      })
      const orderId =
        (result as { order?: { id?: string } } | undefined)?.order?.id ??
        (result as { id?: string } | undefined)?.id ??
        null

      const returnTarget = session.return_url
      res
        .status(200)
        .type("text/html")
        .send(
          renderResult({
            embed,
            embedOrigin,
            event: "checkout.completed",
            payload: { order_id: orderId, cart_id: session.cart_id },
            returnTarget,
          })
        )
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : "Checkout failed"
      res
        .status(500)
        .type("text/html")
        .send(
          renderResult({
            embed,
            embedOrigin,
            event: "checkout.error",
            payload: { message },
          })
        )
      return
    }
  }

  if (action === "cancel") {
    res
      .status(200)
      .type("text/html")
      .send(
        renderResult({
          embed,
          embedOrigin,
          event: "checkout.cancelled",
          payload: { cart_id: session.cart_id },
        })
      )
    return
  }

  // Default: render the loading/ready shell. Caller can submit the form
  // (or call POST) to complete the cart.
  const cartSummary = await summarizeCart(req, session.cart_id)
  res
    .status(200)
    .type("text/html")
    .send(
      renderShell({
        embed,
        embedOrigin,
        token,
        cart: cartSummary,
      })
    )
}

/**
 * Programmatic completion endpoint for non-iframe consumers.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const token = String(req.params.id || "")
  const session = decodeSession(token)
  if (!session) {
    return res
      .status(401)
      .json({ message: "Invalid or expired session", type: "unauthorized" })
  }

  try {
    const { result } = await createDigitalProductOrderWorkflow(req.scope).run({
      input: { cart_id: session.cart_id },
    })
    return res.json({ type: "order", ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed"
    return res.status(500).json({ message, type: "checkout_failed" })
  }
}

async function summarizeCart(req: MedusaRequest, cartId: string) {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "cart",
      fields: ["id", "currency_code", "total"],
      filters: { id: cartId },
    })
    return data?.[0] ?? { id: cartId }
  } catch {
    return { id: cartId }
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

function renderError(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Checkout error</title></head><body><h1>Checkout error</h1><p>${escapeHtml(
    message
  )}</p></body></html>`
}

function renderShell(args: {
  embed: boolean
  embedOrigin?: string
  token: string
  cart: { id: string; currency_code?: string; total?: number | string }
}): string {
  const targetOrigin = args.embedOrigin ?? ""
  const safeOrigin = JSON.stringify(targetOrigin)
  const completeUrl = `?action=complete${args.embed ? "&embed=1" : ""}`
  const cancelUrl = `?action=cancel${args.embed ? "&embed=1" : ""}`
  const total =
    args.cart.total !== undefined ? String(args.cart.total) : "—"
  const currency = args.cart.currency_code
    ? args.cart.currency_code.toUpperCase()
    : ""
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
  <title>Free Black Market — Checkout</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 16px; max-width: 480px; margin: 0 auto; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
    button { padding: 12px 20px; border-radius: 6px; border: 0; cursor: pointer; font-size: 16px; }
    .pay { background: #111; color: #fff; }
    .cancel { background: #f4f4f4; color: #111; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>Checkout</h1>
  <div class="row"><span>Cart</span><span>${escapeHtml(args.cart.id)}</span></div>
  <div class="row"><span>Total</span><span>${escapeHtml(total)} ${escapeHtml(
    currency
  )}</span></div>
  <form method="GET" action="${escapeHtml(completeUrl)}">
    <button class="pay" type="submit">Confirm and pay</button>
  </form>
  <form method="GET" action="${escapeHtml(cancelUrl)}">
    <button class="cancel" type="submit">Cancel</button>
  </form>
  <script>
    (function () {
      var embed = ${args.embed ? "true" : "false"};
      var origin = ${safeOrigin};
      if (embed && origin && window.parent && window.parent !== window) {
        window.parent.postMessage(
          { source: "fbm-checkout", type: "checkout.ready", payload: { cart_id: ${JSON.stringify(
            args.cart.id
          )} } },
          origin
        );
      }
    })();
  </script>
</body>
</html>`
}

function renderResult(args: {
  embed: boolean
  embedOrigin?: string
  event:
    | "checkout.completed"
    | "checkout.cancelled"
    | "checkout.error"
  payload: Record<string, unknown>
  returnTarget?: string
}): string {
  const target = args.embedOrigin ?? ""
  const safeOrigin = JSON.stringify(target)
  const safeEvent = JSON.stringify(args.event)
  const safePayload = JSON.stringify(args.payload)
  const safeReturnTarget = JSON.stringify(args.returnTarget ?? null)
  const heading =
    args.event === "checkout.completed"
      ? "Order placed"
      : args.event === "checkout.cancelled"
      ? "Checkout cancelled"
      : "Checkout error"
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
  <title>${escapeHtml(heading)}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; max-width: 480px; margin: 0 auto; text-align: center; }
  </style>
</head>
<body>
  <h1>${escapeHtml(heading)}</h1>
  <script>
    (function () {
      var embed = ${args.embed ? "true" : "false"};
      var origin = ${safeOrigin};
      var returnTarget = ${safeReturnTarget};
      if (embed && origin && window.parent && window.parent !== window) {
        window.parent.postMessage(
          { source: "fbm-checkout", type: ${safeEvent}, payload: ${safePayload} },
          origin
        );
      } else if (returnTarget) {
        try { window.location.href = returnTarget; } catch (e) {}
      }
    })();
  </script>
</body>
</html>`
}

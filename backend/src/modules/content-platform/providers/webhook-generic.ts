import { createHmac, timingSafeEqual } from "crypto"
import {
  ContentPlatformProvider,
  ExchangeCodeResult,
  InboundWebhookRequest,
  NormalizedEvent,
  ProviderMetrics,
  ProviderNotSupportedError,
  VerifyAccountResult,
} from "./types"

/**
 * Generic webhook adapter.
 *
 * Stock-bundled: works without any third-party API keys. Any third-party
 * site (a custom CMS, a podcast host, a blog, Blackout while its first-
 * party adapter is in progress) can paste a webhook URL into their
 * publishing pipeline that POSTs JSON like:
 *
 *   {
 *     "type": "post.metrics_updated",
 *     "externalAccountId": "<creator's account id on that platform>",
 *     "externalPostId": "<post id>",
 *     "metrics": { "views": 1000, "likes": 50, "shares": 3, "comments": 2 },
 *     "occurredAt": "2026-05-06T12:00:00Z"
 *   }
 *
 * to `POST /v1/webhooks/content-platform/custom`. The request must carry
 * an `X-FBM-Signature: sha256=<hex>` header computed with the per-account
 * `inbound_webhook_secret` shown to the creator at platform-account
 * connect time. We validate the signature here and normalize.
 *
 * No OAuth. `verifyPostOwnership` always succeeds on this adapter; the
 * creator establishes ownership by being the holder of the webhook secret.
 */
export class WebhookGenericProvider implements ContentPlatformProvider {
  readonly platform = "custom" as const

  buildAuthUrl(): string {
    throw new ProviderNotSupportedError(this.platform, "OAuth")
  }

  async exchangeCode(): Promise<ExchangeCodeResult> {
    throw new ProviderNotSupportedError(this.platform, "OAuth")
  }

  async verifyAccount(): Promise<VerifyAccountResult> {
    return { ok: true }
  }

  async verifyPostOwnership(): Promise<boolean> {
    return true
  }

  async fetchPostMetrics(): Promise<ProviderMetrics> {
    // Pull-mode is not supported — push-only via inbound webhook.
    throw new ProviderNotSupportedError(this.platform, "fetchPostMetrics (push-only adapter)")
  }

  async handleInboundWebhook(
    req: InboundWebhookRequest
  ): Promise<{ events: NormalizedEvent[]; externalAccountId?: string | null }> {
    const sigHeader = readHeader(req.headers, "x-fbm-signature")
    if (!sigHeader) {
      throw new Error("Missing X-FBM-Signature header")
    }

    // Body parsing
    const payload = typeof req.body === "object" && req.body !== null ? req.body : null
    if (!payload) {
      throw new Error("Invalid webhook body")
    }
    const externalAccountId = (payload as any).externalAccountId
    if (!externalAccountId || typeof externalAccountId !== "string") {
      throw new Error("Missing externalAccountId in payload")
    }

    // Signature verification happens at the service layer (it has access to
    // the per-account secret). Here we just normalize.
    const type = (payload as any).type
    const externalPostId = (payload as any).externalPostId
    const metrics = (payload as any).metrics ?? null
    const occurredAtRaw = (payload as any).occurredAt
    const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date()

    const events: NormalizedEvent[] = []
    if (type === "post.published" || type === "post.metrics_updated" || type === "account.revoked") {
      events.push({
        type,
        externalAccountId,
        externalPostId,
        metrics: metrics ?? undefined,
        occurredAt,
        raw: payload as Record<string, unknown>,
      })
    }
    return { events, externalAccountId }
  }

  /**
   * Verify HMAC signature against the per-account secret. Exposed as a
   * static helper so the service layer (which holds the secret) can call it
   * before invoking handleInboundWebhook.
   */
  static verifySignature(
    rawBody: string | Buffer,
    sigHeader: string,
    secret: string
  ): boolean {
    const m = /^sha256=([a-f0-9]+)$/i.exec(sigHeader.trim())
    if (!m) return false
    const provided = Buffer.from(m[1], "hex")
    const expected = createHmac("sha256", secret)
      .update(rawBody as any)
      .digest()
    if (provided.length !== expected.length) return false
    return timingSafeEqual(provided, expected)
  }
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | null {
  const v = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

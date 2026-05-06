/**
 * ContentPlatformProvider — pluggable adapter interface.
 *
 * Each adapter encapsulates one external content platform (TikTok,
 * Instagram, YouTube, Twitch, Blackout, an RSS-fed blog, or a generic
 * webhook-emitting site). The creator-program and creator-rewards modules
 * never import an adapter directly — they call
 * `ContentPlatformService.getProvider(platform)` and depend only on this
 * interface. That keeps Blackout/social-platform code optional and
 * open-source-friendly.
 */

export type ContentPlatform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "twitch"
  | "blackout"
  | "rss"
  | "podcast"
  | "custom"

export interface ProviderMetrics {
  views: number
  likes: number
  shares: number
  comments: number
  saves?: number
  watch_time_seconds?: number
  // Platform-specific anti-fraud signal: views deduped by visitor + region
  // + bot filter. Defaults to `views` when the platform doesn't expose it.
  qualified_views?: number
  raw: Record<string, unknown>
}

export interface NormalizedPlatformAccount {
  id: string
  creator_seller_id: string
  platform: ContentPlatform
  external_account_id: string
  handle: string | null
  access_token_encrypted: string | null
  refresh_token_encrypted: string | null
  token_expires_at: Date | null
  scopes: string[] | null
  inbound_webhook_secret: string | null
  metadata: Record<string, unknown> | null
}

export interface ExchangeCodeResult {
  access: string
  refresh?: string
  expiresAt?: Date
  externalAccountId: string
  handle?: string
  followerCount?: number
  scopes?: string[]
}

export interface RefreshResult {
  access: string
  refresh?: string
  expiresAt?: Date
}

export interface VerifyAccountResult {
  ok: boolean
  followerCount?: number
  reason?: string
}

export interface NormalizedEvent {
  type: "post.published" | "post.metrics_updated" | "account.revoked"
  externalAccountId: string
  externalPostId?: string
  metrics?: Partial<ProviderMetrics>
  occurredAt: Date
  raw?: Record<string, unknown>
}

export interface InboundWebhookRequest {
  headers: Record<string, string | string[] | undefined>
  rawBody: string | Buffer | null
  body: unknown
}

export interface ContentPlatformProvider {
  readonly platform: ContentPlatform

  // OAuth (optional — adapters that don't use OAuth like `rss` or `custom`
  // can throw "not_supported" here; the registry never wires up an OAuth
  // route for them).
  buildAuthUrl(args: {
    state: string
    redirectUri: string
    scopes?: string[]
  }): string

  exchangeCode(code: string, redirectUri: string): Promise<ExchangeCodeResult>

  refresh?(refreshToken: string): Promise<RefreshResult>

  // Verification
  verifyAccount(account: NormalizedPlatformAccount): Promise<VerifyAccountResult>

  verifyPostOwnership(
    account: NormalizedPlatformAccount,
    externalPostId: string
  ): Promise<boolean>

  // Metrics
  fetchPostMetrics(
    account: NormalizedPlatformAccount,
    externalPostId: string
  ): Promise<ProviderMetrics>

  // Optional: subscribe to push events on the external platform
  subscribeToPostEvents?(
    account: NormalizedPlatformAccount
  ): Promise<{ subscriptionId: string }>

  // Optional: handle inbound webhooks (HMAC verification + payload
  // normalization). Adapters that support push wire this up via the
  // /v1/webhooks/content-platform/:platform ingress endpoint.
  handleInboundWebhook?(
    req: InboundWebhookRequest
  ): Promise<{ events: NormalizedEvent[]; externalAccountId?: string | null }>
}

export class ProviderNotSupportedError extends Error {
  constructor(platform: string, capability: string) {
    super(`Provider ${platform} does not support ${capability}`)
    this.name = "ProviderNotSupportedError"
  }
}

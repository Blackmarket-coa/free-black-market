import { MedusaService } from "@medusajs/framework/utils"
import { randomBytes } from "crypto"
import PlatformAccount, {
  PlatformAccountStatus,
} from "./models/platform-account"
import {
  ContentPlatform,
  ContentPlatformProvider,
  NormalizedEvent,
  NormalizedPlatformAccount,
  ProviderMetrics,
} from "./providers/types"
import { WebhookGenericProvider } from "./providers/webhook-generic"
import { RssProvider } from "./providers/rss"
import { TikTokProvider } from "./providers/tiktok"
import { InstagramProvider } from "./providers/instagram"
import { YouTubeProvider } from "./providers/youtube"
import { TwitchProvider } from "./providers/twitch"
import { BlackoutProvider } from "./providers/blackout"

class ContentPlatformService extends MedusaService({ PlatformAccount }) {
  private providers = new Map<ContentPlatform, ContentPlatformProvider>()

  constructor(...args: any[]) {
    super(...args)
    this.registerStockProviders()
  }

  /**
   * Register the stock-bundled adapters that don't need third-party env
   * vars (so any open-source deployment has working `rss` and `custom`
   * providers out of the box). Optional adapters are registered only when
   * their env vars are present.
   */
  private registerStockProviders() {
    this.registerProvider(new WebhookGenericProvider())
    this.registerProvider(new RssProvider())

    if (process.env.TIKTOK_CLIENT_KEY) {
      this.registerProvider(new TikTokProvider())
    }
    if (process.env.META_APP_ID) {
      this.registerProvider(new InstagramProvider())
    }
    if (process.env.GOOGLE_CLIENT_ID) {
      this.registerProvider(new YouTubeProvider())
    }
    if (process.env.TWITCH_CLIENT_ID) {
      this.registerProvider(new TwitchProvider())
    }
    if (
      process.env.FBM_BLACKOUT_INTEGRATION === "1" &&
      process.env.BLACKOUT_API_BASE
    ) {
      this.registerProvider(new BlackoutProvider())
    }
  }

  registerProvider(p: ContentPlatformProvider): void {
    this.providers.set(p.platform, p)
  }

  hasProvider(platform: ContentPlatform): boolean {
    return this.providers.has(platform)
  }

  getProvider(platform: ContentPlatform): ContentPlatformProvider {
    const p = this.providers.get(platform)
    if (!p) {
      throw new Error(
        `No provider registered for platform "${platform}". ` +
          `Set the matching env var to enable it (e.g. TIKTOK_CLIENT_KEY).`
      )
    }
    return p
  }

  listAvailablePlatforms(): ContentPlatform[] {
    return Array.from(this.providers.keys())
  }

  /**
   * Begin OAuth: returns the auth URL the creator should be redirected to
   * plus an opaque `state` value the caller should round-trip.
   */
  async startOAuth(args: {
    creatorSellerId: string
    platform: ContentPlatform
    redirectUri: string
    scopes?: string[]
  }): Promise<{ authUrl: string; state: string }> {
    const provider = this.getProvider(args.platform)
    const state = randomBytes(16).toString("hex")
    const authUrl = provider.buildAuthUrl({
      state,
      redirectUri: args.redirectUri,
      scopes: args.scopes,
    })
    // The state value is short-lived and only meaningful round-tripped
    // through the OAuth flow. Caller (route handler) is responsible for
    // associating `state` with the creator session via cookie.
    return { authUrl, state }
  }

  async finishOAuth(args: {
    creatorSellerId: string
    platform: ContentPlatform
    code: string
    redirectUri: string
  }): Promise<any> {
    const provider = this.getProvider(args.platform)
    const result = await provider.exchangeCode(args.code, args.redirectUri)

    const existing = await this.listPlatformAccounts({
      creator_seller_id: args.creatorSellerId,
      platform: args.platform,
    })

    const fields = {
      external_account_id: result.externalAccountId,
      handle: result.handle ?? null,
      follower_count: result.followerCount ?? 0,
      access_token_encrypted: result.access,
      refresh_token_encrypted: result.refresh ?? null,
      token_expires_at: result.expiresAt ?? null,
      scopes: result.scopes ?? null,
      status: PlatformAccountStatus.CONNECTED,
      last_synced_at: new Date(),
    }

    if (existing.length > 0) {
      return (this as any).updatePlatformAccounts({ id: existing[0].id, ...fields })
    }
    return (this as any).createPlatformAccounts({
      creator_seller_id: args.creatorSellerId,
      platform: args.platform,
      ...fields,
    })
  }

  /**
   * Connect a platform that doesn't use OAuth (RSS, custom webhook).
   * Issues an inbound webhook secret the creator must include in
   * `X-FBM-Signature` HMAC headers when posting events.
   */
  async connectNonOAuth(args: {
    creatorSellerId: string
    platform: ContentPlatform
    externalAccountId: string
    handle?: string | null
    metadata?: Record<string, unknown>
  }): Promise<any> {
    const existing = await this.listPlatformAccounts({
      creator_seller_id: args.creatorSellerId,
      platform: args.platform,
    })
    const fields = {
      external_account_id: args.externalAccountId,
      handle: args.handle ?? null,
      inbound_webhook_secret:
        existing[0]?.inbound_webhook_secret ??
        `fbm_pwhk_${randomBytes(24).toString("hex")}`,
      status: PlatformAccountStatus.CONNECTED,
      last_synced_at: new Date(),
      metadata: args.metadata ?? null,
    }
    if (existing.length > 0) {
      return (this as any).updatePlatformAccounts({ id: existing[0].id, ...fields })
    }
    return (this as any).createPlatformAccounts({
      creator_seller_id: args.creatorSellerId,
      platform: args.platform,
      ...fields,
    })
  }

  async revokeAccount(accountId: string): Promise<any> {
    return (this as any).updatePlatformAccounts({
      id: accountId,
      status: PlatformAccountStatus.REVOKED,
      access_token_encrypted: null,
      refresh_token_encrypted: null,
    })
  }

  /**
   * Pull metrics for a single post via the matching platform adapter.
   */
  async fetchPostMetrics(args: {
    platform: ContentPlatform
    creatorSellerId: string
    externalPostId: string
  }): Promise<ProviderMetrics> {
    const accounts = await this.listPlatformAccounts({
      creator_seller_id: args.creatorSellerId,
      platform: args.platform,
    })
    const account = accounts[0]
    if (!account) throw new Error("Platform account not connected")
    const provider = this.getProvider(args.platform)
    return provider.fetchPostMetrics(this.normalizeAccount(account), args.externalPostId)
  }

  async verifyPostOwnership(args: {
    platform: ContentPlatform
    creatorSellerId: string
    externalPostId: string
  }): Promise<boolean> {
    const accounts = await this.listPlatformAccounts({
      creator_seller_id: args.creatorSellerId,
      platform: args.platform,
    })
    const account = accounts[0]
    if (!account) return false
    const provider = this.getProvider(args.platform)
    try {
      return await provider.verifyPostOwnership(
        this.normalizeAccount(account),
        args.externalPostId
      )
    } catch {
      return false
    }
  }

  /**
   * Validate + dispatch an inbound webhook from an external content
   * platform. Returns normalized events. Caller is responsible for then
   * upserting into `creator-rewards.EngagementSnapshot` (this module
   * intentionally does not depend on creator-rewards).
   */
  async dispatchInbound(args: {
    platform: ContentPlatform
    headers: Record<string, string | string[] | undefined>
    rawBody: string | Buffer | null
    body: unknown
  }): Promise<NormalizedEvent[]> {
    const provider = this.getProvider(args.platform)
    if (!provider.handleInboundWebhook) return []

    // Signature pre-check for the webhook-generic provider, which uses
    // per-account secrets. Other providers handle their own signature
    // verification inside handleInboundWebhook (with platform-wide
    // secrets from env).
    if (args.platform === "custom") {
      const sig = readHeader(args.headers, "x-fbm-signature")
      const externalAccountId = (args.body as any)?.externalAccountId
      if (!sig || !externalAccountId || typeof externalAccountId !== "string") {
        throw new Error("custom webhook requires X-FBM-Signature + externalAccountId")
      }
      const accounts = await this.listPlatformAccounts({
        platform: "custom",
        external_account_id: externalAccountId,
      })
      const account = accounts[0]
      if (!account || !account.inbound_webhook_secret) {
        throw new Error("Unknown account for inbound custom webhook")
      }
      const ok = WebhookGenericProvider.verifySignature(
        args.rawBody ?? "",
        sig,
        account.inbound_webhook_secret
      )
      if (!ok) {
        throw new Error("Invalid X-FBM-Signature for custom webhook")
      }
    }

    const result = await provider.handleInboundWebhook({
      headers: args.headers,
      rawBody: args.rawBody,
      body: args.body,
    })
    return result.events
  }

  private normalizeAccount(account: any): NormalizedPlatformAccount {
    return {
      id: account.id,
      creator_seller_id: account.creator_seller_id,
      platform: account.platform as ContentPlatform,
      external_account_id: account.external_account_id,
      handle: account.handle ?? null,
      access_token_encrypted: account.access_token_encrypted ?? null,
      refresh_token_encrypted: account.refresh_token_encrypted ?? null,
      token_expires_at: account.token_expires_at
        ? new Date(account.token_expires_at)
        : null,
      scopes: (account.scopes as string[] | null) ?? null,
      inbound_webhook_secret: account.inbound_webhook_secret ?? null,
      metadata: (account.metadata as Record<string, unknown> | null) ?? null,
    }
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

export default ContentPlatformService

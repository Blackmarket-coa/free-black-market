import {
  ContentPlatformProvider,
  ExchangeCodeResult,
  NormalizedPlatformAccount,
  ProviderMetrics,
  ProviderNotSupportedError,
  RefreshResult,
  VerifyAccountResult,
} from "./types"

/**
 * TikTok adapter scaffold.
 *
 * Loaded only when `TIKTOK_CLIENT_KEY` is set. Real implementation depends
 * on TikTok for Developers OAuth + Display API; the methods below define
 * the seam, with TODO markers calling out each network call.
 *
 * Env vars:
 *   TIKTOK_CLIENT_KEY
 *   TIKTOK_CLIENT_SECRET
 *   TIKTOK_WEBHOOK_SECRET (for inbound webhook signature verification)
 */
export class TikTokProvider implements ContentPlatformProvider {
  readonly platform = "tiktok" as const

  private get clientKey(): string {
    return process.env.TIKTOK_CLIENT_KEY ?? ""
  }

  buildAuthUrl(args: { state: string; redirectUri: string; scopes?: string[] }): string {
    // TODO: switch to https://www.tiktok.com/v2/auth/authorize/ when impl ready
    const scope = (args.scopes ?? ["user.info.basic", "video.list"]).join(",")
    const params = new URLSearchParams({
      client_key: this.clientKey,
      redirect_uri: args.redirectUri,
      response_type: "code",
      scope,
      state: args.state,
    })
    return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`
  }

  async exchangeCode(): Promise<ExchangeCodeResult> {
    // TODO: POST https://open.tiktokapis.com/v2/oauth/token/
    throw new ProviderNotSupportedError(this.platform, "exchangeCode (pending impl)")
  }

  async refresh(): Promise<RefreshResult> {
    // TODO: POST https://open.tiktokapis.com/v2/oauth/token/ with grant_type=refresh_token
    throw new ProviderNotSupportedError(this.platform, "refresh (pending impl)")
  }

  async verifyAccount(): Promise<VerifyAccountResult> {
    // TODO: GET https://open.tiktokapis.com/v2/user/info/
    return { ok: false, reason: "pending_impl" }
  }

  async verifyPostOwnership(
    _account: NormalizedPlatformAccount,
    _externalPostId: string
  ): Promise<boolean> {
    // TODO: GET https://open.tiktokapis.com/v2/video/query/ filtered to creator's videos
    return false
  }

  async fetchPostMetrics(): Promise<ProviderMetrics> {
    // TODO: GET https://open.tiktokapis.com/v2/video/query/ with stats fields
    throw new ProviderNotSupportedError(this.platform, "fetchPostMetrics (pending impl)")
  }
}

import {
  ContentPlatformProvider,
  ExchangeCodeResult,
  ProviderMetrics,
  ProviderNotSupportedError,
  RefreshResult,
  VerifyAccountResult,
} from "./types"

/**
 * Instagram adapter scaffold.
 *
 * Loaded when `META_APP_ID` is set. Uses Meta Graph API Business Login.
 *
 * Env vars: META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN.
 */
export class InstagramProvider implements ContentPlatformProvider {
  readonly platform = "instagram" as const

  buildAuthUrl(args: { state: string; redirectUri: string; scopes?: string[] }): string {
    const params = new URLSearchParams({
      client_id: process.env.META_APP_ID ?? "",
      redirect_uri: args.redirectUri,
      response_type: "code",
      scope: (args.scopes ?? ["instagram_basic", "instagram_manage_insights", "pages_show_list"]).join(","),
      state: args.state,
    })
    return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`
  }

  async exchangeCode(): Promise<ExchangeCodeResult> {
    // TODO: POST https://graph.facebook.com/v19.0/oauth/access_token
    throw new ProviderNotSupportedError(this.platform, "exchangeCode (pending impl)")
  }

  async refresh(): Promise<RefreshResult> {
    // TODO: GET https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token
    throw new ProviderNotSupportedError(this.platform, "refresh (pending impl)")
  }

  async verifyAccount(): Promise<VerifyAccountResult> {
    return { ok: false, reason: "pending_impl" }
  }

  async verifyPostOwnership(): Promise<boolean> {
    return false
  }

  async fetchPostMetrics(): Promise<ProviderMetrics> {
    // TODO: GET /{ig-media-id}/insights?metric=impressions,reach,engagement
    throw new ProviderNotSupportedError(this.platform, "fetchPostMetrics (pending impl)")
  }
}

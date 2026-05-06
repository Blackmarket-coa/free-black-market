import {
  ContentPlatformProvider,
  ExchangeCodeResult,
  ProviderMetrics,
  ProviderNotSupportedError,
  RefreshResult,
  VerifyAccountResult,
} from "./types"

/**
 * Twitch adapter scaffold. Loaded when `TWITCH_CLIENT_ID` is set.
 * Uses Twitch Helix API. Env: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET.
 */
export class TwitchProvider implements ContentPlatformProvider {
  readonly platform = "twitch" as const

  buildAuthUrl(args: { state: string; redirectUri: string; scopes?: string[] }): string {
    const params = new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID ?? "",
      redirect_uri: args.redirectUri,
      response_type: "code",
      scope: (args.scopes ?? ["user:read:email", "channel:read:subscriptions"]).join(" "),
      state: args.state,
    })
    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`
  }

  async exchangeCode(): Promise<ExchangeCodeResult> {
    // TODO: POST https://id.twitch.tv/oauth2/token
    throw new ProviderNotSupportedError(this.platform, "exchangeCode (pending impl)")
  }

  async refresh(): Promise<RefreshResult> {
    throw new ProviderNotSupportedError(this.platform, "refresh (pending impl)")
  }

  async verifyAccount(): Promise<VerifyAccountResult> {
    return { ok: false, reason: "pending_impl" }
  }

  async verifyPostOwnership(): Promise<boolean> {
    return false
  }

  async fetchPostMetrics(): Promise<ProviderMetrics> {
    // TODO: GET https://api.twitch.tv/helix/videos
    throw new ProviderNotSupportedError(this.platform, "fetchPostMetrics (pending impl)")
  }
}

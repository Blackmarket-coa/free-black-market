import {
  ContentPlatformProvider,
  ExchangeCodeResult,
  ProviderMetrics,
  ProviderNotSupportedError,
  RefreshResult,
  VerifyAccountResult,
} from "./types"

/**
 * YouTube adapter scaffold.
 *
 * Loaded when `GOOGLE_CLIENT_ID` is set. Uses Google OAuth + YouTube Data
 * API v3.
 *
 * Env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
 */
export class YouTubeProvider implements ContentPlatformProvider {
  readonly platform = "youtube" as const

  buildAuthUrl(args: { state: string; redirectUri: string; scopes?: string[] }): string {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      redirect_uri: args.redirectUri,
      response_type: "code",
      scope: (args.scopes ?? ["https://www.googleapis.com/auth/youtube.readonly"]).join(" "),
      access_type: "offline",
      prompt: "consent",
      state: args.state,
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }

  async exchangeCode(): Promise<ExchangeCodeResult> {
    // TODO: POST https://oauth2.googleapis.com/token
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
    // TODO: GET https://www.googleapis.com/youtube/v3/videos?part=statistics&id=...
    throw new ProviderNotSupportedError(this.platform, "fetchPostMetrics (pending impl)")
  }
}

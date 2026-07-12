import {
  ContentPlatformProvider,
  ExchangeCodeResult,
  NormalizedPlatformAccount,
  ProviderMetrics,
  RefreshResult,
  VerifyAccountResult,
} from "./types"
import {
  accountToken,
  bearer,
  expiresAtFromSeconds,
  getJson,
  postForm,
  toMetrics,
} from "./http"

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"

/**
 * YouTube adapter. Loaded when `GOOGLE_CLIENT_ID` is set. Uses Google OAuth +
 * YouTube Data API v3.
 *
 * Env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
 */
export class YouTubeProvider implements ContentPlatformProvider {
  readonly platform = "youtube" as const

  private get clientId(): string {
    return process.env.GOOGLE_CLIENT_ID ?? ""
  }

  private get clientSecret(): string {
    return process.env.GOOGLE_CLIENT_SECRET ?? ""
  }

  buildAuthUrl(args: { state: string; redirectUri: string; scopes?: string[] }): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: args.redirectUri,
      response_type: "code",
      scope: (args.scopes ?? ["https://www.googleapis.com/auth/youtube.readonly"]).join(" "),
      access_type: "offline",
      prompt: "consent",
      state: args.state,
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }

  async exchangeCode(code: string, redirectUri: string): Promise<ExchangeCodeResult> {
    const token = await postForm(this.platform, TOKEN_URL, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    })

    const access = token.access_token as string
    let externalAccountId = ""
    let handle: string | undefined
    let followerCount: number | undefined
    try {
      const channel = await this.fetchOwnChannel(access)
      externalAccountId = channel.id
      handle = channel.title
      followerCount = channel.subscriberCount
    } catch {
      // Channel lookup is best-effort at connect time.
    }

    return {
      access,
      refresh: token.refresh_token ?? undefined,
      expiresAt: expiresAtFromSeconds(token.expires_in),
      externalAccountId,
      handle,
      followerCount,
      scopes:
        typeof token.scope === "string" && token.scope.length
          ? (token.scope as string).split(" ")
          : undefined,
    }
  }

  async refresh(refreshToken: string): Promise<RefreshResult> {
    const token = await postForm(this.platform, TOKEN_URL, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    })
    return {
      access: token.access_token as string,
      refresh: token.refresh_token ?? undefined,
      expiresAt: expiresAtFromSeconds(token.expires_in),
    }
  }

  async verifyAccount(account: NormalizedPlatformAccount): Promise<VerifyAccountResult> {
    try {
      const channel = await this.fetchOwnChannel(accountToken(account))
      return { ok: true, followerCount: channel.subscriberCount }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "verify_failed" }
    }
  }

  async verifyPostOwnership(
    account: NormalizedPlatformAccount,
    externalPostId: string
  ): Promise<boolean> {
    try {
      const res = await getJson(this.platform, VIDEOS_URL, {
        headers: bearer(accountToken(account)),
        query: { part: "snippet", id: externalPostId },
      })
      const item = ((res?.items ?? []) as Array<any>)[0]
      return !!item && item.snippet?.channelId === account.external_account_id
    } catch {
      return false
    }
  }

  async fetchPostMetrics(
    account: NormalizedPlatformAccount,
    externalPostId: string
  ): Promise<ProviderMetrics> {
    const res = await getJson(this.platform, VIDEOS_URL, {
      headers: bearer(accountToken(account)),
      query: { part: "statistics", id: externalPostId },
    })
    const stats = (((res?.items ?? []) as Array<any>)[0]?.statistics ?? {}) as Record<
      string,
      unknown
    >
    return toMetrics({
      views: stats.viewCount,
      likes: stats.likeCount,
      comments: stats.commentCount,
      // YouTube Data API exposes no share count.
      raw: stats,
    })
  }

  private async fetchOwnChannel(
    accessToken: string
  ): Promise<{ id: string; title?: string; subscriberCount?: number }> {
    const res = await getJson(this.platform, CHANNELS_URL, {
      headers: bearer(accessToken),
      query: { part: "snippet,statistics", mine: "true" },
    })
    const item = ((res?.items ?? []) as Array<any>)[0] ?? {}
    return {
      id: (item.id as string) ?? "",
      title: item.snippet?.title,
      subscriberCount:
        item.statistics?.subscriberCount === undefined
          ? undefined
          : Number(item.statistics.subscriberCount),
    }
  }
}

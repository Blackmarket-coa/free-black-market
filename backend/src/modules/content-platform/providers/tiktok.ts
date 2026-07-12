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
  postJson,
  toMetrics,
} from "./http"

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
const USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/"
const VIDEO_QUERY_URL = "https://open.tiktokapis.com/v2/video/query/"

/**
 * TikTok adapter. Loaded only when `TIKTOK_CLIENT_KEY` is set. Implements the
 * TikTok for Developers OAuth v2 + Display API.
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

  private get clientSecret(): string {
    return process.env.TIKTOK_CLIENT_SECRET ?? ""
  }

  buildAuthUrl(args: { state: string; redirectUri: string; scopes?: string[] }): string {
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

  async exchangeCode(code: string, redirectUri: string): Promise<ExchangeCodeResult> {
    const token = await postForm(this.platform, TOKEN_URL, {
      client_key: this.clientKey,
      client_secret: this.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    })

    const access = token.access_token as string
    let handle: string | undefined
    let followerCount: number | undefined
    try {
      const info = await this.fetchUserInfo(access)
      handle = info.handle
      followerCount = info.followerCount
    } catch {
      // User-info is best-effort at connect time; the token exchange is what
      // determines success.
    }

    return {
      access,
      refresh: token.refresh_token ?? undefined,
      expiresAt: expiresAtFromSeconds(token.expires_in),
      externalAccountId: (token.open_id as string) ?? handle ?? "",
      handle,
      followerCount,
      scopes:
        typeof token.scope === "string" && token.scope.length
          ? (token.scope as string).split(",")
          : undefined,
    }
  }

  async refresh(refreshToken: string): Promise<RefreshResult> {
    const token = await postForm(this.platform, TOKEN_URL, {
      client_key: this.clientKey,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
    return {
      access: token.access_token as string,
      refresh: token.refresh_token ?? undefined,
      expiresAt: expiresAtFromSeconds(token.expires_in),
    }
  }

  async verifyAccount(account: NormalizedPlatformAccount): Promise<VerifyAccountResult> {
    try {
      const info = await this.fetchUserInfo(accountToken(account))
      return { ok: true, followerCount: info.followerCount }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "verify_failed" }
    }
  }

  async verifyPostOwnership(
    account: NormalizedPlatformAccount,
    externalPostId: string
  ): Promise<boolean> {
    try {
      const res = await postJson(
        this.platform,
        `${VIDEO_QUERY_URL}?fields=id`,
        { filters: { video_ids: [externalPostId] } },
        bearer(accountToken(account))
      )
      const videos = (res?.data?.videos ?? []) as Array<{ id?: string }>
      return videos.some((v) => v.id === externalPostId)
    } catch {
      return false
    }
  }

  async fetchPostMetrics(
    account: NormalizedPlatformAccount,
    externalPostId: string
  ): Promise<ProviderMetrics> {
    const res = await postJson(
      this.platform,
      `${VIDEO_QUERY_URL}?fields=id,like_count,comment_count,share_count,view_count`,
      { filters: { video_ids: [externalPostId] } },
      bearer(accountToken(account))
    )
    const video = ((res?.data?.videos ?? []) as Array<Record<string, unknown>>)[0] ?? {}
    return toMetrics({
      views: video.view_count,
      likes: video.like_count,
      comments: video.comment_count,
      shares: video.share_count,
      raw: video,
    })
  }

  private async fetchUserInfo(
    accessToken: string
  ): Promise<{ handle?: string; followerCount?: number }> {
    const res = await getJson(this.platform, USER_INFO_URL, {
      headers: bearer(accessToken),
      query: { fields: "open_id,display_name,follower_count" },
    })
    const user = (res?.data?.user ?? {}) as Record<string, unknown>
    return {
      handle: typeof user.display_name === "string" ? user.display_name : undefined,
      followerCount:
        user.follower_count === undefined ? undefined : Number(user.follower_count),
    }
  }
}

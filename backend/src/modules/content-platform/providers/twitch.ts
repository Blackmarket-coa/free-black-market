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
  toCount,
  toMetrics,
} from "./http"

const TOKEN_URL = "https://id.twitch.tv/oauth2/token"
const USERS_URL = "https://api.twitch.tv/helix/users"
const FOLLOWERS_URL = "https://api.twitch.tv/helix/channels/followers"
const VIDEOS_URL = "https://api.twitch.tv/helix/videos"

/**
 * Twitch adapter. Loaded when `TWITCH_CLIENT_ID` is set. Uses the Twitch Helix
 * API. Env: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET.
 */
export class TwitchProvider implements ContentPlatformProvider {
  readonly platform = "twitch" as const

  private get clientId(): string {
    return process.env.TWITCH_CLIENT_ID ?? ""
  }

  private get clientSecret(): string {
    return process.env.TWITCH_CLIENT_SECRET ?? ""
  }

  /** Helix requires both the bearer token and the Client-Id header. */
  private helixHeaders(token: string): Record<string, string> {
    return { ...bearer(token), "Client-Id": this.clientId }
  }

  buildAuthUrl(args: { state: string; redirectUri: string; scopes?: string[] }): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: args.redirectUri,
      response_type: "code",
      scope: (args.scopes ?? ["user:read:email", "channel:read:subscriptions"]).join(" "),
      state: args.state,
    })
    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`
  }

  async exchangeCode(code: string, redirectUri: string): Promise<ExchangeCodeResult> {
    const token = await postForm(this.platform, TOKEN_URL, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    })

    const access = token.access_token as string
    let externalAccountId = ""
    let handle: string | undefined
    let followerCount: number | undefined
    try {
      const user = await this.fetchOwnUser(access)
      externalAccountId = user.id
      handle = user.login
      followerCount = await this.fetchFollowerCount(access, user.id)
    } catch {
      // User lookup is best-effort at connect time.
    }

    return {
      access,
      refresh: token.refresh_token ?? undefined,
      expiresAt: expiresAtFromSeconds(token.expires_in),
      externalAccountId,
      handle,
      followerCount,
      scopes: Array.isArray(token.scope) ? (token.scope as string[]) : undefined,
    }
  }

  async refresh(refreshToken: string): Promise<RefreshResult> {
    const token = await postForm(this.platform, TOKEN_URL, {
      client_id: this.clientId,
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
      const token = accountToken(account)
      const user = await this.fetchOwnUser(token)
      const followerCount = await this.fetchFollowerCount(token, user.id)
      return { ok: true, followerCount }
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
        headers: this.helixHeaders(accountToken(account)),
        query: { id: externalPostId },
      })
      const video = ((res?.data ?? []) as Array<any>)[0]
      return !!video && video.user_id === account.external_account_id
    } catch {
      return false
    }
  }

  async fetchPostMetrics(
    account: NormalizedPlatformAccount,
    externalPostId: string
  ): Promise<ProviderMetrics> {
    const res = await getJson(this.platform, VIDEOS_URL, {
      headers: this.helixHeaders(accountToken(account)),
      query: { id: externalPostId },
    })
    const video = (((res?.data ?? []) as Array<any>)[0] ?? {}) as Record<string, unknown>
    return toMetrics({
      // Helix `videos` exposes view_count only; likes/comments/shares are not
      // available on the VOD endpoint.
      views: video.view_count,
      raw: video,
    })
  }

  private async fetchOwnUser(
    accessToken: string
  ): Promise<{ id: string; login?: string }> {
    const res = await getJson(this.platform, USERS_URL, {
      headers: this.helixHeaders(accessToken),
    })
    const user = ((res?.data ?? []) as Array<any>)[0] ?? {}
    return { id: (user.id as string) ?? "", login: user.login }
  }

  private async fetchFollowerCount(
    accessToken: string,
    broadcasterId: string
  ): Promise<number | undefined> {
    if (!broadcasterId) {
      return undefined
    }
    const res = await getJson(this.platform, FOLLOWERS_URL, {
      headers: this.helixHeaders(accessToken),
      query: { broadcaster_id: broadcasterId },
    })
    return res?.total === undefined ? undefined : toCount(res.total)
  }
}

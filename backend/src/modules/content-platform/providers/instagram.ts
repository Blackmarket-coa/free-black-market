import {
  ContentPlatformProvider,
  ExchangeCodeResult,
  NormalizedPlatformAccount,
  ProviderMetrics,
  RefreshResult,
  VerifyAccountResult,
} from "./types"
import { accountToken, expiresAtFromSeconds, getJson, toMetrics } from "./http"

const GRAPH = "https://graph.facebook.com/v19.0"
const TOKEN_URL = `${GRAPH}/oauth/access_token`

/**
 * Instagram adapter. Loaded when `META_APP_ID` is set. Uses the Meta Graph API
 * (Facebook Login → Instagram Graph). Tokens are Facebook user access tokens;
 * the adapter resolves the linked Instagram business account for metrics.
 *
 * Env vars: META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN.
 */
export class InstagramProvider implements ContentPlatformProvider {
  readonly platform = "instagram" as const

  private get appId(): string {
    return process.env.META_APP_ID ?? ""
  }

  private get appSecret(): string {
    return process.env.META_APP_SECRET ?? ""
  }

  buildAuthUrl(args: { state: string; redirectUri: string; scopes?: string[] }): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: args.redirectUri,
      response_type: "code",
      scope: (
        args.scopes ?? ["instagram_basic", "instagram_manage_insights", "pages_show_list"]
      ).join(","),
      state: args.state,
    })
    return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`
  }

  async exchangeCode(code: string, redirectUri: string): Promise<ExchangeCodeResult> {
    // 1. Short-lived token from the auth code.
    const shortLived = await getJson(this.platform, TOKEN_URL, {
      query: {
        client_id: this.appId,
        client_secret: this.appSecret,
        redirect_uri: redirectUri,
        code,
      },
    })

    // 2. Exchange for a long-lived token (≈60 days).
    let access = shortLived.access_token as string
    let expiresIn = shortLived.expires_in as number | undefined
    try {
      const longLived = await getJson(this.platform, TOKEN_URL, {
        query: {
          grant_type: "fb_exchange_token",
          client_id: this.appId,
          client_secret: this.appSecret,
          fb_exchange_token: access,
        },
      })
      access = (longLived.access_token as string) ?? access
      expiresIn = (longLived.expires_in as number | undefined) ?? expiresIn
    } catch {
      // Fall back to the short-lived token if the exchange fails.
    }

    let externalAccountId = ""
    let handle: string | undefined
    try {
      const me = await getJson(this.platform, `${GRAPH}/me`, {
        query: { fields: "id,name", access_token: access },
      })
      externalAccountId = (me.id as string) ?? ""
      handle = me.name
    } catch {
      // Identity lookup is best-effort at connect time.
    }

    return {
      access,
      expiresAt: expiresAtFromSeconds(expiresIn),
      externalAccountId,
      handle,
    }
  }

  async refresh(refreshToken: string): Promise<RefreshResult> {
    // Meta long-lived tokens are refreshed by re-exchanging the current token.
    const res = await getJson(this.platform, TOKEN_URL, {
      query: {
        grant_type: "fb_exchange_token",
        client_id: this.appId,
        client_secret: this.appSecret,
        fb_exchange_token: refreshToken,
      },
    })
    return {
      access: res.access_token as string,
      expiresAt: expiresAtFromSeconds(res.expires_in),
    }
  }

  async verifyAccount(account: NormalizedPlatformAccount): Promise<VerifyAccountResult> {
    try {
      const me = await getJson(this.platform, `${GRAPH}/me`, {
        query: { fields: "id", access_token: accountToken(account) },
      })
      return { ok: !!me.id }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "verify_failed" }
    }
  }

  async verifyPostOwnership(
    account: NormalizedPlatformAccount,
    externalPostId: string
  ): Promise<boolean> {
    try {
      const media = await getJson(this.platform, `${GRAPH}/${externalPostId}`, {
        query: { fields: "owner,username", access_token: accountToken(account) },
      })
      const ownerId = media.owner?.id ?? media.owner
      return (
        ownerId === account.external_account_id ||
        media.username === (account.handle ?? undefined)
      )
    } catch {
      return false
    }
  }

  async fetchPostMetrics(
    account: NormalizedPlatformAccount,
    externalPostId: string
  ): Promise<ProviderMetrics> {
    const token = accountToken(account)
    // Base engagement counts live on the media node.
    const media = await getJson(this.platform, `${GRAPH}/${externalPostId}`, {
      query: {
        fields: "like_count,comments_count",
        access_token: token,
      },
    })

    // Reach / impressions / saves come from the insights edge (best-effort —
    // requires an IG business/creator account).
    let insights: Record<string, number> = {}
    try {
      const res = await getJson(this.platform, `${GRAPH}/${externalPostId}/insights`, {
        query: { metric: "impressions,reach,saved,shares", access_token: token },
      })
      insights = Object.fromEntries(
        ((res?.data ?? []) as Array<any>).map((m) => [
          m.name,
          Number(m.values?.[0]?.value ?? 0),
        ])
      )
    } catch {
      // Insights unavailable (personal account / permissions) — engagement
      // counts still return.
    }

    return toMetrics({
      views: insights.impressions ?? insights.reach,
      qualified_views: insights.reach,
      likes: media.like_count,
      comments: media.comments_count,
      shares: insights.shares,
      saves: insights.saved,
      raw: { media, insights },
    })
  }
}

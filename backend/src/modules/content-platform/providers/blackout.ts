import {
  ContentPlatformProvider,
  ExchangeCodeResult,
  InboundWebhookRequest,
  NormalizedEvent,
  NormalizedPlatformAccount,
  ProviderMetrics,
  ProviderNotSupportedError,
  RefreshResult,
  VerifyAccountResult,
} from "./types"

/**
 * Blackout adapter scaffold (sister project deep integration).
 *
 * Loaded when `FBM_BLACKOUT_INTEGRATION=1` and `BLACKOUT_API_BASE` is set.
 *
 * Env vars:
 *   FBM_BLACKOUT_INTEGRATION   feature flag (must be "1")
 *   BLACKOUT_API_BASE          base URL of the Blackout API
 *   BLACKOUT_CLIENT_ID         OAuth client id
 *   BLACKOUT_CLIENT_SECRET     OAuth client secret
 *   BLACKOUT_WEBHOOK_SECRET    HMAC secret for inbound webhook verification
 *
 * Implementation paused until the Blackout API spec is shared. The
 * scaffolding below establishes the integration contract:
 *
 *   - OAuth: `${BLACKOUT_API_BASE}/oauth/authorize` + `/oauth/token`
 *   - Account info: `${BLACKOUT_API_BASE}/me`
 *   - Post metrics: `${BLACKOUT_API_BASE}/posts/:id/metrics`
 *   - Inbound webhook: signed with `BLACKOUT_WEBHOOK_SECRET`, headers
 *     follow the same `X-FBM-Signature: sha256=<hex>` convention as
 *     marketplace-webhooks emits, so symmetric handling on both sides.
 *
 * Bidirectional sync target:
 *   Blackout posts containing FBM affiliate links auto-create ContentPost
 *   rows on this side; Blackout subscribes to creator.commission.approved
 *   webhooks on its side to surface creator earnings inline in the
 *   Blackout UI.
 */
export class BlackoutProvider implements ContentPlatformProvider {
  readonly platform = "blackout" as const

  private base(): string {
    return (process.env.BLACKOUT_API_BASE ?? "").replace(/\/$/, "")
  }

  buildAuthUrl(args: { state: string; redirectUri: string; scopes?: string[] }): string {
    const params = new URLSearchParams({
      client_id: process.env.BLACKOUT_CLIENT_ID ?? "",
      redirect_uri: args.redirectUri,
      response_type: "code",
      scope: (args.scopes ?? ["profile", "posts:read", "metrics:read"]).join(" "),
      state: args.state,
    })
    return `${this.base()}/oauth/authorize?${params.toString()}`
  }

  async exchangeCode(): Promise<ExchangeCodeResult> {
    // TODO: POST `${this.base()}/oauth/token` once Blackout API spec is shared
    throw new ProviderNotSupportedError(this.platform, "exchangeCode (awaiting Blackout API spec)")
  }

  async refresh(): Promise<RefreshResult> {
    throw new ProviderNotSupportedError(this.platform, "refresh (awaiting Blackout API spec)")
  }

  async verifyAccount(_account: NormalizedPlatformAccount): Promise<VerifyAccountResult> {
    // TODO: GET `${this.base()}/me`
    return { ok: false, reason: "awaiting_blackout_api_spec" }
  }

  async verifyPostOwnership(): Promise<boolean> {
    // TODO: GET `${this.base()}/posts/:id` and check author == account.external_account_id
    return false
  }

  async fetchPostMetrics(): Promise<ProviderMetrics> {
    // TODO: GET `${this.base()}/posts/:id/metrics`
    throw new ProviderNotSupportedError(this.platform, "fetchPostMetrics (awaiting Blackout API spec)")
  }

  async handleInboundWebhook(
    _req: InboundWebhookRequest
  ): Promise<{ events: NormalizedEvent[]; externalAccountId?: string | null }> {
    // TODO: verify HMAC against BLACKOUT_WEBHOOK_SECRET, normalize payload
    return { events: [] }
  }
}

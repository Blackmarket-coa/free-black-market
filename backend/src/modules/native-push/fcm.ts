import crypto from "crypto"

/**
 * Minimal FCM HTTP v1 sender — no firebase-admin dependency.
 *
 * firebase-admin pulls a very large dependency tree for what is, for our
 * purposes, two HTTP calls: a service-account JWT exchanged for an OAuth
 * access token, and per-token POSTs to the FCM v1 `messages:send`
 * endpoint. Both are implemented here with node crypto + fetch so the
 * lockfile stays small and the CVE-pinning surface doesn't grow.
 *
 * Configuration (fail-closed): set `FCM_SERVICE_ACCOUNT_JSON` to the
 * Firebase service account JSON — raw, or base64-encoded for env systems
 * that dislike multiline values. Unset ⇒ `isConfigured()` is false and
 * every send resolves to `{ configured: false }` without touching the
 * network. FCM covers Android directly and iOS via Firebase's APNs bridge
 * (upload the APNs key in the Firebase console).
 */

export type FcmServiceAccount = {
  project_id: string
  client_email: string
  private_key: string
}

export type FcmNotification = {
  title: string
  body: string
  /** Optional key/value payload; FCM v1 requires string values. */
  data?: Record<string, string>
}

export type FcmSendSummary = {
  configured: boolean
  sent: string[]
  /** Tokens FCM reported as gone (unregistered/invalid) — disable these. */
  invalid: string[]
  /** Tokens that failed for transient/other reasons — keep and retry later. */
  failed: string[]
}

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"

/**
 * Parse the service-account env value (raw JSON or base64 JSON). Returns
 * null for anything unusable — callers treat that as "not configured".
 */
export function parseServiceAccount(
  raw: string | null | undefined
): FcmServiceAccount | null {
  if (!raw || !raw.trim()) return null
  let text = raw.trim()
  if (!text.startsWith("{")) {
    try {
      text = Buffer.from(text, "base64").toString("utf8")
    } catch {
      return null
    }
  }
  try {
    const parsed = JSON.parse(text) as Partial<FcmServiceAccount>
    if (
      typeof parsed.project_id === "string" &&
      parsed.project_id &&
      typeof parsed.client_email === "string" &&
      parsed.client_email &&
      typeof parsed.private_key === "string" &&
      parsed.private_key.includes("PRIVATE KEY")
    ) {
      return {
        project_id: parsed.project_id,
        client_email: parsed.client_email,
        private_key: parsed.private_key,
      }
    }
    return null
  } catch {
    return null
  }
}

/** Build the FCM v1 message envelope for one device token. Pure. */
export function buildFcmMessage(
  token: string,
  notification: FcmNotification
): Record<string, unknown> {
  const data: Record<string, string> = {}
  for (const [key, value] of Object.entries(notification.data ?? {})) {
    data[key] = String(value)
  }
  return {
    message: {
      token,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      ...(Object.keys(data).length > 0 ? { data } : {}),
    },
  }
}

/**
 * Classify a non-2xx FCM response: is the token dead (stop sending to it)
 * or was this a transient/other failure (keep the token)? Pure.
 *
 * FCM v1 signals a dead token with HTTP 404 + UNREGISTERED, and a
 * malformed one with 400 + INVALID_ARGUMENT.
 */
export function isTokenGoneError(status: number, body: string): boolean {
  if (status === 404) return true
  const upper = body.toUpperCase()
  if (upper.includes("UNREGISTERED")) return true
  if (status === 400 && upper.includes("INVALID_ARGUMENT")) return true
  return false
}

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url")

/** Sign a service-account JWT for the FCM scope. */
function buildAssertion(account: FcmServiceAccount, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: FCM_SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    })
  )
  const unsigned = `${header}.${claims}`
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(account.private_key)
  return `${unsigned}.${base64url(signature)}`
}

type CachedAccessToken = { token: string; expiresAt: number }

export class FcmClient {
  private readonly account: FcmServiceAccount | null
  private cachedToken: CachedAccessToken | null = null

  constructor(rawServiceAccount?: string | null) {
    this.account = parseServiceAccount(
      rawServiceAccount ?? process.env.FCM_SERVICE_ACCOUNT_JSON
    )
  }

  isConfigured(): boolean {
    return this.account !== null
  }

  private async getAccessToken(): Promise<string> {
    if (!this.account) throw new Error("FCM is not configured")
    const now = Date.now()
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60_000) {
      return this.cachedToken.token
    }

    const assertion = buildAssertion(this.account, Math.floor(now / 1000))
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    })
    if (!response.ok) {
      throw new Error(
        `FCM token exchange failed: ${response.status} ${await response.text()}`
      )
    }
    const json = (await response.json()) as {
      access_token?: string
      expires_in?: number
    }
    if (!json.access_token) {
      throw new Error("FCM token exchange returned no access_token")
    }
    this.cachedToken = {
      token: json.access_token,
      expiresAt: now + (json.expires_in ?? 3600) * 1000,
    }
    return json.access_token
  }

  /**
   * Send one notification to many tokens. Never throws for per-token
   * failures — the summary says which tokens were delivered, which are
   * dead (caller should disable them), and which failed transiently.
   */
  async sendToTokens(
    tokens: string[],
    notification: FcmNotification
  ): Promise<FcmSendSummary> {
    const summary: FcmSendSummary = {
      configured: this.isConfigured(),
      sent: [],
      invalid: [],
      failed: [],
    }
    if (!this.account || tokens.length === 0) return summary

    let accessToken: string
    try {
      accessToken = await this.getAccessToken()
    } catch {
      summary.failed.push(...tokens)
      return summary
    }

    const endpoint = `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`
    for (const token of tokens) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(buildFcmMessage(token, notification)),
        })
        if (response.ok) {
          summary.sent.push(token)
        } else {
          const body = await response.text()
          if (isTokenGoneError(response.status, body)) {
            summary.invalid.push(token)
          } else {
            summary.failed.push(token)
          }
        }
      } catch {
        summary.failed.push(token)
      }
    }
    return summary
  }
}

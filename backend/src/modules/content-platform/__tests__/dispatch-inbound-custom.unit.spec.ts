/**
 * The `custom` inbound webhook is verified against the bytes that were sent.
 *
 * `dispatchInbound` verified `args.rawBody ?? ""`, and no matcher preserved
 * the raw body for `/v1/webhooks/content-platform/:platform`, so it always
 * verified the HMAC of an empty string. On Postgres: a signature over the
 * body actually sent was 401, and `sha256=HMAC(secret, "")` — one constant per
 * account, whatever the payload said — was 200. The matcher now preserves the
 * raw body (`middlewares/bare-prefix-auth.ts`); this is the service refusing
 * when it is absent rather than verifying nothing.
 */
import { createHmac } from "crypto"
import ContentPlatformService from "../service"
import { WebhookGenericProvider } from "../providers/webhook-generic"

const SECRET = "s3cret-of-the-account"
const body = { externalAccountId: "acct_1", type: "post.metrics_updated", externalPostId: "p1", metrics: { views: 999999 } }
const raw = JSON.stringify(body)
const sign = (over: string | Buffer, key = SECRET) => "sha256=" + createHmac("sha256", key).update(over).digest("hex")

// The real method on a stand-in `this`: the real generic provider, and the
// account lookup the module would run.
const dispatch = (args: { rawBody: string | Buffer | null; signature?: string; accounts?: unknown[] }) => {
  const self = {
    getProvider: () => new WebhookGenericProvider(),
    listPlatformAccounts: jest.fn(async () => args.accounts ?? [{ id: "pa_1", inbound_webhook_secret: SECRET }]),
  }
  return ContentPlatformService.prototype.dispatchInbound.call(self as unknown as ContentPlatformService, {
    platform: "custom",
    headers: args.signature ? { "x-fbm-signature": args.signature } : {},
    rawBody: args.rawBody,
    body,
  })
}

describe("ContentPlatformService.dispatchInbound, custom platform", () => {
  it("accepts a signature over the raw body, as a string or a Buffer", async () => {
    for (const rawBody of [raw, Buffer.from(raw)]) {
      const events = await dispatch({ rawBody, signature: sign(raw) })
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: "post.metrics_updated", externalAccountId: "acct_1", externalPostId: "p1" })
    }
  })

  it("refuses when the raw body is missing, whatever the signature covers", async () => {
    for (const rawBody of [null, "", Buffer.alloc(0)]) {
      for (const signature of [sign(""), sign(raw)]) {
        await expect(dispatch({ rawBody, signature })).rejects.toThrow("cannot be verified without its raw body")
      }
    }
  })

  it("refuses the signature of the empty string when a body was sent", async () => {
    await expect(dispatch({ rawBody: raw, signature: sign("") })).rejects.toThrow("Invalid X-FBM-Signature")
  })

  it("refuses a signature over another body, another account's secret, and no signature", async () => {
    await expect(dispatch({ rawBody: raw, signature: sign(raw.replace("999999", "1")) })).rejects.toThrow("Invalid X-FBM-Signature")
    await expect(dispatch({ rawBody: raw, signature: sign(raw, "other-secret") })).rejects.toThrow("Invalid X-FBM-Signature")
    await expect(dispatch({ rawBody: raw })).rejects.toThrow("requires X-FBM-Signature")
  })

  it("refuses an account with no secret on record", async () => {
    await expect(dispatch({ rawBody: raw, signature: sign(raw), accounts: [{ id: "pa_1", inbound_webhook_secret: null }] })).rejects.toThrow(
      "Unknown account"
    )
    await expect(dispatch({ rawBody: raw, signature: sign(raw), accounts: [] })).rejects.toThrow("Unknown account")
  })
})

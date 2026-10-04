import Stripe from "stripe"
import { applyStripeConnectEvent, POST } from "../route"
import { COLLECTIVE_CAMPAIGN_MODULE } from "../../../../modules/collective-campaign"
import { DONATION_MODULE } from "../../../../modules/donation"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import { PARTNER_DIRECTORY_MODULE } from "../../../../modules/partner-directory"
import { STRIPE_CONNECT_WEBHOOK_SECRET_ENV } from "../../../../modules/stripe-connect-direct/registration"
import { PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"
import { makeInMemoryDirectory, type OrgRow } from "../../../../modules/partner-directory/__tests__/in-memory-partner-orgs"
import { makeInMemoryDonations, type SplitRow } from "../../../../modules/donation/__tests__/in-memory-donation-splits"

/**
 * `POST /webhooks/stripe-connect` — connected-account events for direct-charge
 * donations (docs/POSTURE_A_COMPLIANCE.md rule 10).
 *
 * Signature verification is the REAL Stripe SDK: payloads are signed with
 * `Stripe.webhooks.generateTestHeaderString` and verified by the same
 * `constructEvent` the route uses, so "bad signature ⇒ 400" is exercised
 * end to end rather than mocked. Records go through the real donation service
 * (prototype + shadowed CRUD) and its guard; modules are keyed on their
 * imported constants and the scope throws on anything else.
 *
 * Pinned: dark (404, nothing read) with FF_NONPROFIT_PARITY_V1 off even when
 * the secret is set; 503 without the Connect secret; 400 for a missing or bad
 * signature or no raw body; events without `event.account` ignored; succeeded
 * / payment_failed / charge.refunded upsert the record idempotently by intent
 * id (processor first, record second); a partial refund records the amount
 * and keeps the status; an unknown intent is back-filled from a success only
 * when `event.account` IS the named org's connected account and the org is an
 * eligible recipient now, with Stripe's amount (never the metadata's); the
 * hawala ledger is never resolved; a payload carrying a forbidden Connect
 * parameter is refused.
 *
 * Shared-goal Coalition campaigns (Phase 1 item 3): a record carrying
 * `campaign_id` reports its gross to `recordParticipantContribution` on the
 * IMPORTED `COLLECTIVE_CAMPAIGN_MODULE`, keyed by the intent id, when it
 * enters `succeeded`; a serial replay, a fee-only update of a succeeded row and
 * a record with no campaign never reach the campaign module; two CONCURRENT
 * deliveries both reach it with the same intent id and the module's own
 * intent-keyed row decides (one `recorded`, one `already_recorded` — the
 * exactly-once proof over the real service is in
 * collective-campaign/__tests__/service.unit.spec.ts); a FULL refund reverses
 * the same intent, a partial refund does not; a module that cannot be resolved
 * or throws surfaces as `contribution: "failed"` on a 200.
 */

const FLAG = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1
const SECRET = "whsec_connect_test"
const ACCT = "acct_1GULP"
const AS_OF = new Date("2026-09-10T09:18:37Z")
const SNAP = new Date("2026-10-04T12:00:00Z")

type TestRes = {
  statusCode: number
  body: Record<string, unknown>
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}
const createRes = (): TestRes => {
  const res = { statusCode: 200, body: {} } as TestRes
  res.status = (c) => ((res.statusCode = c), res)
  res.json = (p) => ((res.body = p as Record<string, unknown>), res)
  return res
}

const gulp = (over: Partial<OrgRow> = {}): Partial<OrgRow> & { key: string; name: string } => ({
  key: "ground_up_liberation_project",
  name: "Ground Up Liberation Project",
  org_type: "irs_501c3",
  verification_status: "pub78_eligible",
  verified_as_of: AS_OF,
  stripe_connect_account_id: ACCT,
  published: true,
  ...over,
})

const existingRow = (over: Partial<SplitRow> = {}): SplitRow => ({
  id: "dsr_1",
  stripe_payment_intent_id: "pi_1",
  stripe_account_id: ACCT,
  org_key: "ground_up_liberation_project",
  campaign_id: null,
  kind: "donation",
  currency_code: "usd",
  gross_cents: 2500,
  bmc_fee_cents: 0,
  processor_fee_cents: null,
  recipient_org_type: "irs_501c3",
  recipient_verification_status: "pub78_eligible",
  recipient_verified_as_of: AS_OF,
  recipient_snapshot_at: SNAP,
  status: "created",
  customer_id: null,
  metadata: null,
  ...over,
})

const intentObject = (over: Record<string, unknown> = {}) => ({
  id: "pi_1",
  object: "payment_intent",
  status: "succeeded",
  amount: 2500,
  amount_received: 2500,
  currency: "usd",
  transfer_data: null,
  on_behalf_of: null,
  application_fee_amount: null,
  latest_charge: "ch_1",
  metadata: {},
  ...over,
})

/** `account: null` builds a platform event (no `account` field), the one shape this door ignores. */
const event = (type: string, object: Record<string, unknown>, account: string | null = ACCT) =>
  ({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: "event",
    type,
    ...(account === null ? {} : { account }),
    created: 1_700_000_000,
    livemode: false,
    api_version: "2024-12-18.acacia",
    data: { object },
  }) as unknown as Stripe.Event

function makeScope(
  opts: {
    rows?: SplitRow[]
    orgs?: Array<Partial<OrgRow> & { key: string; name: string }>
    /** What the campaign module answers; default: recorded. */
    contribution?: "recorded" | "no_participant" | "throws" | "unresolvable"
    /** What the campaign module answers a reversal; default: reversed. */
    reversal?: "reversed" | "not_recorded"
  } = {}
) {
  const dons = makeInMemoryDonations(opts.rows ?? [existingRow()])
  const dir = makeInMemoryDirectory(opts.orgs ?? [gulp()])
  const hawala = { processRefund: jest.fn(), createTransfer: jest.fn() }
  // Mirrors the real module's intent-keyed row: the same intent counts once.
  const counted = new Set<string>()
  const campaigns = {
    recordParticipantContribution: jest.fn(
      async (input: { campaign_id: string; partner_org_key: string; amount_cents: number; stripe_payment_intent_id: string }) => {
        if (opts.contribution === "throws") throw new Error("campaign write failed")
        if (opts.contribution === "no_participant") return { recorded: false as const, reason: "no_participant" as const, campaign_id: input.campaign_id }
        if (counted.has(input.stripe_payment_intent_id)) return { recorded: false as const, reason: "already_recorded" as const, campaign_id: input.campaign_id }
        counted.add(input.stripe_payment_intent_id)
        return { recorded: true as const, participant_id: "ccpart_1", campaign_id: input.campaign_id, contributed_amount_cents: input.amount_cents, campaign_total_cents: input.amount_cents, milestones_reached: [], status: "ACTIVE" }
      }
    ),
    reverseParticipantContribution: jest.fn(async (input: { campaign_id: string; stripe_payment_intent_id: string }) => {
      if (opts.reversal === "not_recorded") return { reversed: false as const, reason: "not_recorded" as const, campaign_id: input.campaign_id }
      return { reversed: true as const, participant_id: "ccpart_1", campaign_id: input.campaign_id, contributed_amount_cents: 0, campaign_total_cents: 0 }
    }),
  }
  const resolved: string[] = []
  const scope = {
    resolve: <T,>(key: string): T => {
      resolved.push(key)
      if (key === DONATION_MODULE) return dons.service as unknown as T
      if (key === PARTNER_DIRECTORY_MODULE) return dir.service as unknown as T
      if (key === HAWALA_LEDGER_MODULE) return hawala as unknown as T
      if (key === COLLECTIVE_CAMPAIGN_MODULE && opts.contribution !== "unresolvable") return campaigns as unknown as T
      throw new Error(`Could not resolve '${key}'`)
    },
  }
  return { scope, resolved, dons, dir, hawala, campaigns }
}

type Req = Parameters<typeof POST>[0]
type Res = Parameters<typeof POST>[1]

async function post(ctx: ReturnType<typeof makeScope>, ev: Stripe.Event | string, opts: { secret?: string; signature?: string | null; rawBody?: boolean } = {}) {
  const payload = typeof ev === "string" ? ev : JSON.stringify(ev)
  const signature =
    opts.signature === null
      ? undefined
      : opts.signature ?? Stripe.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? SECRET })
  const req = {
    headers: signature ? { "stripe-signature": signature } : {},
    rawBody: opts.rawBody === false ? undefined : Buffer.from(payload),
    body: JSON.parse(payload),
    scope: ctx.scope,
  } as unknown as Req
  const res = createRes()
  await POST(req, res as unknown as Res)
  return res
}

beforeEach(() => {
  process.env[FLAG] = "true"
})

afterEach(() => {
  delete process.env[STRIPE_CONNECT_WEBHOOK_SECRET_ENV]
  delete process.env[FLAG]
})

describe("POST /webhooks/stripe-connect — the door", () => {
  it("is dark with the flag off even when the secret is set: 404, nothing read, nothing written", async () => {
    delete process.env[FLAG]
    process.env[STRIPE_CONNECT_WEBHOOK_SECRET_ENV] = SECRET
    const ctx = makeScope()
    const res = await post(ctx, event("payment_intent.succeeded", intentObject()))
    expect(res.statusCode).toBe(404)
    expect(res.body).toMatchObject({ type: "feature_disabled" })
    expect(ctx.resolved).toEqual([])
    expect(ctx.dons.rows[0].status).toBe("created")
  })

  it("answers 503 when STRIPE_CONNECT_WEBHOOK_SECRET is unset and reads nothing", async () => {
    const ctx = makeScope()
    const res = await post(ctx, event("payment_intent.succeeded", intentObject()))
    expect(res.statusCode).toBe(503)
    expect(res.body).toMatchObject({ type: "webhook_not_configured" })
    expect(ctx.resolved).toEqual([])
    expect(ctx.dons.rows[0].status).toBe("created")
  })

  describe("with the secret set", () => {
    beforeEach(() => {
      process.env[STRIPE_CONNECT_WEBHOOK_SECRET_ENV] = SECRET
    })

    it("400s a missing signature", async () => {
      const ctx = makeScope()
      const res = await post(ctx, event("payment_intent.succeeded", intentObject()), { signature: null })
      expect(res.statusCode).toBe(400)
      expect(ctx.resolved).toEqual([])
    })

    it("400s a signature made with another secret (real SDK verification)", async () => {
      const ctx = makeScope()
      const res = await post(ctx, event("payment_intent.succeeded", intentObject()), { secret: "whsec_other" })
      expect(res.statusCode).toBe(400)
      expect(res.body).toEqual({ error: "Webhook verification failed" })
      expect(ctx.resolved).toEqual([])
      expect(ctx.dons.rows[0].status).toBe("created")
    })

    it("400s a tampered body under a valid header", async () => {
      const ctx = makeScope()
      const ev = event("payment_intent.succeeded", intentObject())
      const signature = Stripe.webhooks.generateTestHeaderString({ payload: JSON.stringify(ev), secret: SECRET })
      const tampered = JSON.stringify({ ...ev, data: { object: intentObject({ amount: 1 }) } })
      const res = await post(ctx, tampered, { signature })
      expect(res.statusCode).toBe(400)
      expect(ctx.resolved).toEqual([])
    })

    it("400s when the raw body did not survive parsing", async () => {
      const ctx = makeScope()
      const res = await post(ctx, event("payment_intent.succeeded", intentObject()), { rawBody: false })
      expect(res.statusCode).toBe(400)
      expect(ctx.resolved).toEqual([])
    })

    it("acknowledges and ignores an event with no connected account", async () => {
      const ctx = makeScope()
      const res = await post(ctx, event("payment_intent.succeeded", intentObject(), null))
      expect(res.statusCode).toBe(200)
      expect(res.body).toMatchObject({ received: true, outcome: "ignored_no_account" })
      expect(ctx.resolved).toEqual([])
    })

    it("applies a signed, connected-account success through the full POST", async () => {
      const ctx = makeScope()
      const res = await post(ctx, event("payment_intent.succeeded", intentObject()))
      expect(res.statusCode).toBe(200)
      expect(res.body).toMatchObject({ received: true, outcome: "updated", intent_id: "pi_1" })
      expect(ctx.dons.rows[0].status).toBe("succeeded")
    })
  })
})

describe("applyStripeConnectEvent — processor first, record second, idempotent by intent id", () => {
  it("payment_intent.succeeded ⇒ succeeded, fee read from an expanded balance transaction, hawala never resolved", async () => {
    const ctx = makeScope()
    const ev = event(
      "payment_intent.succeeded",
      intentObject({ latest_charge: { id: "ch_1", object: "charge", balance_transaction: { id: "txn_1", fee: 103 } } })
    )
    const r1 = await applyStripeConnectEvent(ctx.scope, ev)
    expect(r1).toEqual({ outcome: "updated", intent_id: "pi_1" })
    expect(ctx.dons.rows[0]).toMatchObject({ status: "succeeded", processor_fee_cents: 103, bmc_fee_cents: 0 })

    // Stripe re-delivers. Same row, nothing written.
    const r2 = await applyStripeConnectEvent(ctx.scope, ev)
    expect(r2).toEqual({ outcome: "unchanged", intent_id: "pi_1" })
    expect(ctx.dons.calls.update).toHaveLength(1)

    expect(ctx.resolved).not.toContain(HAWALA_LEDGER_MODULE)
    expect(ctx.hawala.processRefund).not.toHaveBeenCalled()
    expect(new Set(ctx.resolved)).toEqual(new Set([DONATION_MODULE]))
  })

  it("leaves processor_fee_cents alone when the payload has no balance transaction", async () => {
    const ctx = makeScope({ rows: [existingRow({ processor_fee_cents: 99 })] })
    await applyStripeConnectEvent(ctx.scope, event("payment_intent.succeeded", intentObject()))
    expect(ctx.dons.rows[0]).toMatchObject({ status: "succeeded", processor_fee_cents: 99 })
  })

  it("payment_intent.payment_failed ⇒ failed; a later success recovers it", async () => {
    const ctx = makeScope()
    expect(await applyStripeConnectEvent(ctx.scope, event("payment_intent.payment_failed", intentObject({ status: "requires_payment_method" })))).toEqual({
      outcome: "updated",
      intent_id: "pi_1",
    })
    expect(ctx.dons.rows[0].status).toBe("failed")
    await applyStripeConnectEvent(ctx.scope, event("payment_intent.succeeded", intentObject()))
    expect(ctx.dons.rows[0].status).toBe("succeeded")
  })

  it("charge.refunded ⇒ refunded, by the charge's payment_intent, never through hawala processRefund", async () => {
    const ctx = makeScope({ rows: [existingRow({ status: "succeeded" })] })
    const charge = {
      id: "ch_1",
      object: "charge",
      payment_intent: "pi_1",
      refunded: true,
      amount_refunded: 2500,
      transfer_data: null,
      on_behalf_of: null,
      application_fee_amount: null,
      balance_transaction: { id: "txn_1", fee: 103 },
    }
    const r = await applyStripeConnectEvent(ctx.scope, event("charge.refunded", charge))
    expect(r).toEqual({ outcome: "updated", intent_id: "pi_1" })
    expect(ctx.dons.rows[0]).toMatchObject({ status: "refunded", refunded_cents: 2500, processor_fee_cents: 103 })
    expect(ctx.hawala.processRefund).not.toHaveBeenCalled()
    expect(ctx.resolved).not.toContain(HAWALA_LEDGER_MODULE)

    // Terminal: a replayed success after the refund changes nothing.
    expect(await applyStripeConnectEvent(ctx.scope, event("payment_intent.succeeded", intentObject()))).toEqual({ outcome: "unchanged", intent_id: "pi_1" })
    expect(ctx.dons.rows[0].status).toBe("refunded")
  })

  it("a PARTIAL charge.refunded records the amount and keeps the status; the full refund later is terminal", async () => {
    const ctx = makeScope({ rows: [existingRow({ status: "succeeded" })] })
    const charge = (amount_refunded: number) => ({
      id: "ch_1",
      object: "charge",
      amount: 2500,
      payment_intent: "pi_1",
      refunded: amount_refunded >= 2500,
      amount_refunded,
      transfer_data: null,
      on_behalf_of: null,
      application_fee_amount: null,
    })
    expect(await applyStripeConnectEvent(ctx.scope, event("charge.refunded", charge(1000)))).toEqual({ outcome: "updated", intent_id: "pi_1" })
    expect(ctx.dons.rows[0]).toMatchObject({ status: "succeeded", refunded_cents: 1000 })
    // Re-delivery of the same partial: unchanged.
    expect(await applyStripeConnectEvent(ctx.scope, event("charge.refunded", charge(1000)))).toEqual({ outcome: "unchanged", intent_id: "pi_1" })
    // A second partial for the running total.
    expect(await applyStripeConnectEvent(ctx.scope, event("charge.refunded", charge(1500)))).toEqual({ outcome: "updated", intent_id: "pi_1" })
    expect(ctx.dons.rows[0]).toMatchObject({ status: "succeeded", refunded_cents: 1500 })
    // The rest: now refunded in full.
    expect(await applyStripeConnectEvent(ctx.scope, event("charge.refunded", charge(2500)))).toEqual({ outcome: "updated", intent_id: "pi_1" })
    expect(ctx.dons.rows[0]).toMatchObject({ status: "refunded", refunded_cents: 2500 })
    expect(ctx.dons.calls.update).toHaveLength(3)
  })

  it("ignores event types it does not handle", async () => {
    const ctx = makeScope()
    expect(await applyStripeConnectEvent(ctx.scope, event("payment_intent.created", intentObject()))).toEqual({ outcome: "ignored_event_type" })
    expect(await applyStripeConnectEvent(ctx.scope, event("account.updated", { id: ACCT, object: "account" }))).toEqual({ outcome: "ignored_event_type" })
    expect(ctx.resolved).toEqual([])
  })

  it("refuses an event whose account differs from the record's (the account IS the fact being recorded)", async () => {
    const ctx = makeScope()
    await expect(applyStripeConnectEvent(ctx.scope, event("payment_intent.succeeded", intentObject(), "acct_OTHER"))).rejects.toMatchObject({
      code: "account_mismatch",
    })
    expect(ctx.dons.rows[0].status).toBe("created")
  })

  it("refuses a payload that carries a forbidden Connect parameter; the POST answers 200 refused so Stripe does not retry", async () => {
    process.env[STRIPE_CONNECT_WEBHOOK_SECRET_ENV] = SECRET
    const ctx = makeScope()
    const res = await post(ctx, event("payment_intent.succeeded", intentObject({ application_fee_amount: 75 })))
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ received: true, outcome: "refused", code: "forbidden_intent_param" })
    expect(ctx.dons.rows[0].status).toBe("created")
    expect(ctx.dons.calls.update).toEqual([])
  })
})

describe("applyStripeConnectEvent — an intent we never recorded", () => {
  const donationMeta = {
    fbm_kind: "donation",
    fbm_org_key: "ground_up_liberation_project",
    fbm_campaign_id: "camp_9",
    fbm_customer_id: "cus_7",
    fbm_gross_cents: "2500",
    fbm_connected_account_id: ACCT,
  }

  it("creates the record from the intent's donation metadata and the org's CURRENT snapshot on success, with Stripe's amount", async () => {
    const ctx = makeScope({ rows: [] })
    // The metadata claims a gross the processor never collected; Stripe's figure wins.
    const r = await applyStripeConnectEvent(
      ctx.scope,
      event("payment_intent.succeeded", intentObject({ id: "pi_new", amount: 2500, metadata: { ...donationMeta, fbm_gross_cents: "100000000" } }))
    )
    expect(r).toEqual({ outcome: "created", intent_id: "pi_new", contribution: "recorded" })
    // The back-filled record names camp_9, so the campaign module is reached too — after the record is written.
    expect(ctx.resolved).toEqual([DONATION_MODULE, PARTNER_DIRECTORY_MODULE, COLLECTIVE_CAMPAIGN_MODULE])
    expect(ctx.campaigns.recordParticipantContribution).toHaveBeenCalledWith({
      campaign_id: "camp_9",
      partner_org_key: "ground_up_liberation_project",
      amount_cents: 2500,
      stripe_payment_intent_id: "pi_new",
    })
    expect(ctx.dons.rows[0]).toMatchObject({
      stripe_payment_intent_id: "pi_new",
      stripe_account_id: ACCT,
      org_key: "ground_up_liberation_project",
      campaign_id: "camp_9",
      customer_id: "cus_7",
      gross_cents: 2500,
      bmc_fee_cents: 0,
      status: "succeeded",
      recipient_verification_status: "pub78_eligible",
      recipient_verified_as_of: AS_OF,
      metadata: { recorded_from: "webhook" },
    })
  })

  it("ignores a success that is not a donation (no fbm_kind / fbm_org_key)", async () => {
    const ctx = makeScope({ rows: [] })
    expect(await applyStripeConnectEvent(ctx.scope, event("payment_intent.succeeded", intentObject({ id: "pi_x", metadata: { order_id: "o_1" } })))).toEqual({
      outcome: "ignored_not_donation",
      intent_id: "pi_x",
    })
    expect(ctx.dons.rows).toEqual([])
    expect(ctx.resolved).toEqual([DONATION_MODULE])
  })

  it("ignores a donation success for an org key it does not know", async () => {
    const ctx = makeScope({ rows: [], orgs: [] })
    expect(await applyStripeConnectEvent(ctx.scope, event("payment_intent.succeeded", intentObject({ id: "pi_x", metadata: donationMeta })))).toEqual({
      outcome: "ignored_unknown_org",
      intent_id: "pi_x",
    })
    expect(ctx.dons.rows).toEqual([])
  })

  it("does not back-fill when the event's account is not the named org's connected account (any vendor can write fbm_* metadata on their own intents)", async () => {
    // A Connect-onboarded vendor mints an intent on THEIR account with GULP's
    // key in the metadata. The directory says GULP lives on acct_1GULP.
    const ctx = makeScope({ rows: [] })
    const r = await applyStripeConnectEvent(ctx.scope, event("payment_intent.succeeded", intentObject({ id: "pi_x", metadata: donationMeta }), "acct_VENDOR"))
    expect(r).toEqual({ outcome: "ignored_account_mismatch", intent_id: "pi_x" })
    expect(ctx.dons.rows).toEqual([])
    expect(ctx.resolved).toEqual([DONATION_MODULE, PARTNER_DIRECTORY_MODULE])
  })

  it("does not back-fill for an org that is not an eligible recipient now: unpublished, no account, or not verified (a revoked org cannot be back-filled as verified)", async () => {
    for (const org of [
      gulp({ published: false }),
      gulp({ verification_status: "revoked" }),
      gulp({ verification_status: "unverified", verified_as_of: null }),
    ]) {
      const ctx = makeScope({ rows: [], orgs: [org] })
      const r = await applyStripeConnectEvent(ctx.scope, event("payment_intent.succeeded", intentObject({ id: "pi_x", metadata: donationMeta })))
      expect(r).toEqual({ outcome: "ignored_recipient_ineligible", intent_id: "pi_x" })
      expect(ctx.dons.rows).toEqual([])
    }
    // No connected account on file ⇒ the account can never match; the mismatch is the refusal.
    const ctx = makeScope({ rows: [], orgs: [gulp({ stripe_connect_account_id: null })] })
    expect(await applyStripeConnectEvent(ctx.scope, event("payment_intent.succeeded", intentObject({ id: "pi_x", metadata: donationMeta })))).toEqual({
      outcome: "ignored_account_mismatch",
      intent_id: "pi_x",
    })
    expect(ctx.dons.rows).toEqual([])
  })

  it("ignores a failure or refund for an intent it never recorded", async () => {
    const ctx = makeScope({ rows: [] })
    expect(await applyStripeConnectEvent(ctx.scope, event("payment_intent.payment_failed", intentObject({ id: "pi_x", metadata: donationMeta })))).toEqual({
      outcome: "ignored_unknown_intent",
      intent_id: "pi_x",
    })
    expect(await applyStripeConnectEvent(ctx.scope, event("charge.refunded", { id: "ch_x", object: "charge", payment_intent: "pi_x" }))).toEqual({
      outcome: "ignored_unknown_intent",
      intent_id: "pi_x",
    })
    expect(ctx.dons.rows).toEqual([])
  })

  it("throws, not falls back, when the donation module is under a near-miss key", async () => {
    const good = makeScope()
    const scope = {
      resolve: <T,>(key: string): T => {
        if (key === "donationModuleService") return good.dons.service as unknown as T
        if (key === DONATION_MODULE) throw new Error(`Could not resolve '${key}'`)
        return good.scope.resolve<T>(key)
      },
    }
    await expect(applyStripeConnectEvent(scope, event("payment_intent.succeeded", intentObject()))).rejects.toThrow(/Could not resolve 'donation'/)
  })
})

describe("applyStripeConnectEvent — shared-goal Coalition contributions (campaign_id on the record)", () => {
  const campaignRow = (over: Partial<SplitRow> = {}) => existingRow({ campaign_id: "camp_9", ...over })

  it("reports the gross to recordParticipantContribution on the imported module exactly once, when the record ENTERS succeeded", async () => {
    const ctx = makeScope({ rows: [campaignRow()] })
    const ev = event("payment_intent.succeeded", intentObject())

    const r1 = await applyStripeConnectEvent(ctx.scope, ev)
    expect(r1).toEqual({ outcome: "updated", intent_id: "pi_1", contribution: "recorded" })
    expect(ctx.dons.rows[0].status).toBe("succeeded")
    expect(ctx.campaigns.recordParticipantContribution).toHaveBeenCalledTimes(1)
    expect(ctx.campaigns.recordParticipantContribution).toHaveBeenCalledWith({
      campaign_id: "camp_9",
      partner_org_key: "ground_up_liberation_project",
      amount_cents: 2500,
      // The idempotency key is the record's intent, never the delivery.
      stripe_payment_intent_id: "pi_1",
    })
    // The record was written BEFORE the campaign was told: processor, record, then report.
    expect(ctx.resolved).toEqual([DONATION_MODULE, COLLECTIVE_CAMPAIGN_MODULE])

    // Stripe re-delivers: unchanged, and the campaign is not told twice.
    const r2 = await applyStripeConnectEvent(ctx.scope, ev)
    expect(r2).toEqual({ outcome: "unchanged", intent_id: "pi_1" })
    expect(ctx.campaigns.recordParticipantContribution).toHaveBeenCalledTimes(1)

    // A later delivery with an expanded balance transaction updates the fee on
    // the already-succeeded row — an update, not a second contribution.
    const r3 = await applyStripeConnectEvent(
      ctx.scope,
      event("payment_intent.succeeded", intentObject({ latest_charge: { id: "ch_1", object: "charge", balance_transaction: { id: "txn_1", fee: 103 } } }))
    )
    expect(r3).toEqual({ outcome: "updated", intent_id: "pi_1" })
    expect(ctx.dons.rows[0].processor_fee_cents).toBe(103)
    expect(ctx.campaigns.recordParticipantContribution).toHaveBeenCalledTimes(1)
    expect(ctx.hawala.createTransfer).not.toHaveBeenCalled()
    expect(ctx.resolved).not.toContain(HAWALA_LEDGER_MODULE)
  })

  it("a failure then a success counts once, at the success; a failure alone never reaches the campaign", async () => {
    const ctx = makeScope({ rows: [campaignRow()] })
    expect(await applyStripeConnectEvent(ctx.scope, event("payment_intent.payment_failed", intentObject({ status: "requires_payment_method" })))).toEqual({
      outcome: "updated",
      intent_id: "pi_1",
    })
    expect(ctx.campaigns.recordParticipantContribution).not.toHaveBeenCalled()
    expect(ctx.resolved).toEqual([DONATION_MODULE])

    expect(await applyStripeConnectEvent(ctx.scope, event("payment_intent.succeeded", intentObject()))).toEqual({
      outcome: "updated",
      intent_id: "pi_1",
      contribution: "recorded",
    })
    expect(ctx.campaigns.recordParticipantContribution).toHaveBeenCalledTimes(1)
  })

  it("two CONCURRENT deliveries of the same success both reach the module with the same intent id, and the module's intent-keyed row decides: one recorded, one already_recorded", async () => {
    const ctx = makeScope({ rows: [campaignRow()] })
    // Hold each delivery's WRITE until both have arrived: both deliveries then
    // read `created` (pre-read and the read inside the service) before either
    // writes, both write `succeeded`, and both decide "entered succeeded" from
    // their own pre-read — the ordering a single process cannot rule out.
    const shadow = ctx.dons.service as unknown as Record<string, unknown>
    const realUpdate = shadow.updateDonationSplitRecords as (d: Record<string, unknown>) => Promise<SplitRow>
    let held = 0
    let waiting: Array<() => void> = []
    shadow.updateDonationSplitRecords = async (data: Record<string, unknown>) => {
      if (held < 2) {
        held += 1
        await new Promise<void>((resolve) => {
          waiting.push(resolve)
          if (held === 2) {
            waiting.forEach((w) => w())
            waiting = []
          }
        })
      }
      return realUpdate(data)
    }
    const ev = event("payment_intent.succeeded", intentObject())
    const [a, b] = await Promise.all([applyStripeConnectEvent(ctx.scope, ev), applyStripeConnectEvent(ctx.scope, ev)])

    // Both wrote (the status function is monotone, so the double write is harmless)...
    expect(a.outcome).toBe("updated")
    expect(b.outcome).toBe("updated")
    expect(ctx.dons.rows[0].status).toBe("succeeded")
    // ...and both told the module, with the same intent id, which is why the
    // module and not this handler is the arbiter.
    expect(ctx.campaigns.recordParticipantContribution).toHaveBeenCalledTimes(2)
    for (const call of ctx.campaigns.recordParticipantContribution.mock.calls) {
      expect(call[0]).toMatchObject({ campaign_id: "camp_9", stripe_payment_intent_id: "pi_1", amount_cents: 2500 })
    }
    expect([a.contribution, b.contribution].sort()).toEqual(["already_recorded", "recorded"])
  })

  it("a FULL refund of a succeeded shared-goal record reverses the same intent on the campaign module, exactly once", async () => {
    const ctx = makeScope({ rows: [campaignRow({ status: "succeeded" })] })
    const charge = { id: "ch_1", object: "charge", payment_intent: "pi_1", refunded: true, amount_refunded: 2500, transfer_data: null, on_behalf_of: null, application_fee_amount: null }
    const ev = event("charge.refunded", charge)
    expect(await applyStripeConnectEvent(ctx.scope, ev)).toEqual({ outcome: "updated", intent_id: "pi_1", contribution: "reversed" })
    expect(ctx.campaigns.reverseParticipantContribution).toHaveBeenCalledWith({ campaign_id: "camp_9", stripe_payment_intent_id: "pi_1" })
    expect(ctx.campaigns.recordParticipantContribution).not.toHaveBeenCalled()
    expect(ctx.resolved).toEqual([DONATION_MODULE, COLLECTIVE_CAMPAIGN_MODULE])
    expect(ctx.resolved).not.toContain(HAWALA_LEDGER_MODULE)

    // Re-delivered: the record is already refunded, unchanged, nothing reversed twice.
    expect(await applyStripeConnectEvent(ctx.scope, ev)).toEqual({ outcome: "unchanged", intent_id: "pi_1" })
    expect(ctx.campaigns.reverseParticipantContribution).toHaveBeenCalledTimes(1)
  })

  it("a PARTIAL refund keeps the status and never reaches the campaign module; a refund of a record never counted is reported not_recorded", async () => {
    const ctx = makeScope({ rows: [campaignRow({ status: "succeeded" })] })
    const partial = { id: "ch_1", object: "charge", payment_intent: "pi_1", refunded: false, amount_refunded: 500, transfer_data: null, on_behalf_of: null, application_fee_amount: null }
    expect(await applyStripeConnectEvent(ctx.scope, event("charge.refunded", partial))).toEqual({ outcome: "updated", intent_id: "pi_1" })
    expect(ctx.dons.rows[0]).toMatchObject({ status: "succeeded", refunded_cents: 500 })
    expect(ctx.campaigns.reverseParticipantContribution).not.toHaveBeenCalled()
    expect(ctx.resolved).toEqual([DONATION_MODULE])

    const never = makeScope({ rows: [campaignRow({ status: "created" })], reversal: "not_recorded" })
    const full = { ...partial, refunded: true, amount_refunded: 2500 }
    expect(await applyStripeConnectEvent(never.scope, event("charge.refunded", full))).toEqual({ outcome: "updated", intent_id: "pi_1", contribution: "not_recorded" })
  })

  it("a record with no campaign_id never resolves the campaign module", async () => {
    const ctx = makeScope({ rows: [existingRow({ campaign_id: null })] })
    expect(await applyStripeConnectEvent(ctx.scope, event("payment_intent.succeeded", intentObject()))).toEqual({ outcome: "updated", intent_id: "pi_1" })
    expect(ctx.resolved).toEqual([DONATION_MODULE])
    expect(ctx.campaigns.recordParticipantContribution).not.toHaveBeenCalled()
  })

  it("an org that is not a participant is reported as no_participant; the split record is still succeeded", async () => {
    const ctx = makeScope({ rows: [campaignRow()], contribution: "no_participant" })
    expect(await applyStripeConnectEvent(ctx.scope, event("payment_intent.succeeded", intentObject()))).toEqual({
      outcome: "updated",
      intent_id: "pi_1",
      contribution: "no_participant",
    })
    expect(ctx.dons.rows[0].status).toBe("succeeded")
  })

  it("a campaign module that throws, or sits under a near-miss key, surfaces as contribution failed on a 200 — the record stands and Stripe is not retried into it", async () => {
    process.env[STRIPE_CONNECT_WEBHOOK_SECRET_ENV] = SECRET
    for (const contribution of ["throws", "unresolvable"] as const) {
      const ctx = makeScope({ rows: [campaignRow()], contribution })
      const res = await post(ctx, event("payment_intent.succeeded", intentObject()))
      expect(res.statusCode).toBe(200)
      expect(res.body).toMatchObject({ received: true, outcome: "updated", intent_id: "pi_1", contribution: "failed" })
      expect(ctx.dons.rows[0].status).toBe("succeeded")
      expect(ctx.resolved).toContain(COLLECTIVE_CAMPAIGN_MODULE)
    }
  })
})

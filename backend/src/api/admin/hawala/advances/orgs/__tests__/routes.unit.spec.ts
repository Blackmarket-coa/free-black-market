import { POST as requestOrgAdvance } from "../route"
import { POST as approveOrgAdvance } from "../[id]/approve/route"
import { POST as recordRepayment } from "../[id]/repayments/route"
import { GET as vendorAdvances } from "../../../../../vendor/hawala/advances/route"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import { PARTNER_DIRECTORY_MODULE } from "../../../../../../modules/partner-directory"
import {
  makeInMemoryDirectory,
  type InMemoryDirectory,
  type OrgRow,
} from "../../../../../../modules/partner-directory/__tests__/in-memory-partner-orgs"
import {
  makeAdvanceLedger,
  makeOrgAdvance,
  makeSellerAdvance,
  type AdvanceLedger,
} from "../../../../../../modules/hawala-ledger/__tests__/in-memory-advance-ledger"
import { PHASE0_FEATURE_FLAGS } from "../../../../../../shared/feature-flags"
import { requireFeatureFlagMiddleware } from "../../../../../../shared/runtime-module-gates"

/**
 * The org-advance routes against the REAL pieces: the real partner-directory
 * service (prototype + shadowed CRUD), the real hawala-ledger service
 * (prototype + shadowed CRUD, so `requestOrgAdvance`'s snapshot validation,
 * the approval idempotency and the derived repayment position are the code
 * that ships), and the real `requireFeatureFlagMiddleware` for BOTH flags.
 * Every module is keyed on its imported constant and the scope throws on
 * anything else (CLAUDE.md rule 2): a near-miss key fails rather than passing
 * on a fallback. This file sits under `src/api/admin/**`, which the
 * no-explicit-any ratchet gates at `error`.
 *
 * Pinned (docs/BMC_SURVIVAL_PROGRAMS.md Decision 6a; L26, L11):
 *   - the three admin routes are dark (404 feature_disabled through the real
 *     middleware) when EITHER flag is off, and the handler is never reached;
 *     the handlers repeat both checks;
 *   - any recipient refusal — unknown key, unpublished, no account, unverified
 *     (incl. not_found / revoked) — is `forbidden()`: 403, ONE body; no
 *     snapshot is built, no hawala write happens;
 *   - a verified org is frozen into a PENDING_APPROVAL record (never its
 *     account id) that names its requester; no ledger account, no entry;
 *   - approval needs an admin actor (401 otherwise), is idempotent on the
 *     disbursement reference, and refuses a seller advance;
 *   - repayments are records: 201 on the first, 200 already_recorded on a
 *     replay, derived position, no ledger entry;
 *   - GET /vendor/hawala/advances never returns an org advance, even one
 *     pathologically carrying that vendor's id.
 */

const PARITY = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1
const ADVANCES = PHASE0_FEATURE_FLAGS.VENDOR_ADVANCES_V1
const AS_OF = new Date("2026-09-10T09:18:37Z")

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

type Handler = (req: never, res: never) => Promise<unknown>

const gulp = (over: Partial<OrgRow> = {}): Partial<OrgRow> & { key: string; name: string } => ({
  key: "ground_up_liberation_project",
  name: "Ground Up Liberation Project",
  org_type: "irs_501c3",
  ein: "123456789",
  verification_status: "pub78_eligible",
  verified_as_of: AS_OF,
  stripe_connect_account_id: "acct_1GULP",
  published: true,
  ...over,
})

const requestBody = (over: Record<string, unknown> = {}) => ({
  partner_org_key: "ground_up_liberation_project",
  amount: 1000,
  fee_rate: 1.05,
  term_days: 30,
  eligibility: { basis: "Pilot MOU 2026-09", approved_limit: 5000 },
  ...over,
})

type Ctx = {
  scope: { resolve: <T>(key: string) => T }
  resolved: string[]
  dir: InMemoryDirectory
  ledger: AdvanceLedger
}

function makeCtx(opts: { orgs?: Array<Partial<OrgRow> & { key: string; name: string }>; ledger?: AdvanceLedger; keys?: { directory?: string; hawala?: string } } = {}): Ctx {
  const dir = makeInMemoryDirectory(opts.orgs ?? [gulp()])
  const ledger = opts.ledger ?? makeAdvanceLedger()
  const directoryKey = opts.keys?.directory ?? PARTNER_DIRECTORY_MODULE
  const hawalaKey = opts.keys?.hawala ?? HAWALA_LEDGER_MODULE
  const resolved: string[] = []
  const scope = {
    resolve: <T,>(key: string): T => {
      resolved.push(key)
      if (key === directoryKey) return dir.service as unknown as T
      if (key === hawalaKey) return ledger.service as unknown as T
      throw new Error(`Could not resolve '${key}'`)
    },
  }
  return { scope, resolved, dir, ledger }
}

type ReqShape = { params?: Record<string, string>; body?: unknown; headers?: Record<string, string>; auth_context?: { actor_id: string }; _seller_id?: string }
const ADMIN = { auth_context: { actor_id: "user_admin_1" } }

async function call(handler: Handler, ctx: Ctx, req: ReqShape) {
  const res = createRes()
  await handler({ ...req, scope: ctx.scope } as never, res as never)
  return res
}

/** The route as registered: both real flag middlewares, then the handler. */
async function throughGates(handler: Handler, ctx: Ctx, req: ReqShape) {
  const res = createRes()
  const request = { ...req, scope: ctx.scope } as never
  let reached = false
  await requireFeatureFlagMiddleware("VENDOR_ADVANCES_V1")(request, res as never, async () => {
    await requireFeatureFlagMiddleware("NONPROFIT_PARITY_V1")(request, res as never, async () => {
      reached = true
      await handler(request, res as never)
    })
  })
  return { res, reached }
}

const FORBIDDEN_BODY = { message: "You do not have access to this record.", type: "not_allowed" }

function expectNoLedger(ledger: AdvanceLedger) {
  expect(ledger.accounts.filter((a) => a.owner_type !== "SELLER")).toEqual([])
  expect(ledger.entries).toEqual([])
}

afterEach(() => {
  delete process.env[PARITY]
  delete process.env[ADVANCES]
})

describe("gating — neither flag alone opens the org-advance routes", () => {
  const routes: Array<[string, Handler, unknown]> = [
    ["orgs", requestOrgAdvance as unknown as Handler, requestBody()],
    ["approve", approveOrgAdvance as unknown as Handler, { disbursement_reference: "tr_1" }],
    ["repayments", recordRepayment as unknown as Handler, { amount: 10, external_reference: "r" }],
  ]

  it("both unset: 404 feature_disabled naming FF_VENDOR_ADVANCES_V1, handler never reached, nothing resolved", async () => {
    for (const [, handler, body] of routes) {
      const ctx = makeCtx()
      const { res, reached } = await throughGates(handler, ctx, { ...ADMIN, params: { id: "adv_1" }, body })
      expect(res.statusCode).toBe(404)
      expect(res.body).toMatchObject({ type: "feature_disabled", message: expect.stringContaining(ADVANCES) })
      expect(reached).toBe(false)
      expect(ctx.resolved).toEqual([])
    }
  })

  it("VENDOR_ADVANCES_V1 alone: 404 feature_disabled naming FF_NONPROFIT_PARITY_V1, handler never reached", async () => {
    process.env[ADVANCES] = "true"
    for (const [, handler, body] of routes) {
      const ctx = makeCtx()
      const { res, reached } = await throughGates(handler, ctx, { ...ADMIN, params: { id: "adv_1" }, body })
      expect(res.statusCode).toBe(404)
      expect(res.body).toMatchObject({ type: "feature_disabled", message: expect.stringContaining(PARITY) })
      expect(reached).toBe(false)
      expect(ctx.resolved).toEqual([])
    }
  })

  it("NONPROFIT_PARITY_V1 alone: still 404 through the advances gate", async () => {
    process.env[PARITY] = "true"
    for (const [, handler, body] of routes) {
      const ctx = makeCtx()
      const { res, reached } = await throughGates(handler, ctx, { ...ADMIN, params: { id: "adv_1" }, body })
      expect(res.statusCode).toBe(404)
      expect(res.body).toMatchObject({ message: expect.stringContaining(ADVANCES) })
      expect(reached).toBe(false)
    }
  })

  it("the handlers repeat BOTH checks themselves (a matcher typo cannot open them)", async () => {
    for (const only of [ADVANCES, PARITY]) {
      process.env[only] = "true"
      for (const [, handler, body] of routes) {
        const ctx = makeCtx()
        const res = await call(handler, ctx, { ...ADMIN, params: { id: "adv_1" }, body })
        expect(res.statusCode).toBe(404)
        expect(res.body).toMatchObject({ type: "feature_disabled" })
        expect(ctx.resolved).toEqual([])
      }
      delete process.env[only]
    }
  })
})

describe("POST /admin/hawala/advances/orgs (both flags on)", () => {
  beforeEach(() => {
    process.env[ADVANCES] = "true"
    process.env[PARITY] = "true"
  })

  it("every recipient refusal is forbidden(): 403 with ONE body for an unknown key and for each ineligible org; nothing is written", async () => {
    const orgs = [
      gulp({ key: "unpublished", published: false }),
      gulp({ key: "no_account", stripe_connect_account_id: null }),
      gulp({ key: "unverified_c3", verification_status: "unverified" }),
      gulp({ key: "revoked_c3", verification_status: "revoked" }),
      gulp({ key: "not_found_c3", verification_status: "not_found" }),
      gulp({ key: "pending_c3", verification_status: "pending" }),
    ]
    const bodies: Record<string, unknown>[] = []
    for (const key of ["does_not_exist", ...orgs.map((o) => o.key)]) {
      const ctx = makeCtx({ orgs })
      const { res, reached } = await throughGates(requestOrgAdvance as unknown as Handler, ctx, { ...ADMIN, body: requestBody({ partner_org_key: key }) })
      expect(reached).toBe(true)
      expect(res.statusCode).toBe(403)
      bodies.push(res.body)
      // The directory was read; hawala was never touched.
      expect(ctx.resolved).toEqual([PARTNER_DIRECTORY_MODULE])
      expect(ctx.ledger.advanceWrites).toEqual([])
      expect(ctx.ledger.advances).toEqual([])
    }
    for (const body of bodies) expect(body).toEqual(FORBIDDEN_BODY)
  })

  it("a verified, published org with a connected account gets a PENDING_APPROVAL record naming its requester — snapshot frozen (no acct_), no vendor, no ledger account, no entry", async () => {
    const ctx = makeCtx()
    const { res } = await throughGates(requestOrgAdvance as unknown as Handler, ctx, { ...ADMIN, body: requestBody() })
    expect(res.statusCode).toBe(201)
    expect(ctx.resolved).toEqual([PARTNER_DIRECTORY_MODULE, HAWALA_LEDGER_MODULE])

    const row = ctx.ledger.advances[0]
    expect(row).toMatchObject({
      recipient_type: "PARTNER_ORG",
      vendor_id: null,
      ledger_account_id: null,
      partner_org_key: "ground_up_liberation_project",
      status: "PENDING_APPROVAL",
      repayment_method: "MANUAL",
      outstanding_balance: 1050,
    })
    expect(row.recipient_snapshot).toMatchObject({
      org_key: "ground_up_liberation_project",
      org_type: "irs_501c3",
      verification_status: "pub78_eligible",
      verified_as_of: AS_OF.toISOString(),
      stripe_connect_account_present: true,
    })
    expect(JSON.stringify(row)).not.toContain("acct_")
    expect(row.eligibility_snapshot).toMatchObject({ basis: "Pilot MOU 2026-09", approved_limit: 5000, recorded_by: "user_admin_1" })
    expect(res.body).toMatchObject({
      advance: {
        id: "adv_1",
        recipient_type: "PARTNER_ORG",
        partner_org_key: "ground_up_liberation_project",
        recipient: { org_key: "ground_up_liberation_project", verification_status: "pub78_eligible", verified_as_of: AS_OF.toISOString() },
        principal: 1000,
        outstanding: 1050,
        status: "PENDING_APPROVAL",
        approved_by: null,
        disbursement_reference: null,
      },
    })
    expectNoLedger(ctx.ledger)
  })

  it("the real service refuses an amount over the operator's limit (409 over_limit) and a second open advance (409 open_advance_exists)", async () => {
    const ctx = makeCtx()
    const over = await throughGates(requestOrgAdvance as unknown as Handler, ctx, { ...ADMIN, body: requestBody({ amount: 6000 }) })
    expect(over.res.statusCode).toBe(409)
    expect(over.res.body).toMatchObject({ type: "over_limit" })
    expect(ctx.ledger.advances).toEqual([])

    const busy = makeCtx({ ledger: makeAdvanceLedger({ advances: [makeOrgAdvance("adv_open")] }) })
    const second = await throughGates(requestOrgAdvance as unknown as Handler, busy, { ...ADMIN, body: requestBody() })
    expect(second.res.statusCode).toBe(409)
    expect(second.res.body).toMatchObject({ type: "open_advance_exists" })
    expect(busy.ledger.advances).toHaveLength(1)
  })

  it("a bad body is 400 before anything is resolved — a snapshot, status, vendor or account in the body is an unknown key", async () => {
    for (const body of [
      {},
      requestBody({ eligibility: undefined }),
      requestBody({ eligibility: { basis: "x" } }),
      requestBody({ partner_org_key: "Not A Key" }),
      requestBody({ amount: 1.005 }),
      requestBody({ fee_rate: 3 }),
      requestBody({ recipient_snapshot: { verification_status: "pub78_eligible" } }),
      requestBody({ status: "ACTIVE" }),
      requestBody({ vendor_id: "sel_1" }),
      requestBody({ ledger_account_id: "acc_1" }),
    ]) {
      const ctx = makeCtx()
      const res = await call(requestOrgAdvance as unknown as Handler, ctx, { ...ADMIN, body })
      expect(res.statusCode).toBe(400)
      expect(res.body).toMatchObject({ type: "invalid_request" })
      expect(ctx.resolved).toEqual([])
    }
  })

  it("resolves both modules on their imported constants; a near-miss key throws instead of passing", async () => {
    const dirMiss = makeCtx({ keys: { directory: "partnerDirectoryService" } })
    await expect(call(requestOrgAdvance as unknown as Handler, dirMiss, { ...ADMIN, body: requestBody() })).rejects.toThrow(
      `Could not resolve '${PARTNER_DIRECTORY_MODULE}'`
    )
    const hawalaMiss = makeCtx({ keys: { hawala: "hawala-ledger" } })
    await expect(call(requestOrgAdvance as unknown as Handler, hawalaMiss, { ...ADMIN, body: requestBody() })).rejects.toThrow(
      `Could not resolve '${HAWALA_LEDGER_MODULE}'`
    )
    expect(hawalaMiss.ledger.advanceWrites).toEqual([])
  })
})

describe("POST /admin/hawala/advances/orgs/:id/approve (both flags on)", () => {
  beforeEach(() => {
    process.env[ADVANCES] = "true"
    process.env[PARITY] = "true"
  })

  it("needs an admin actor: 401 without one, nothing resolved", async () => {
    const ctx = makeCtx({ ledger: makeAdvanceLedger({ advances: [makeOrgAdvance("adv_1")] }) })
    const res = await call(approveOrgAdvance as unknown as Handler, ctx, { params: { id: "adv_1" }, body: { disbursement_reference: "tr_1" } })
    expect(res.statusCode).toBe(401)
    expect(ctx.resolved).toEqual([])
    expect(ctx.ledger.advances[0].status).toBe("PENDING_APPROVAL")
  })

  it("approves PENDING_APPROVAL -> ACTIVE with the actor as approver; a replay with the same reference is 200 approved:false; a different reference is 409 reference_mismatch", async () => {
    const ctx = makeCtx({ ledger: makeAdvanceLedger({ advances: [makeOrgAdvance("adv_1")] }) })
    const first = await throughGates(approveOrgAdvance as unknown as Handler, ctx, { ...ADMIN, params: { id: "adv_1" }, body: { disbursement_reference: "tr_1GULP" } })
    expect(first.res.statusCode).toBe(200)
    expect(first.res.body).toMatchObject({ approved: true, advance: { status: "ACTIVE", approved_by: "user_admin_1", disbursement_reference: "tr_1GULP" } })
    expect(ctx.resolved).toEqual([HAWALA_LEDGER_MODULE])
    expectNoLedger(ctx.ledger)

    const replay = await throughGates(approveOrgAdvance as unknown as Handler, ctx, { auth_context: { actor_id: "user_admin_2" }, params: { id: "adv_1" }, body: { disbursement_reference: "tr_1GULP" } })
    expect(replay.res.statusCode).toBe(200)
    expect(replay.res.body).toMatchObject({ approved: false, reason: "already_approved", advance: { approved_by: "user_admin_1" } })

    const other = await throughGates(approveOrgAdvance as unknown as Handler, ctx, { ...ADMIN, params: { id: "adv_1" }, body: { disbursement_reference: "tr_2" } })
    expect(other.res.statusCode).toBe(409)
    expect(other.res.body).toMatchObject({ type: "reference_mismatch" })
    expect(ctx.ledger.advances[0].disbursement_reference).toBe("tr_1GULP")
  })

  it("a seller advance is 409 not_org_advance, an unknown id is 404, a bad body is 400 before anything is resolved", async () => {
    const ctx = makeCtx({ ledger: makeAdvanceLedger({ advances: [makeSellerAdvance("adv_s", { status: "PENDING_APPROVAL" })] }) })
    const seller = await call(approveOrgAdvance as unknown as Handler, ctx, { ...ADMIN, params: { id: "adv_s" }, body: { disbursement_reference: "tr" } })
    expect(seller.statusCode).toBe(409)
    expect(seller.body).toMatchObject({ type: "not_org_advance" })
    expect(ctx.ledger.advances[0].status).toBe("PENDING_APPROVAL")

    const missing = await call(approveOrgAdvance as unknown as Handler, ctx, { ...ADMIN, params: { id: "adv_ghost" }, body: { disbursement_reference: "tr" } })
    expect(missing.statusCode).toBe(404)
    expect(missing.body).toMatchObject({ type: "not_found" })

    for (const body of [{}, { disbursement_reference: "" }, { disbursement_reference: "tr", approved_by: "someone_else" }, { disbursement_reference: "tr", status: "ACTIVE" }]) {
      const fresh = makeCtx()
      const res = await call(approveOrgAdvance as unknown as Handler, fresh, { ...ADMIN, params: { id: "adv_1" }, body })
      expect(res.statusCode).toBe(400)
      expect(fresh.resolved).toEqual([])
    }
  })
})

describe("POST /admin/hawala/advances/orgs/:id/repayments (both flags on)", () => {
  beforeEach(() => {
    process.env[ADVANCES] = "true"
    process.env[PARITY] = "true"
  })

  const activeCtx = () => makeCtx({ ledger: makeAdvanceLedger({ advances: [makeOrgAdvance("adv_1", { status: "ACTIVE", disbursement_reference: "tr_1" })] }) })

  it("a repayment is a record: 201, MANUAL row with no ledger entry, derived position; the replay is 200 already_recorded", async () => {
    const ctx = activeCtx()
    const first = await throughGates(recordRepayment as unknown as Handler, ctx, { ...ADMIN, params: { id: "adv_1" }, body: { amount: 250.5, external_reference: "gulp-ach-2026-10-04", repaid_at: "2026-10-03T00:00:00Z" } })
    expect(first.res.statusCode).toBe(201)
    expect(first.res.body).toMatchObject({ recorded: true, position: { total_owed: 1050, total_repaid: 250.5, outstanding_balance: 799.5 } })
    expect(ctx.ledger.repayments[0]).toMatchObject({ repayment_type: "MANUAL", status: "COMPLETED", ledger_entry_id: null, external_reference: "gulp-ach-2026-10-04", total_amount: 250.5 })
    expect(ctx.ledger.repayments[0].metadata).toMatchObject({ repaid_at: "2026-10-03T00:00:00.000Z", recorded_by: "user_admin_1" })
    expect(ctx.ledger.advances[0]).toMatchObject({ outstanding_balance: 799.5, total_repaid: 250.5, status: "ACTIVE" })
    expectNoLedger(ctx.ledger)

    const replay = await throughGates(recordRepayment as unknown as Handler, ctx, { ...ADMIN, params: { id: "adv_1" }, body: { amount: 250.5, external_reference: "gulp-ach-2026-10-04" } })
    expect(replay.res.statusCode).toBe(200)
    expect(replay.res.body).toEqual({ recorded: false, reason: "already_recorded", repayment_id: "rep_1" })
    expect(ctx.ledger.repayments).toHaveLength(1)
    expect(ctx.resolved).toEqual([HAWALA_LEDGER_MODULE, HAWALA_LEDGER_MODULE])
  })

  it("a PENDING_APPROVAL advance is 409 invalid_state, an unknown id 404, and a bad body 400 before hawala is resolved", async () => {
    const pending = makeCtx({ ledger: makeAdvanceLedger({ advances: [makeOrgAdvance("adv_1")] }) })
    const res = await throughGates(recordRepayment as unknown as Handler, pending, { ...ADMIN, params: { id: "adv_1" }, body: { amount: 10, external_reference: "r" } })
    expect(res.res.statusCode).toBe(409)
    expect(res.res.body).toMatchObject({ type: "invalid_state" })
    expect(pending.ledger.repayments).toEqual([])

    const missing = await call(recordRepayment as unknown as Handler, pending, { ...ADMIN, params: { id: "adv_ghost" }, body: { amount: 10, external_reference: "r" } })
    expect(missing.statusCode).toBe(404)

    for (const body of [{ amount: -1, external_reference: "r" }, { amount: 1.005, external_reference: "r" }, { amount: 10 }, { amount: 10, external_reference: "r", ledger_entry_id: "le_1" }]) {
      const fresh = activeCtx()
      const out = await call(recordRepayment as unknown as Handler, fresh, { ...ADMIN, params: { id: "adv_1" }, body })
      expect(out.statusCode).toBe(400)
      expect(fresh.resolved).toEqual([])
    }
  })
})

describe("GET /vendor/hawala/advances", () => {
  it("never returns an org advance — not even one pathologically carrying the vendor's id", async () => {
    const ledger = makeAdvanceLedger({
      advances: [
        makeSellerAdvance("adv_seller"),
        makeOrgAdvance("adv_org", { status: "ACTIVE", disbursement_reference: "tr", vendor_id: "sel_1" }),
      ],
      accounts: [{ id: "acc-earn", account_type: "SELLER_EARNINGS", owner_type: "SELLER", owner_id: "sel_1", currency_code: "USD", balance: 0, pending_balance: 0, available_balance: 0 }],
    })
    const ctx = makeCtx({ ledger })
    const res = await call(vendorAdvances as unknown as Handler, ctx, { _seller_id: "sel_1", auth_context: { actor_id: "sel_1" }, headers: {} })
    expect(res.statusCode).toBe(200)
    const advances = res.body.advances as Array<{ id: string }>
    expect(advances.map((a) => a.id)).toEqual(["adv_seller"])
    expect(ledger.advanceReads).toContainEqual({ vendor_id: "sel_1", recipient_type: "SELLER" })
  })
})

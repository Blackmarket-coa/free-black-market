import fs from "fs"
import path from "path"
import { GET as listCampaigns, POST as createCampaign } from "../route"
import { GET as getCampaign, PATCH as patchCampaign } from "../[id]/route"
import { GET as getProgress } from "../[id]/progress/route"
import { GET as getImpactReport } from "../[id]/impact-report/route"
import { POST as addParticipant } from "../[id]/participants/route"
import { POST as addMilestone } from "../[id]/milestones/route"
import {
  CAMPAIGN_GOAL_KIND_SHARED_GOAL,
  CampaignParticipantRole,
  COLLECTIVE_CAMPAIGN_MODULE,
} from "../../../../../modules/collective-campaign"
import CollectiveCampaignModuleService from "../../../../../modules/collective-campaign/service"
import { COLLECTIVE_QUEST_MODULE, GoalScopeType } from "../../../../../modules/collective-quest"
import { PHASE0_FEATURE_FLAGS } from "../../../../../shared/feature-flags"
import { requireFeatureFlagMiddleware } from "../../../../../shared/runtime-module-gates"

/**
 * Shared-goal Coalition routes (Phase 1 item 3).
 *
 * The campaign service is the REAL prototype with only the generated CRUD
 * shadowed in memory, so the fee branch, the HOST participant, the host check
 * and the public projections are the code that ships. Modules resolve on their
 * imported constants and the scope throws on anything else — a near-miss key
 * fails rather than falling back.
 *
 * Pinned: the four new routes are dark (404 feature_disabled through the real
 * `requireFeatureFlagMiddleware`) with FF_SHARED_GOAL_COALITION_V1 off and the
 * handler is never reached; creating a SHARED_GOAL campaign through the
 * unflagged POST is refused (409) when off; the unflagged list excludes
 * shared-goal rows when off and answers an EMPTY list (never production rows)
 * to a caller who asked for them; the unflagged GET/PATCH /:id answer an
 * existing shared-goal campaign with the same 404 body as an unknown id when
 * off; host-only writes answer `forbidden()` (403, one
 * body) for a non-host AND for a missing campaign — no 404-then-403 split;
 * the public progress read carries no donor identity and never reads backings;
 * one TREASURY collective_goal is created per shared-goal campaign.
 */

const FLAG = PHASE0_FEATURE_FLAGS.SHARED_GOAL_COALITION_V1

type Row = Record<string, unknown> & { id: string }

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

function matches(row: Row, filter: Record<string, unknown>) {
  return Object.entries(filter).every(([k, v]) => row[k] === v)
}

/** In-memory CRUD under the real service prototype. */
function makeCampaigns(seed: { campaigns?: Row[]; participants?: Row[]; milestones?: Row[] } = {}) {
  const campaigns: Row[] = (seed.campaigns ?? []).map((r) => ({ ...r }))
  const participants: Row[] = (seed.participants ?? []).map((r) => ({ ...r }))
  const milestones: Row[] = (seed.milestones ?? []).map((r) => ({ ...r }))
  const backingsRead = jest.fn().mockResolvedValue([])

  const service = Object.create(CollectiveCampaignModuleService.prototype) as CollectiveCampaignModuleService
  const shadow = service as unknown as Record<string, unknown>
  const table = (rows: Row[], prefix: string) => ({
    list: async (filter: Record<string, unknown> = {}) => rows.filter((r) => matches(r, filter)),
    create: async (data: Record<string, unknown>[]) => {
      const created = data.map((d, i) => ({ id: `${prefix}_${rows.length + i + 1}`, ...d }) as Row)
      rows.push(...created)
      return created
    },
    update: async (data: Record<string, unknown> & { id: string }) => {
      const row = rows.find((r) => r.id === data.id)
      if (!row) throw new Error(`${prefix} ${data.id} not found`)
      Object.assign(row, data)
      return row
    },
    remove: async (id: string) => {
      const i = rows.findIndex((r) => r.id === id)
      if (i >= 0) rows.splice(i, 1)
    },
  })
  const c = table(campaigns, "cc")
  const p = table(participants, "ccpart")
  const m = table(milestones, "ccms")
  Object.assign(shadow, {
    listCampaigns: c.list,
    createCampaigns: c.create,
    updateCampaigns: c.update,
    deleteCampaigns: c.remove,
    listParticipants: p.list,
    createParticipants: p.create,
    updateParticipants: p.update,
    deleteParticipants: p.remove,
    listMilestones: m.list,
    createMilestones: m.create,
    updateMilestones: m.update,
    deleteMilestones: m.remove,
    listMaterialLineItems: async () => [],
    listPurchaseOrders: async () => [],
    listYieldReports: async () => [],
    listBackings: backingsRead,
  })
  return { service, campaigns, participants, milestones, backingsRead }
}

function makeScope(opts: { campaigns?: ReturnType<typeof makeCampaigns>; questsThrow?: boolean } = {}) {
  const campaigns = opts.campaigns ?? makeCampaigns()
  const goals: Row[] = []
  const quests = {
    createCollectiveGoals: jest.fn(async (data: Record<string, unknown>) => {
      if (opts.questsThrow) throw new Error("collective-quest unavailable")
      const row = { id: `cgoal_${goals.length + 1}`, ...data } as Row
      goals.push(row)
      return row
    }),
  }
  const resolved: string[] = []
  const scope = {
    resolve: <T,>(key: string): T => {
      resolved.push(key)
      if (key === COLLECTIVE_CAMPAIGN_MODULE) return campaigns.service as unknown as T
      if (key === COLLECTIVE_QUEST_MODULE) return quests as unknown as T
      throw new Error(`Could not resolve '${key}'`)
    },
  }
  return { scope, resolved, campaigns, quests, goals }
}

type Handler = (req: any, res: any) => Promise<unknown>

/** The route as registered: the real flag middleware, then the handler. */
async function throughGate(handler: Handler, req: Record<string, unknown>) {
  const res = createRes()
  let reached = false
  await requireFeatureFlagMiddleware("SHARED_GOAL_COALITION_V1")(req as never, res as never, async () => {
    reached = true
    await handler(req, res)
  })
  return { res, reached }
}

const sharedCampaign = (over: Record<string, unknown> = {}): Row => ({
  id: "cc_shared",
  vendor_id: "seller_host",
  goal_kind: CAMPAIGN_GOAL_KIND_SHARED_GOAL,
  cooperative_id: "coop_1",
  name: "Winter heat",
  description: "Coalition goal",
  media: null,
  status: "ACTIVE",
  campaign_goal: 2500,
  total_backed_amount: 175,
  metadata: null,
  ...over,
})
const hostRow: Row = {
  id: "ccpart_host",
  campaign_id: "cc_shared",
  role: CampaignParticipantRole.HOST,
  seller_id: "seller_host",
  partner_org_key: "host_org",
  pledged_amount_cents: 0,
  contributed_amount_cents: 0,
  metadata: null,
}
const gulpRow: Row = {
  id: "ccpart_gulp",
  campaign_id: "cc_shared",
  role: CampaignParticipantRole.PARTNER,
  seller_id: null,
  partner_org_key: "ground_up_liberation_project",
  pledged_amount_cents: 50_000,
  contributed_amount_cents: 17_500,
  metadata: { internal_note: "do not publish" },
}

afterEach(() => {
  delete process.env[FLAG]
})

describe("FF_SHARED_GOAL_COALITION_V1 off — every shared-goal surface is dark", () => {
  it("the four gated routes answer 404 feature_disabled before the handler runs", async () => {
    const ctx = makeScope()
    const req = { params: { id: "cc_shared" }, scope: ctx.scope, body: {}, auth_context: { actor_id: "seller_host" } }
    for (const handler of [getProgress, getImpactReport, addParticipant, addMilestone]) {
      const { res, reached } = await throughGate(handler, req)
      expect(res.statusCode).toBe(404)
      expect(res.body).toMatchObject({ type: "feature_disabled", message: expect.stringContaining(FLAG) })
      expect(reached).toBe(false)
    }
    expect(ctx.resolved).toEqual([])
  })

  it("the unflagged POST refuses a SHARED_GOAL body with 409 feature_disabled and creates nothing", async () => {
    const ctx = makeScope()
    const res = createRes()
    await createCampaign(
      {
        auth_context: { actor_id: "seller_host" },
        body: { goal_kind: "SHARED_GOAL", name: "x", description: "y", goal_amount_cents: 1000 },
        scope: ctx.scope,
      } as never,
      res as never
    )
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "feature_disabled" })
    expect(ctx.campaigns.campaigns).toEqual([])
    expect(ctx.quests.createCollectiveGoals).not.toHaveBeenCalled()
  })

  it("the unflagged list excludes shared-goal rows, and a caller who asked for them gets an EMPTY list — never production rows under another name", async () => {
    const campaigns = makeCampaigns({
      campaigns: [sharedCampaign(), { id: "cc_prod", goal_kind: null, status: "ACTIVE", name: "Run", campaign_type: "PRODUCTION_RUN" }],
    })
    const ctx = makeScope({ campaigns })
    const ids = async (query: Record<string, unknown>) => {
      const res = createRes()
      await listCampaigns({ query, scope: ctx.scope } as never, res as never)
      expect(res.statusCode).toBe(200)
      return (res.body.campaigns as Row[]).map((c) => c.id)
    }
    expect(await ids({})).toEqual(["cc_prod"])
    expect(await ids({ goal_kind: "STANDARD" })).toEqual(["cc_prod"])
    // The storefront's own flag may be on while the API's is off: this query
    // must not be rewritten into the production list.
    expect(await ids({ goal_kind: "SHARED_GOAL" })).toEqual([])
    // Nothing was listed for it at all — the module was not even resolved.
    const before = ctx.resolved.length
    await ids({ goal_kind: "SHARED_GOAL" })
    expect(ctx.resolved.length).toBe(before)
  })

  it("the unflagged GET /:id answers an existing shared-goal campaign with the SAME 404 body as an unknown id; a production campaign still reads", async () => {
    const campaigns = makeCampaigns({
      campaigns: [sharedCampaign(), { id: "cc_prod", goal_kind: null, status: "ACTIVE", name: "Run", campaign_type: "PRODUCTION_RUN" }],
    })
    const ctx = makeScope({ campaigns })
    const read = async (id: string) => {
      const res = createRes()
      await getCampaign({ params: { id }, scope: ctx.scope } as never, res as never)
      return res
    }
    const dark = await read("cc_shared")
    const unknown = await read("cc_nope")
    expect(dark.statusCode).toBe(404)
    expect(unknown.statusCode).toBe(404)
    expect(dark.body).toEqual(unknown.body)
    expect(JSON.stringify(dark.body)).not.toContain("Winter heat")

    const prod = await read("cc_prod")
    expect(prod.statusCode).toBe(200)
    expect((prod.body.campaign_dashboard as { campaign: Row }).campaign.id).toBe("cc_prod")
  })

  it("the unflagged PATCH /:id refuses every action on a dark shared-goal campaign with the unknown-id 404, even from its vendor; the SHARED_GOAL-only ACTIVE -> COMPLETE is not reachable", async () => {
    const campaigns = makeCampaigns({ campaigns: [sharedCampaign()] })
    const ctx = makeScope({ campaigns })
    for (const body of [{ action: "activate" }, { action: "transition", status: "COMPLETE" }, { action: "mark-failed" }]) {
      const res = createRes()
      await patchCampaign(
        { params: { id: "cc_shared" }, body, scope: ctx.scope, auth_context: { actor_id: "seller_host" } } as never,
        res as never
      )
      expect(res.statusCode).toBe(404)
      expect(res.body).toEqual({ error: "Campaign not found" })
    }
    expect(campaigns.campaigns[0].status).toBe("ACTIVE")
  })

  it("middlewares.ts registers exactly the four new routes behind the flag and leaves /store/collective* unflagged", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../../../middlewares.ts"), "utf8")
    for (const [matcher, method] of [
      ["/store/collective/campaigns/:id/progress", "GET"],
      ["/store/collective/campaigns/:id/impact-report", "GET"],
      ["/store/collective/campaigns/:id/participants", "POST"],
      ["/store/collective/campaigns/:id/milestones", "POST"],
    ]) {
      const entry = new RegExp(
        `matcher: "${matcher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",\\s*method: "${method}",\\s*middlewares: \\[requireFeatureFlagMiddleware\\("SHARED_GOAL_COALITION_V1"\\)\\]`
      )
      expect(src).toMatch(entry)
    }
    const buyerCenter = src.slice(src.indexOf('matcher: "/vendor/collective*"'))
    expect(buyerCenter.slice(0, buyerCenter.indexOf("}"))).not.toContain("requireFeatureFlagMiddleware")
    expect(src).not.toMatch(/matcher: "\/store\/collective\*"/)
  })
})

describe("FF_SHARED_GOAL_COALITION_V1 on", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("GET /:id and PATCH /:id operate on a shared-goal campaign again: the dashboard reads and the SHARED_GOAL-only ACTIVE -> COMPLETE transition is honoured", async () => {
    const campaigns = makeCampaigns({ campaigns: [sharedCampaign()] })
    const ctx = makeScope({ campaigns })
    const get = createRes()
    await getCampaign({ params: { id: "cc_shared" }, scope: ctx.scope } as never, get as never)
    expect(get.statusCode).toBe(200)
    expect((get.body.campaign_dashboard as { campaign: Row }).campaign).toMatchObject({ id: "cc_shared", goal_kind: "SHARED_GOAL" })

    const patch = createRes()
    await patchCampaign(
      { params: { id: "cc_shared" }, body: { action: "transition", status: "COMPLETE" }, scope: ctx.scope, auth_context: { actor_id: "seller_host" } } as never,
      patch as never
    )
    expect(patch.statusCode).toBe(200)
    expect(campaigns.campaigns[0].status).toBe("COMPLETE")
  })

  it("the list includes shared goals by default, and `goal_kind` narrows either way", async () => {
    const campaigns = makeCampaigns({
      campaigns: [sharedCampaign(), { id: "cc_prod", goal_kind: null, status: "ACTIVE", name: "Run", campaign_type: "PRODUCTION_RUN" }],
    })
    const ctx = makeScope({ campaigns })
    const ids = async (query: Record<string, unknown>) => {
      const res = createRes()
      await listCampaigns({ query, scope: ctx.scope } as never, res as never)
      return (res.body.campaigns as Row[]).map((c) => c.id).sort()
    }
    expect(await ids({})).toEqual(["cc_prod", "cc_shared"])
    expect(await ids({ goal_kind: "SHARED_GOAL" })).toEqual(["cc_shared"])
    expect(await ids({ goal_kind: "STANDARD" })).toEqual(["cc_prod"])
  })

  it("POST goal_kind=SHARED_GOAL creates the campaign with a 0 fee, no lines, a HOST participant, milestones and one TREASURY thermometer goal", async () => {
    const ctx = makeScope()
    const res = createRes()
    await createCampaign(
      {
        auth_context: { actor_id: "seller_host" },
        body: {
          goal_kind: "SHARED_GOAL",
          name: "Winter heat",
          description: "Coalition goal",
          cooperative_id: "coop_1",
          host_partner_org_key: "host_org",
          goal_amount_cents: 250_000,
          milestones: [{ title: "First furnace", target_amount_cents: 80_000, sort_order: 1 }],
        },
        scope: ctx.scope,
      } as never,
      res as never
    )
    expect(res.statusCode).toBe(201)
    const campaign = ctx.campaigns.campaigns[0]
    expect(campaign).toMatchObject({
      goal_kind: "SHARED_GOAL",
      cooperative_id: "coop_1",
      vendor_id: "seller_host",
      maker_fee: 0,
      status: "DRAFT",
      // recalculateCampaignFinancials ran for real: goal from the override, 0 platform fee.
      campaign_goal: 2500,
      platform_fee_subtotal: 0,
      material_total: 0,
      maker_fee_subtotal: 0,
    })
    expect(ctx.campaigns.participants).toEqual([
      expect.objectContaining({ campaign_id: campaign.id, role: "HOST", seller_id: "seller_host", partner_org_key: "host_org" }),
    ])
    expect(ctx.campaigns.milestones).toEqual([expect.objectContaining({ title: "First furnace", target_amount_cents: 80_000, reached_at: null })])
    expect(ctx.quests.createCollectiveGoals).toHaveBeenCalledWith(
      expect.objectContaining({ scope_type: GoalScopeType.TREASURY, scope_id: campaign.id, den_id: "coop_1", target_value: 2500, unit: "USD" })
    )
    expect(res.body).toMatchObject({ thermometer_goal_id: "cgoal_1", participants: [expect.objectContaining({ role: "HOST" })] })
    expect(ctx.resolved).toEqual([COLLECTIVE_CAMPAIGN_MODULE, COLLECTIVE_QUEST_MODULE])
  })

  it("a thermometer that cannot be created is logged, not a reason to lose the campaign", async () => {
    const ctx = makeScope({ questsThrow: true })
    const res = createRes()
    await createCampaign(
      {
        auth_context: { actor_id: "seller_host" },
        body: { goal_kind: "SHARED_GOAL", name: "x", description: "y", goal_amount_cents: 1000 },
        scope: ctx.scope,
      } as never,
      res as never
    )
    expect(res.statusCode).toBe(201)
    expect(res.body.thermometer_goal_id).toBeNull()
    expect(ctx.campaigns.campaigns).toHaveLength(1)
  })

  it("POST goal_kind=SHARED_GOAL rejects material lines / maker fee shaped bodies with 400 and a production body still takes the old path", async () => {
    const ctx = makeScope()
    const res = createRes()
    await createCampaign(
      { auth_context: { actor_id: "seller_host" }, body: { goal_kind: "SHARED_GOAL", name: "x", description: "y", goal_amount_cents: 12.5 }, scope: ctx.scope } as never,
      res as never
    )
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe("Validation failed")
    expect(ctx.campaigns.campaigns).toEqual([])

    const prod = createRes()
    const legacy = { createCampaignWithMaterialLineItems: jest.fn().mockResolvedValue({ id: "cc_1" }) }
    await createCampaign(
      {
        auth_context: { actor_id: "vendor_1" },
        body: {
          name: "Campaign", description: "desc", campaign_type: "PRODUCTION_RUN", maker_fee: 10,
          material_line_items: [{ item_name: "cotton", supplier_url: "https://supplier.example/cotton", unit_cost_at_listing: 5, quantity_per_full_campaign: 10 }],
        },
        scope: { resolve: (key: string) => (key === COLLECTIVE_CAMPAIGN_MODULE ? legacy : undefined) },
      } as never,
      prod as never
    )
    expect(prod.statusCode).toBe(201)
    expect(legacy.createCampaignWithMaterialLineItems).toHaveBeenCalledTimes(1)
  })

  describe("host-only writes", () => {
    const seeded = () => makeCampaigns({ campaigns: [sharedCampaign()], participants: [hostRow, gulpRow] })
    const FORBIDDEN = { message: "You do not have access to this record.", type: "not_allowed" }

    it("401 without an actor, nothing resolved", async () => {
      const ctx = makeScope({ campaigns: seeded() })
      for (const handler of [addParticipant, addMilestone]) {
        const { res } = await throughGate(handler, { params: { id: "cc_shared" }, body: {}, scope: ctx.scope })
        expect(res.statusCode).toBe(401)
      }
      expect(ctx.resolved).toEqual([])
    })

    it("forbidden() for a non-host actor and the SAME 403 body for a missing campaign — no existence oracle", async () => {
      const ctx = makeScope({ campaigns: seeded() })
      const bodies = { participants: { partner_org_key: "new_org", role: "PARTNER" }, milestones: { title: "m", target_amount_cents: 100 } }

      const nonHost = await throughGate(addParticipant, { params: { id: "cc_shared" }, body: bodies.participants, scope: ctx.scope, auth_context: { actor_id: "seller_other" } })
      expect(nonHost.res.statusCode).toBe(403)
      expect(nonHost.res.body).toEqual(FORBIDDEN)

      // A participant org is not the host either: GULP's seller cannot add rows.
      const partner = await throughGate(addMilestone, { params: { id: "cc_shared" }, body: bodies.milestones, scope: ctx.scope, auth_context: { actor_id: "ground_up_liberation_project" } })
      expect(partner.res.statusCode).toBe(403)
      expect(partner.res.body).toEqual(FORBIDDEN)

      const missing = await throughGate(addParticipant, { params: { id: "cc_nope" }, body: bodies.participants, scope: ctx.scope, auth_context: { actor_id: "seller_host" } })
      expect(missing.res.statusCode).toBe(403)
      expect(missing.res.body).toEqual(FORBIDDEN)

      const missingMilestone = await throughGate(addMilestone, { params: { id: "cc_nope" }, body: bodies.milestones, scope: ctx.scope, auth_context: { actor_id: "seller_host" } })
      expect(missingMilestone.res.statusCode).toBe(403)
      expect(missingMilestone.res.body).toEqual(FORBIDDEN)

      expect(ctx.campaigns.participants).toHaveLength(2)
      expect(ctx.campaigns.milestones).toHaveLength(0)
    })

    it("the host adds a participant (201, real addParticipant) and a milestone (201, real addMilestone, reached_at from the current total)", async () => {
      const ctx = makeScope({ campaigns: seeded() })
      const p = await throughGate(addParticipant, {
        params: { id: "cc_shared" },
        body: { partner_org_key: "mutual_aid_kitchen", role: "SPONSOR", pledged_amount_cents: 20_000 },
        scope: ctx.scope,
        auth_context: { actor_id: "seller_host" },
      })
      expect(p.res.statusCode).toBe(201)
      expect(p.res.body.participant).toMatchObject({ role: "SPONSOR", partner_org_key: "mutual_aid_kitchen", pledged_amount_cents: 20_000, contributed_amount_cents: 0 })

      // The host cannot add a second HOST, and the schema refuses the role.
      const twoHosts = await throughGate(addParticipant, {
        params: { id: "cc_shared" }, body: { partner_org_key: "x_org", role: "HOST" }, scope: ctx.scope, auth_context: { actor_id: "seller_host" },
      })
      expect(twoHosts.res.statusCode).toBe(400)

      const m = await throughGate(addMilestone, {
        params: { id: "cc_shared" },
        body: { title: "Already met", target_amount_cents: 10_000 }, // total is 17,500 cents
        scope: ctx.scope,
        auth_context: { actor_id: "seller_host" },
      })
      expect(m.res.statusCode).toBe(201)
      expect((m.res.body.milestone as Row).reached_at).toBeInstanceOf(Date)
      expect(ctx.campaigns.participants).toHaveLength(3)
      expect(ctx.campaigns.milestones).toHaveLength(1)
    })
  })

  describe("public reads", () => {
    it("GET /progress is the real projection: cents, roles and totals, no donor identity, no metadata, backings never read", async () => {
      const campaigns = makeCampaigns({
        campaigns: [sharedCampaign()],
        participants: [hostRow, gulpRow],
        milestones: [{ id: "ccms_1", campaign_id: "cc_shared", title: "First furnace", target_amount_cents: 15_000, unit: "USD", sort_order: 1, reached_at: new Date("2026-10-02T00:00:00Z"), impact_summary: "Bought" }],
      })
      const ctx = makeScope({ campaigns })
      const { res, reached } = await throughGate(getProgress, { params: { id: "cc_shared" }, scope: ctx.scope })
      expect(reached).toBe(true)
      expect(res.statusCode).toBe(200)
      const progress = res.body.progress as Record<string, unknown>
      expect(progress.campaign).toMatchObject({ id: "cc_shared", goal_amount_cents: 250_000, contributed_total_cents: 17_500, percent_complete: 7 })
      expect(progress.participants).toEqual([
        { id: "ccpart_host", role: "HOST", partner_org_key: "host_org", seller_id: "seller_host", pledged_amount_cents: 0, contributed_amount_cents: 0 },
        { id: "ccpart_gulp", role: "PARTNER", partner_org_key: "ground_up_liberation_project", seller_id: null, pledged_amount_cents: 50_000, contributed_amount_cents: 17_500 },
      ])
      const text = JSON.stringify(res.body)
      expect(text).not.toContain("backer_id")
      expect(text).not.toContain("customer_id")
      expect(text).not.toContain("do not publish")
      expect(campaigns.backingsRead).not.toHaveBeenCalled()
      expect(ctx.resolved).toEqual([COLLECTIVE_CAMPAIGN_MODULE])
    })

    it("GET /impact-report: reached milestones, per-org totals, impact summary from campaign metadata", async () => {
      const campaigns = makeCampaigns({
        campaigns: [sharedCampaign({ metadata: { impact_summary: "Three blocks heated" } })],
        participants: [hostRow, gulpRow],
        milestones: [
          { id: "ccms_1", campaign_id: "cc_shared", title: "A", target_amount_cents: 15_000, unit: "USD", sort_order: 1, reached_at: new Date("2026-10-02T00:00:00Z"), impact_summary: "Bought" },
          { id: "ccms_2", campaign_id: "cc_shared", title: "B", target_amount_cents: 200_000, unit: "USD", sort_order: 2, reached_at: null, impact_summary: null },
        ],
      })
      const ctx = makeScope({ campaigns })
      const { res } = await throughGate(getImpactReport, { params: { id: "cc_shared" }, scope: ctx.scope })
      expect(res.statusCode).toBe(200)
      const report = res.body.impact_report as Record<string, unknown>
      expect((report.reached_milestones as Row[]).map((m) => m.id)).toEqual(["ccms_1"])
      expect(report.per_org_totals).toEqual([
        expect.objectContaining({ partner_org_key: "host_org", contributed_amount_cents: 0 }),
        expect.objectContaining({ partner_org_key: "ground_up_liberation_project", contributed_amount_cents: 17_500 }),
      ])
      expect(report.impact_summary).toBe("Three blocks heated")
    })

    it("a production campaign has no shared-goal reads (404), and so does an unknown id", async () => {
      const campaigns = makeCampaigns({ campaigns: [{ id: "cc_prod", goal_kind: null, status: "ACTIVE" }] })
      const ctx = makeScope({ campaigns })
      for (const id of ["cc_prod", "cc_nope"]) {
        const { res } = await throughGate(getProgress, { params: { id }, scope: ctx.scope })
        expect(res.statusCode).toBe(404)
      }
    })

    it("throws, not falls back, when the campaign module is under a near-miss key", async () => {
      const good = makeScope({ campaigns: makeCampaigns({ campaigns: [sharedCampaign()], participants: [hostRow] }) })
      const scope = {
        resolve: <T,>(key: string): T => {
          if (key === "collectiveCampaign") return good.campaigns.service as unknown as T
          throw new Error(`Could not resolve '${key}'`)
        },
      }
      const { res } = await throughGate(getProgress, { params: { id: "cc_shared" }, scope })
      expect(res.statusCode).toBe(500)
      expect(res.body.error).toMatch(/Could not resolve 'collectiveCampaignModuleService'/)
    })
  })
})

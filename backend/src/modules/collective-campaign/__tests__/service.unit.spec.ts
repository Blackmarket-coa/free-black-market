import CollectiveCampaignModuleService from "../service"
import {
  BackingMode,
  CAMPAIGN_GOAL_KIND_SHARED_GOAL,
  CampaignParticipantRole,
  CampaignStatus,
  CampaignType,
  PurchaseOrderStatus,
} from "../models"

describe("CollectiveCampaignModuleService", () => {
  it("createPurchaseOrdersFromMaterialLines is idempotent when purchase orders already exist", async () => {
    const existingOrders = [{ id: "po_existing" }]
    const ctx: any = {
      listCampaigns: jest.fn().mockResolvedValue([
        { id: "cc_1", campaign_type: CampaignType.PRODUCTION_RUN, status: CampaignStatus.FUNDED },
      ]),
      listPurchaseOrders: jest.fn().mockResolvedValue(existingOrders),
      listMaterialLineItems: jest.fn(),
      createPurchaseOrders: jest.fn(),
      updateCampaigns: jest.fn(),
    }

    const result = await CollectiveCampaignModuleService.prototype.createPurchaseOrdersFromMaterialLines.call(
      ctx,
      "cc_1"
    )

    expect(result).toEqual(existingOrders)
    expect(ctx.listMaterialLineItems).not.toHaveBeenCalled()
    expect(ctx.createPurchaseOrders).not.toHaveBeenCalled()
    expect(ctx.updateCampaigns).not.toHaveBeenCalled()
  })

  it("recovers and returns existing purchase orders when concurrent create races", async () => {
    const ctx: any = {
      listCampaigns: jest.fn().mockResolvedValue([
        { id: "cc_1", campaign_type: CampaignType.PRODUCTION_RUN, status: CampaignStatus.FUNDED },
      ]),
      listPurchaseOrders: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "po_after_race" }]),
      listMaterialLineItems: jest.fn().mockResolvedValue([
        {
          id: "li_1",
          supplier_url: "https://supplier.example/item",
          line_total_estimate: 250,
          auto_purchase_supported: true,
        },
      ]),
      createPurchaseOrders: jest.fn().mockRejectedValue(new Error("duplicate key value violates unique constraint")),
      updateCampaigns: jest.fn(),
    }

    const result = await CollectiveCampaignModuleService.prototype.createPurchaseOrdersFromMaterialLines.call(
      ctx,
      "cc_1"
    )

    expect(result).toEqual([{ id: "po_after_race" }])
    expect(ctx.updateCampaigns).not.toHaveBeenCalled()
  })

  it("creates purchase orders and updates campaign status when none exist", async () => {
    const lineItems = [
      {
        id: "li_1",
        supplier_url: "https://supplier.example/item",
        line_total_estimate: 250,
        auto_purchase_supported: true,
      },
    ]

    const ctx: any = {
      listCampaigns: jest.fn().mockResolvedValue([
        { id: "cc_1", campaign_type: CampaignType.PRODUCTION_RUN, status: CampaignStatus.FUNDED },
      ]),
      listPurchaseOrders: jest.fn().mockResolvedValue([]),
      listMaterialLineItems: jest.fn().mockResolvedValue(lineItems),
      createPurchaseOrders: jest.fn().mockResolvedValue([{ id: "po_1" }]),
      updateCampaigns: jest.fn().mockResolvedValue(undefined),
    }

    const result = await CollectiveCampaignModuleService.prototype.createPurchaseOrdersFromMaterialLines.call(
      ctx,
      "cc_1"
    )

    expect(ctx.createPurchaseOrders).toHaveBeenCalledWith([
      expect.objectContaining({
        campaign_id: "cc_1",
        material_line_item_id: "li_1",
        status: PurchaseOrderStatus.AUTO_EXECUTED,
      }),
    ])
    expect(ctx.updateCampaigns).toHaveBeenCalledWith({
      id: "cc_1",
      status: CampaignStatus.SOURCING,
    })
    expect(result).toEqual([{ id: "po_1" }])
  })

  it("rolls back campaign and created line items when line item creation fails", async () => {
    const ctx: any = {
      createCampaign: jest.fn().mockResolvedValue({ id: "cc_rollback" }),
      addMaterialLineItem: jest
        .fn()
        .mockResolvedValueOnce({ id: "li_1" })
        .mockRejectedValueOnce(new Error("supplier ingest failed")),
      listCampaigns: jest.fn().mockResolvedValue([]),
      listMaterialLineItems: jest.fn().mockResolvedValue([{ id: "li_1" }]),
      deleteMaterialLineItems: jest.fn().mockResolvedValue(undefined),
      deleteCampaigns: jest.fn().mockResolvedValue(undefined),
    }

    await expect(
      CollectiveCampaignModuleService.prototype.createCampaignWithMaterialLineItems.call(ctx, {
        campaign: {
          vendor_id: "vendor_1",
          name: "Campaign",
          description: "Test",
          campaign_type: CampaignType.PRODUCTION_RUN,
          maker_fee: 10,
        },
        material_line_items: [
          {
            item_name: "cotton",
            supplier_url: "https://supplier.example/cotton",
            unit_cost_at_listing: 5,
            quantity_per_full_campaign: 10,
          },
          {
            item_name: "dye",
            supplier_url: "https://supplier.example/dye",
            unit_cost_at_listing: 3,
            quantity_per_full_campaign: 5,
          },
        ],
      })
    ).rejects.toThrow("supplier ingest failed")

    expect(ctx.listMaterialLineItems).toHaveBeenCalledWith({ campaign_id: "cc_rollback" })
    expect(ctx.deleteMaterialLineItems).toHaveBeenCalledWith("li_1")
    expect(ctx.deleteCampaigns).toHaveBeenCalledWith("cc_rollback")
  })

  it("updates to FUNDED and triggers PO creation when backing hits goal", async () => {
    const ctx: any = {
      listCampaigns: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "cc_1",
            campaign_goal: 100,
            return_cap_multiplier: 2,
            status: CampaignStatus.ACTIVE,
          },
        ])
        .mockResolvedValueOnce([{ id: "cc_1", status: CampaignStatus.ACTIVE }]),
      createBackings: jest.fn().mockResolvedValue([{ id: "b_1" }]),
      listBackings: jest.fn().mockResolvedValue([
        { mode: BackingMode.PRE_ORDER, amount: 100 },
      ]),
      updateCampaigns: jest.fn().mockResolvedValue(undefined),
      createPurchaseOrdersFromMaterialLines: jest.fn().mockResolvedValue([]),
    }

    await CollectiveCampaignModuleService.prototype.addBacking.call(ctx, {
      campaign_id: "cc_1",
      backer_id: "backer_1",
      mode: BackingMode.PRE_ORDER,
      amount: 100,
    })

    expect(ctx.updateCampaigns).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cc_1", total_backed_amount: 100 })
    )
    expect(ctx.updateCampaigns).toHaveBeenCalledWith({ id: "cc_1", status: CampaignStatus.FUNDED })
    expect(ctx.createPurchaseOrdersFromMaterialLines).toHaveBeenCalledWith("cc_1")
  })
})

/**
 * Shared-goal Coalition campaigns (Phase 1 item 3). Every test calls the REAL
 * prototype method on a ctx that shadows only the generated CRUD, so the
 * assertions are about the service's own branches: the 0 fee, the no-material
 * create with a HOST participant, the SHARED_GOAL-only transitions, the
 * contribution bump + milestone stamping, and the addBacking refusal.
 */
describe("CollectiveCampaignModuleService — shared-goal Coalition campaigns", () => {
  const SHARED = CAMPAIGN_GOAL_KIND_SHARED_GOAL

  it("recalculateCampaignFinancials: platform_fee_subtotal is 0 for SHARED_GOAL and still 3% for a production campaign", async () => {
    const run = async (campaign: Record<string, unknown>) => {
      const ctx: any = {
        listCampaigns: jest.fn().mockResolvedValue([campaign]),
        listMaterialLineItems: jest.fn().mockResolvedValue([{ line_total_estimate: 100 }]),
        updateCampaigns: jest.fn().mockResolvedValue(undefined),
      }
      await CollectiveCampaignModuleService.prototype.recalculateCampaignFinancials.call(ctx, "cc_1")
      return ctx.updateCampaigns.mock.calls[0][0]
    }

    const shared = await run({ id: "cc_1", goal_kind: SHARED, maker_fee: 0, funding_goal_override: 500, shipping_per_unit: 0, batch_minimum: null })
    expect(shared.platform_fee_subtotal).toBe(0)
    expect(shared.campaign_goal).toBe(500)

    const production = await run({ id: "cc_1", goal_kind: null, maker_fee: 100, funding_goal_override: null, shipping_per_unit: 0, batch_minimum: null })
    expect(production.platform_fee_subtotal).toBeCloseTo(6)
    expect(production.campaign_goal).toBeCloseTo(206)
  })

  it("createSharedGoalCampaign: no material lines, maker fee 0, goal from cents, a HOST participant and the milestones", async () => {
    const created: Record<string, unknown>[] = []
    const participants: Record<string, unknown>[] = []
    const milestones: Record<string, unknown>[] = []
    const ctx: any = {
      createCampaigns: jest.fn(async (rows: Record<string, unknown>[]) => {
        created.push(...rows)
        return rows.map((r, i) => ({ id: `cc_${i + 1}`, ...r }))
      }),
      recalculateCampaignFinancials: jest.fn().mockResolvedValue(undefined),
      listCampaigns: jest.fn().mockResolvedValue([{ id: "cc_1", goal_kind: SHARED, total_backed_amount: 0 }]),
      createParticipants: jest.fn(async (rows: Record<string, unknown>[]) => {
        participants.push(...rows)
        return rows.map((r, i) => ({ id: `ccpart_${i + 1}`, ...r }))
      }),
      createMilestones: jest.fn(async (rows: Record<string, unknown>[]) => {
        milestones.push(...rows)
        return rows.map((r, i) => ({ id: `ccms_${i + 1}`, ...r }))
      }),
      addMaterialLineItem: jest.fn(),
    }
    // createCampaign / addMilestone are real: bind them to the ctx too.
    ctx.createCampaign = CollectiveCampaignModuleService.prototype.createCampaign.bind(ctx)
    ctx.addMilestone = CollectiveCampaignModuleService.prototype.addMilestone.bind(ctx)

    const campaign = await CollectiveCampaignModuleService.prototype.createSharedGoalCampaign.call(ctx, {
      vendor_id: "seller_host",
      name: "Winter heat for three blocks",
      description: "Coalition goal",
      cooperative_id: "coop_1",
      goal_amount_cents: 250_000,
      host_partner_org_key: "ground_up_liberation_project",
      milestones: [{ title: "First furnace", target_amount_cents: 80_000, sort_order: 1 }],
    })

    expect(campaign.id).toBe("cc_1")
    expect(created[0]).toMatchObject({
      goal_kind: SHARED,
      cooperative_id: "coop_1",
      maker_fee: 0,
      funding_goal_override: 2500,
      status: CampaignStatus.DRAFT,
    })
    expect(ctx.addMaterialLineItem).not.toHaveBeenCalled()
    expect(participants).toEqual([
      expect.objectContaining({
        campaign_id: "cc_1",
        role: CampaignParticipantRole.HOST,
        seller_id: "seller_host",
        partner_org_key: "ground_up_liberation_project",
        contributed_amount_cents: 0,
      }),
    ])
    expect(milestones).toEqual([
      expect.objectContaining({ campaign_id: "cc_1", title: "First furnace", target_amount_cents: 80_000, reached_at: null }),
    ])
  })

  it("createCampaign refuses a maker fee on a SHARED_GOAL campaign and requires one on a production campaign", async () => {
    const ctx: any = { createCampaigns: jest.fn() }
    await expect(
      CollectiveCampaignModuleService.prototype.createCampaign.call(ctx, {
        vendor_id: "v", name: "n", description: "d", campaign_type: CampaignType.PRODUCTION_RUN, goal_kind: SHARED, maker_fee: 10,
      })
    ).rejects.toThrow("no maker fee")
    await expect(
      CollectiveCampaignModuleService.prototype.createCampaign.call(ctx, {
        vendor_id: "v", name: "n", description: "d", campaign_type: CampaignType.PRODUCTION_RUN,
      })
    ).rejects.toThrow("maker_fee is required")
    expect(ctx.createCampaigns).not.toHaveBeenCalled()
  })

  it("createSharedGoalCampaign rolls the campaign back when a milestone write fails", async () => {
    const ctx: any = {
      createCampaign: jest.fn().mockResolvedValue({ id: "cc_rb" }),
      createParticipants: jest.fn().mockResolvedValue([{ id: "ccpart_1" }]),
      addMilestone: jest.fn().mockRejectedValue(new Error("milestone write failed")),
      listMilestones: jest.fn().mockResolvedValue([]),
      listParticipants: jest.fn().mockResolvedValue([{ id: "ccpart_1" }]),
      deleteMilestones: jest.fn(),
      deleteParticipants: jest.fn().mockResolvedValue(undefined),
      deleteCampaigns: jest.fn().mockResolvedValue(undefined),
    }
    await expect(
      CollectiveCampaignModuleService.prototype.createSharedGoalCampaign.call(ctx, {
        vendor_id: "v", name: "n", description: "d", goal_amount_cents: 100,
        milestones: [{ title: "m", target_amount_cents: 50 }],
      })
    ).rejects.toThrow("milestone write failed")
    expect(ctx.deleteParticipants).toHaveBeenCalledWith("ccpart_1")
    expect(ctx.deleteCampaigns).toHaveBeenCalledWith("cc_rb")
  })

  it("transitions: FUNDED -> COMPLETE and ACTIVE -> COMPLETE only for SHARED_GOAL", async () => {
    const attempt = async (campaign: Record<string, unknown>, next: CampaignStatus) => {
      const ctx: any = {
        listCampaigns: jest.fn().mockResolvedValue([campaign]),
        updateCampaigns: jest.fn().mockResolvedValue(undefined),
      }
      await CollectiveCampaignModuleService.prototype.transitionCampaignStatus.call(ctx, "cc_1", next)
      return ctx.updateCampaigns
    }

    const funded = await attempt({ id: "cc_1", goal_kind: SHARED, status: CampaignStatus.FUNDED }, CampaignStatus.COMPLETE)
    expect(funded).toHaveBeenCalledWith({ id: "cc_1", status: CampaignStatus.COMPLETE })
    const active = await attempt({ id: "cc_1", goal_kind: SHARED, status: CampaignStatus.ACTIVE }, CampaignStatus.COMPLETE)
    expect(active).toHaveBeenCalledWith({ id: "cc_1", status: CampaignStatus.COMPLETE })

    await expect(
      attempt({ id: "cc_1", goal_kind: null, status: CampaignStatus.FUNDED }, CampaignStatus.COMPLETE)
    ).rejects.toThrow("Invalid transition from FUNDED to COMPLETE")
    await expect(
      attempt({ id: "cc_1", goal_kind: null, status: CampaignStatus.ACTIVE }, CampaignStatus.COMPLETE)
    ).rejects.toThrow("Invalid transition from ACTIVE to COMPLETE")
    // A shared goal still cannot enter the production phases.
    await expect(
      attempt({ id: "cc_1", goal_kind: SHARED, status: CampaignStatus.COMPLETE }, CampaignStatus.SOURCING)
    ).rejects.toThrow("Invalid transition")
  })

  describe("recordParticipantContribution / reverseParticipantContribution", () => {
    type Row = Record<string, unknown> & { id: string }
    const matches = (row: Row, filter: Record<string, unknown>) => Object.entries(filter).every(([k, v]) => row[k] === v)

    /**
     * Real prototype over an in-memory CRUD. `contributions` mirrors the DB
     * unique index on (campaign_id, stripe_payment_intent_id); `barrierPreChecks`
     * holds the first N intent-keyed reads until all N have arrived, which is
     * the interleaving two concurrent webhook deliveries produce: both read
     * "nothing yet" before either inserts.
     */
    const build = (over: { campaign?: Record<string, unknown>; participants?: Row[]; milestones?: Row[]; contributions?: Row[]; barrierPreChecks?: number } = {}) => {
      const campaign = {
        id: "cc_1",
        goal_kind: SHARED,
        status: CampaignStatus.ACTIVE,
        campaign_goal: 2500, // major units: $2,500.00
        total_backed_amount: 100,
        ...over.campaign,
      }
      const participants: Row[] = (over.participants ?? [
        { id: "ccpart_host", campaign_id: "cc_1", role: "HOST", partner_org_key: "host_org", seller_id: "seller_host", contributed_amount_cents: 0 },
        { id: "ccpart_gulp", campaign_id: "cc_1", role: "PARTNER", partner_org_key: "ground_up_liberation_project", seller_id: null, contributed_amount_cents: 10_000 },
      ]).map((p) => ({ ...p }))
      const milestones: Row[] = (over.milestones ?? [
        { id: "ccms_1", campaign_id: "cc_1", target_amount_cents: 15_000, reached_at: null },
        { id: "ccms_2", campaign_id: "cc_1", target_amount_cents: 200_000, reached_at: null },
        { id: "ccms_done", campaign_id: "cc_1", target_amount_cents: 5_000, reached_at: new Date("2026-10-01T00:00:00Z") },
      ]).map((m) => ({ ...m }))
      // The 10,000 cents gulp already shows is one counted intent, not a bare number.
      const contributions: Row[] = (over.contributions ?? [
        { id: "cccon_seed", campaign_id: "cc_1", participant_id: "ccpart_gulp", partner_org_key: "ground_up_liberation_project", stripe_payment_intent_id: "pi_seed", amount_cents: 10_000, reversed_at: null },
      ]).map((c) => ({ ...c }))

      let barrierRemaining = over.barrierPreChecks ?? 0
      let waiting: Array<() => void> = []
      const ctx: any = {
        listCampaigns: jest.fn().mockResolvedValue([campaign]),
        listParticipants: jest.fn(async (filter: Record<string, unknown>) => participants.filter((p) => matches(p, filter))),
        updateParticipants: jest.fn(async (data: Row) => {
          Object.assign(participants.find((p) => p.id === data.id)!, data)
        }),
        listMilestones: jest.fn().mockResolvedValue(milestones),
        updateMilestones: jest.fn(async (data: Row) => {
          Object.assign(milestones.find((m) => m.id === data.id)!, data)
        }),
        updateCampaigns: jest.fn().mockResolvedValue(undefined),
        listContributions: jest.fn(async (filter: Record<string, unknown>) => {
          if ("stripe_payment_intent_id" in filter && barrierRemaining > 0) {
            barrierRemaining -= 1
            await new Promise<void>((resolve) => {
              waiting.push(resolve)
              if (barrierRemaining === 0) {
                waiting.forEach((w) => w())
                waiting = []
              }
            })
          }
          return contributions.filter((c) => matches(c, filter))
        }),
        createContributions: jest.fn(async (rows: Record<string, unknown>[]) => {
          for (const row of rows) {
            if (contributions.some((c) => c.campaign_id === row.campaign_id && c.stripe_payment_intent_id === row.stripe_payment_intent_id)) {
              throw new Error("UNIQUE UQ_collective_campaign_contribution_campaign_intent")
            }
          }
          const created = rows.map((r, i) => ({ id: `cccon_${contributions.length + i + 1}`, ...r }) as Row)
          contributions.push(...created)
          return created
        }),
        updateContributions: jest.fn(async (data: Row) => {
          Object.assign(contributions.find((c) => c.id === data.id)!, data)
        }),
        createBackings: jest.fn(),
        createPurchaseOrdersFromMaterialLines: jest.fn(),
      }
      return { ctx, participants, milestones, contributions }
    }
    const record = (ctx: any, input: Record<string, unknown>) =>
      CollectiveCampaignModuleService.prototype.recordParticipantContribution.call(ctx, {
        campaign_id: "cc_1",
        partner_org_key: "ground_up_liberation_project",
        stripe_payment_intent_id: "pi_1",
        amount_cents: 7_500,
        ...input,
      } as any)
    const reverse = (ctx: any, intent: string) =>
      CollectiveCampaignModuleService.prototype.reverseParticipantContribution.call(ctx, { campaign_id: "cc_1", stripe_payment_intent_id: intent })
    const gulpTotal = (participants: Row[]) => participants.find((p) => p.id === "ccpart_gulp")!.contributed_amount_cents

    it("records the intent, derives the participant and campaign totals from the rows (major units on the campaign), stamps the milestones met, and never touches backings or escrow", async () => {
      const { ctx, participants, milestones, contributions } = build()
      const result = await record(ctx, {})

      expect(result).toMatchObject({
        recorded: true,
        participant_id: "ccpart_gulp",
        contributed_amount_cents: 17_500,
        campaign_total_cents: 17_500,
        milestones_reached: ["ccms_1"],
        status: CampaignStatus.ACTIVE,
      })
      expect(contributions).toContainEqual(
        expect.objectContaining({ campaign_id: "cc_1", participant_id: "ccpart_gulp", stripe_payment_intent_id: "pi_1", amount_cents: 7_500, reversed_at: null })
      )
      expect(gulpTotal(participants)).toBe(17_500)
      // 17,500 cents -> 175.00 major units on the campaign column.
      expect(ctx.updateCampaigns).toHaveBeenCalledWith({ id: "cc_1", total_backed_amount: 175 })
      expect(milestones.find((m) => m.id === "ccms_1")!.reached_at).toBeInstanceOf(Date)
      expect(milestones.find((m) => m.id === "ccms_2")!.reached_at).toBeNull()
      // An already-reached milestone keeps its original stamp.
      expect(milestones.find((m) => m.id === "ccms_done")!.reached_at).toEqual(new Date("2026-10-01T00:00:00Z"))
      expect(ctx.createBackings).not.toHaveBeenCalled()
      expect(ctx.createPurchaseOrdersFromMaterialLines).not.toHaveBeenCalled()
      expect(ctx.updateCampaigns).not.toHaveBeenCalledWith(expect.objectContaining({ status: expect.anything() }))
    })

    it("moves an ACTIVE campaign to FUNDED at the goal, without purchase orders; a FUNDED campaign keeps counting", async () => {
      const { ctx } = build({ campaign: { campaign_goal: 150 } }) // $150.00 = 15,000 cents
      const result = await record(ctx, { amount_cents: 5_000 })
      expect(result).toMatchObject({ recorded: true, campaign_total_cents: 15_000, status: CampaignStatus.FUNDED })
      expect(ctx.updateCampaigns).toHaveBeenCalledWith({ id: "cc_1", status: CampaignStatus.FUNDED })
      expect(ctx.createPurchaseOrdersFromMaterialLines).not.toHaveBeenCalled()

      const funded = build({ campaign: { status: CampaignStatus.FUNDED, campaign_goal: 150 } })
      expect(await record(funded.ctx, { stripe_payment_intent_id: "pi_2", amount_cents: 100 })).toMatchObject({ recorded: true, campaign_total_cents: 10_100, status: CampaignStatus.FUNDED })
    })

    it("reports, never guesses, an org that is not a participant", async () => {
      const { ctx, contributions } = build()
      const result = await record(ctx, { partner_org_key: "some_other_org", amount_cents: 100 })
      expect(result).toEqual({ recorded: false, reason: "no_participant", campaign_id: "cc_1" })
      expect(contributions).toHaveLength(1)
      expect(ctx.updateParticipants).not.toHaveBeenCalled()
      expect(ctx.updateCampaigns).not.toHaveBeenCalled()
    })

    it("does not count a charge stamped with a campaign that is not open: DRAFT, COMPLETE and FAILED are campaign_closed, nothing written", async () => {
      for (const status of [CampaignStatus.DRAFT, CampaignStatus.COMPLETE, CampaignStatus.FAILED]) {
        const { ctx, contributions } = build({ campaign: { status } })
        expect(await record(ctx, {})).toEqual({ recorded: false, reason: "campaign_closed", campaign_id: "cc_1" })
        expect(contributions).toHaveLength(1)
        expect(ctx.createContributions).not.toHaveBeenCalled()
        expect(ctx.updateCampaigns).not.toHaveBeenCalled()
      }
    })

    it("refuses a production campaign, a non-integer or non-positive amount, and a missing intent id", async () => {
      const prod = build({ campaign: { goal_kind: null } })
      await expect(record(prod.ctx, {})).rejects.toThrow("Campaign not found")
      for (const amount_cents of [12.5, 0, -1]) {
        const { ctx } = build()
        await expect(record(ctx, { amount_cents })).rejects.toThrow("positive integer")
        expect(ctx.createContributions).not.toHaveBeenCalled()
      }
      const { ctx } = build()
      await expect(record(ctx, { stripe_payment_intent_id: "" })).rejects.toThrow("stripe_payment_intent_id is required")
      expect(ctx.createContributions).not.toHaveBeenCalled()
    })

    it("a replay of the same intent is already_recorded: nothing inserted, totals untouched", async () => {
      const { ctx, participants } = build()
      await record(ctx, {})
      const writesAfterFirst = ctx.updateParticipants.mock.calls.length
      expect(await record(ctx, {})).toEqual({ recorded: false, reason: "already_recorded", campaign_id: "cc_1" })
      expect(ctx.createContributions).toHaveBeenCalledTimes(1)
      expect(ctx.updateParticipants.mock.calls.length).toBe(writesAfterFirst)
      expect(gulpTotal(participants)).toBe(17_500)
    })

    it("two CONCURRENT deliveries of one intent: both pass the read, the unique index arbitrates the insert, exactly one counts", async () => {
      const { ctx, participants, contributions } = build({ barrierPreChecks: 2 })
      const [a, b] = await Promise.all([record(ctx, {}), record(ctx, {})])

      const outcomes = [a, b].map((r) => (r.recorded ? "recorded" : r.reason)).sort()
      expect(outcomes).toEqual(["already_recorded", "recorded"])
      // Both got past the pre-check and tried to insert; the second insert hit the index.
      expect(ctx.createContributions).toHaveBeenCalledTimes(2)
      expect(contributions.filter((c) => c.stripe_payment_intent_id === "pi_1")).toHaveLength(1)
      expect(gulpTotal(participants)).toBe(17_500)
      const totals = ctx.updateCampaigns.mock.calls.map((c: [Record<string, unknown>]) => c[0].total_backed_amount)
      expect(totals).toEqual([175])
    })

    it("two DIFFERENT intents for the same org arriving together both count and neither update is lost: totals are derived, not incremented", async () => {
      const { ctx, participants } = build({ barrierPreChecks: 2 })
      const [a, b] = await Promise.all([
        record(ctx, { stripe_payment_intent_id: "pi_a", amount_cents: 2_000 }),
        record(ctx, { stripe_payment_intent_id: "pi_b", amount_cents: 3_000 }),
      ])
      expect(a).toMatchObject({ recorded: true })
      expect(b).toMatchObject({ recorded: true })
      // 10,000 seeded + 2,000 + 3,000: a `+= amount` on a stale read would have left 12,000 or 13,000.
      expect(gulpTotal(participants)).toBe(15_000)
      const lastTotal = ctx.updateCampaigns.mock.calls.at(-1)![0]
      expect(lastTotal).toEqual({ id: "cc_1", total_backed_amount: 150 })
    })

    it("reverseParticipantContribution: a full refund stops the intent counting and re-derives both totals (floor 0); reached_at is left as stamped; idempotent; unknown intent is not_recorded", async () => {
      const { ctx, participants, milestones, contributions } = build()
      await record(ctx, {}) // gulp 17,500; ccms_1 (15,000) stamped
      expect(milestones.find((m) => m.id === "ccms_1")!.reached_at).toBeInstanceOf(Date)

      const r = await reverse(ctx, "pi_1")
      expect(r).toEqual({ reversed: true, participant_id: "ccpart_gulp", campaign_id: "cc_1", contributed_amount_cents: 10_000, campaign_total_cents: 10_000 })
      expect(contributions.find((c) => c.stripe_payment_intent_id === "pi_1")!.reversed_at).toBeInstanceOf(Date)
      expect(gulpTotal(participants)).toBe(10_000)
      expect(ctx.updateCampaigns).toHaveBeenLastCalledWith({ id: "cc_1", total_backed_amount: 100 })
      // Un-reaching a milestone is a semantics decision for AUDIT_DEBT, not taken here.
      expect(milestones.find((m) => m.id === "ccms_1")!.reached_at).toBeInstanceOf(Date)
      expect(ctx.updateCampaigns).not.toHaveBeenCalledWith(expect.objectContaining({ status: expect.anything() }))

      expect(await reverse(ctx, "pi_1")).toEqual({ reversed: false, reason: "already_reversed", campaign_id: "cc_1" })
      expect(await reverse(ctx, "pi_never")).toEqual({ reversed: false, reason: "not_recorded", campaign_id: "cc_1" })

      // Reversing the only counted intent floors at 0, never below.
      await reverse(ctx, "pi_seed")
      expect(gulpTotal(participants)).toBe(0)
      expect(ctx.updateCampaigns).toHaveBeenLastCalledWith({ id: "cc_1", total_backed_amount: 0 })

      // The same intent can never be counted again after a reversal: the row still exists.
      expect(await record(ctx, {})).toEqual({ recorded: false, reason: "already_recorded", campaign_id: "cc_1" })
    })
  })

  it("addBacking is refused on a SHARED_GOAL campaign before any row is written", async () => {
    const ctx: any = {
      listCampaigns: jest.fn().mockResolvedValue([{ id: "cc_1", goal_kind: SHARED, status: CampaignStatus.ACTIVE, campaign_goal: 100 }]),
      createBackings: jest.fn(),
      listBackings: jest.fn(),
      updateCampaigns: jest.fn(),
      createPurchaseOrdersFromMaterialLines: jest.fn(),
    }
    await expect(
      CollectiveCampaignModuleService.prototype.addBacking.call(ctx, {
        campaign_id: "cc_1", backer_id: "cus_1", mode: BackingMode.PRE_ORDER, amount: 10,
      })
    ).rejects.toThrow("do not take backings")
    expect(ctx.createBackings).not.toHaveBeenCalled()
    expect(ctx.updateCampaigns).not.toHaveBeenCalled()
  })

  it("addParticipant: SHARED_GOAL only, one host, org or seller required, no duplicate org, no duplicate seller-only row", async () => {
    const make = (campaign: Record<string, unknown>, existing: Record<string, unknown>[] = []) => {
      const ctx: any = {
        listCampaigns: jest.fn().mockResolvedValue([campaign]),
        listParticipants: jest.fn().mockResolvedValue(existing),
        createParticipants: jest.fn(async (rows: Record<string, unknown>[]) => rows.map((r) => ({ id: "ccpart_new", ...r }))),
      }
      return ctx
    }
    const shared = { id: "cc_1", goal_kind: SHARED }
    const add = (ctx: any, input: Record<string, unknown>) =>
      CollectiveCampaignModuleService.prototype.addParticipant.call(ctx, { campaign_id: "cc_1", ...input } as any)

    await expect(add(make({ id: "cc_1", goal_kind: null }), { partner_org_key: "o", role: CampaignParticipantRole.PARTNER })).rejects.toThrow("Campaign not found")
    await expect(add(make(shared), { role: CampaignParticipantRole.PARTNER })).rejects.toThrow("partner_org_key or a seller_id")
    await expect(add(make(shared), { partner_org_key: "o", role: CampaignParticipantRole.HOST })).rejects.toThrow("one host")
    await expect(add(make(shared, [{ id: "dup" }]), { partner_org_key: "o", role: CampaignParticipantRole.PARTNER })).rejects.toThrow("organisation is already a participant")
    // A seller-only row is checked on (campaign_id, seller_id, partner_org_key: null), mirroring UQ_..._campaign_seller.
    const sellerDup = make(shared, [{ id: "dup_seller" }])
    await expect(add(sellerDup, { seller_id: "seller_2", role: CampaignParticipantRole.COLLECTIVE })).rejects.toThrow("seller is already a participant")
    expect(sellerDup.listParticipants).toHaveBeenCalledWith({ campaign_id: "cc_1", seller_id: "seller_2", partner_org_key: null })
    await expect(add(make(shared), { partner_org_key: "o", role: CampaignParticipantRole.PARTNER, pledged_amount_cents: 1.5 })).rejects.toThrow("non-negative integer")

    const ok = make(shared)
    const row = await add(ok, { partner_org_key: "o", role: CampaignParticipantRole.SPONSOR, pledged_amount_cents: 5_000 })
    expect(row).toMatchObject({ id: "ccpart_new", role: "SPONSOR", partner_org_key: "o", seller_id: null, pledged_amount_cents: 5_000, contributed_amount_cents: 0 })
  })

  it("getCoalitionProgress is computed from participants and milestones, in cents, with no donor identity and no backing read", async () => {
    const ctx: any = {
      listCampaigns: jest.fn().mockResolvedValue([
        { id: "cc_1", goal_kind: SHARED, cooperative_id: "coop_1", name: "Goal", description: "d", media: null, status: "ACTIVE", campaign_goal: 2500, total_backed_amount: 175, metadata: null, vendor_id: "seller_host" },
      ]),
      listMilestones: jest.fn().mockResolvedValue([
        { id: "ccms_2", title: "B", target_amount_cents: 200_000, unit: "USD", sort_order: 2, reached_at: null, impact_summary: null },
        { id: "ccms_1", title: "A", target_amount_cents: 15_000, unit: "USD", sort_order: 1, reached_at: new Date("2026-10-02T00:00:00Z"), impact_summary: "Furnace bought" },
      ]),
      listParticipants: jest.fn().mockResolvedValue([
        { id: "ccpart_gulp", role: "PARTNER", partner_org_key: "ground_up_liberation_project", seller_id: null, pledged_amount_cents: 0, contributed_amount_cents: 17_500, metadata: { note: "internal" } },
      ]),
      listBackings: jest.fn(),
    }

    const progress = await CollectiveCampaignModuleService.prototype.getCoalitionProgress.call(ctx, "cc_1")
    expect(progress.campaign).toEqual({
      id: "cc_1", goal_kind: SHARED, cooperative_id: "coop_1", name: "Goal", description: "d", media: null, status: "ACTIVE",
      goal_amount_cents: 250_000, contributed_total_cents: 17_500, percent_complete: 7,
    })
    expect(progress.milestones.map((m) => m.id)).toEqual(["ccms_1", "ccms_2"])
    expect(progress.participants).toEqual([
      { id: "ccpart_gulp", role: "PARTNER", partner_org_key: "ground_up_liberation_project", seller_id: null, pledged_amount_cents: 0, contributed_amount_cents: 17_500 },
    ])
    expect(ctx.listBackings).not.toHaveBeenCalled()
    const serialised = JSON.stringify(progress)
    expect(serialised).not.toContain("backer_id")
    expect(serialised).not.toContain("customer_id")
    expect(serialised).not.toContain("internal")

    const report = await CollectiveCampaignModuleService.prototype.getJointImpactReport.call(
      { ...ctx, listYieldReports: jest.fn().mockResolvedValue([]) },
      "cc_1"
    )
    expect(report.reached_milestones.map((m) => m.id)).toEqual(["ccms_1"])
    expect(report.per_org_totals).toEqual([
      { participant_id: "ccpart_gulp", role: "PARTNER", partner_org_key: "ground_up_liberation_project", seller_id: null, pledged_amount_cents: 0, contributed_amount_cents: 17_500 },
    ])
    expect(report.impact_summary).toBeNull()
  })
})

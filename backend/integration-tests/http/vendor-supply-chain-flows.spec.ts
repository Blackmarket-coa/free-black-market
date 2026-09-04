import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  createAuthenticatedSeller,
  authHeader,
  safe,
  AuthenticatedSeller,
} from "./helpers/seller-auth"

// Boot (~45-75s) + two seller bootstraps need headroom.
jest.setTimeout(180 * 1000)

/**
 * End-to-end HTTP coverage for the three supply-chain modules:
 * production-costing, fund-accounting and aid-network.
 *
 * Runs the real seller-auth path through the /vendor/* routes with their
 * feature flags enabled, on a database migrated by the app boot — so this is
 * the surface where the migrations, the route validation, the plan gate and
 * the service guards are all exercised together.
 *
 * Three sellers on purpose. `paid` and `other` are both on `internal` (every
 * plan key): the difference between them is ownership, so `other` is the actor
 * for every isolation check. `free` holds no plan key: the difference between
 * it and `paid` is the `vendor.fund_accounting` paywall, so `free` is the actor
 * for every gate check — and only for those, because a plan-gated route 402s
 * before its ownership check can ever be reached. aid-network carries no plan
 * key and must answer the free seller too.
 *
 * All requests run inside a SINGLE test per describe on purpose — the in-app
 * server closes idle keep-alive sockets between separate it() blocks.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {
    FF_PRODUCTION_LEDGER_V1: "true",
    FF_PRODUCTION_COSTING_V1: "true",
    FF_FUND_ACCOUNTING_V1: "true",
    FF_AID_NETWORK_V1: "true",
  },
  testSuite: ({ api, getContainer }) => {
    describe("Supply-chain vendor flows", () => {
      let paid: AuthenticatedSeller
      let other: AuthenticatedSeller
      let free: AuthenticatedSeller

      beforeAll(async () => {
        paid = await createAuthenticatedSeller({ api, getContainer })
        other = await createAuthenticatedSeller({ api, getContainer })
        free = await createAuthenticatedSeller({ api, getContainer, planCode: "free" })
      })

      it("costs a batch, gates funds by plan, and routes stock between hubs", async () => {
        const h = authHeader(paid.token)
        const hOther = authHeader(other.token)
        const hFree = authHeader(free.token)

        // ── Auth gate on every surface ────────────────────────────────────
        for (const path of [
          "/vendor/production-costs",
          "/vendor/funds",
          "/vendor/aid-network/nodes",
        ]) {
          const noAuth = await safe(api.get(path))
          expect([401, 403]).toContain(noAuth.status)
        }

        // ── production-costing ────────────────────────────────────────────
        const batch = await safe(
          api.post(
            "/vendor/production-batches",
            { item_label: "Sourdough", qty_started: 12, yield_qty: 10 },
            h
          )
        )
        expect(batch.status).toBe(201)
        const batchId = batch.data.production_batch.id

        // Validation: category is an enum, amount is required.
        const badCategory = await safe(
          api.post(
            "/vendor/production-costs",
            { production_batch_id: batchId, category: "vibes", label: "x", amount_cents: 1 },
            h
          )
        )
        expect(badCategory.status).toBe(400)

        // Ownership: another (paid) seller's batch reads as 404, never confirmed.
        const foreignBatch = await safe(
          api.post(
            "/vendor/production-costs",
            { production_batch_id: batchId, category: "material", label: "x", amount_cents: 1 },
            hOther
          )
        )
        expect(foreignBatch.status).toBe(404)

        const material = await safe(
          api.post(
            "/vendor/production-costs",
            {
              production_batch_id: batchId,
              category: "material",
              label: "Flour",
              quantity: 3,
              unit_amount_cents: 1000,
            },
            h
          )
        )
        expect(material.status).toBe(201)
        expect(Number(material.data.production_cost_entry.amount_cents)).toBe(3000)

        const labor = await safe(
          api.post(
            "/vendor/production-costs",
            {
              production_batch_id: batchId,
              category: "labor",
              label: "Volunteer bake shift",
              source: "donated",
              amount_cents: 1000,
            },
            h
          )
        )
        expect(labor.status).toBe(201)
        expect(labor.data.production_cost_entry.is_cash_outlay).toBe(false)

        const rollup = await safe(
          api.get(
            `/vendor/production-costs/rollup?production_batch_id=${batchId}&price_cents=800`,
            h
          )
        )
        expect(rollup.status).toBe(200)
        expect(rollup.data.costing.total_cents).toBe(4000)
        expect(rollup.data.costing.cash_outlay_cents).toBe(3000)
        expect(rollup.data.costing.unit_cost_cents).toBe(400)
        expect(rollup.data.costing.margin_percent_at_price).toBe(50)

        // ── fund-accounting: the plan gate ────────────────────────────────
        // Free plan holds no vendor.fund_accounting: 402, not 404 — the
        // feature exists here, they just may not have it.
        const gated = await safe(api.get("/vendor/funds", hFree))
        expect(gated.status).toBe(402)

        const fund = await safe(
          api.post(
            "/vendor/funds",
            {
              name: "Local Food Purchase Assistance",
              code: "LFPA-24",
              restriction: "purpose_and_time",
              designated_program_id: "prog_meals",
              spend_from: "2026-01-01",
              spend_until: "2026-12-31",
            },
            h
          )
        )
        expect(fund.status).toBe(201)
        const fundId = fund.data.fund.id

        const badWindow = await safe(
          api.post(
            "/vendor/funds",
            { name: "x", code: "BAD", spend_from: "2026-12-31", spend_until: "2026-01-01" },
            h
          )
        )
        expect(badWindow.status).toBe(400)

        const award = await safe(
          api.post(
            `/vendor/funds/${fundId}/entries`,
            { entry_type: "award", amount_cents: 10_000 },
            h
          )
        )
        expect(award.status).toBe(201)

        // The guard's refusal is a 409 carrying the reason, not a 500.
        const overspend = await safe(
          api.post(
            `/vendor/funds/${fundId}/entries`,
            { entry_type: "expenditure", amount_cents: 12_000, occurred_at: "2026-06-01" },
            h
          )
        )
        expect(overspend.status).toBe(409)
        expect(overspend.data.message).toMatch(/unspent award/i)

        const outOfPeriod = await safe(
          api.post(
            `/vendor/funds/${fundId}/entries`,
            { entry_type: "expenditure", amount_cents: 100, occurred_at: "2027-06-01" },
            h
          )
        )
        expect(outOfPeriod.status).toBe(409)
        expect(outOfPeriod.data.message).toMatch(/spend period/i)

        // Off-purpose is a finding, not a refusal.
        const offPurpose = await safe(
          api.post(
            `/vendor/funds/${fundId}/entries`,
            {
              entry_type: "expenditure",
              amount_cents: 1_000,
              program_id: "prog_admin",
              occurred_at: "2026-06-01",
            },
            h
          )
        )
        expect(offPurpose.status).toBe(201)

        const report = await safe(api.get(`/vendor/funds/${fundId}/report`, h))
        expect(report.status).toBe(200)
        expect(report.data.report.rollup.unspent_award_cents).toBe(9_000)
        expect(report.data.report.violations.map((v: any) => v.code)).toEqual([
          "off_purpose",
        ])

        const portfolio = await safe(api.get("/vendor/funds/portfolio", h))
        expect(portfolio.status).toBe(200)
        expect(portfolio.data.funds_with_violations).toBe(1)

        // Ownership: a paid seller who passes the gate still cannot read
        // another seller's fund.
        const foreignReport = await safe(api.get(`/vendor/funds/${fundId}/report`, hOther))
        expect(foreignReport.status).toBe(404)

        // ── aid-network: free on every plan ───────────────────────────────
        const freeNodes = await safe(api.get("/vendor/aid-network/nodes", hFree))
        expect(freeNodes.status).toBe(200)

        const halfCoordinate = await safe(
          api.post(
            "/vendor/aid-network/nodes",
            { name: "Half", slug: "half", latitude: 39.95 },
            h
          )
        )
        expect(halfCoordinate.status).toBe(400)

        const pantry = await safe(
          api.post(
            "/vendor/aid-network/nodes",
            { name: "North Pantry", slug: "north", latitude: 39.95, longitude: -75.16 },
            h
          )
        )
        expect(pantry.status).toBe(201)
        const pantryId = pantry.data.network_node.id

        const store = await safe(
          api.post(
            "/vendor/aid-network/nodes",
            {
              name: "Free Store",
              slug: "store",
              latitude: 39.94,
              longitude: -75.12,
              has_cold_storage: false,
            },
            h
          )
        )
        expect(store.status).toBe(201)
        const storeId = store.data.network_node.id

        const intake = await safe(
          api.post(
            "/vendor/aid-network/intake",
            {
              node_id: pantryId,
              source: "rescue",
              donor_name: "Corner Market",
              estimated_value_cents: 12_500,
              valuation_basis: "USDA wholesale",
              lines: [
                { item_key: "produce.carrots", item_label: "Carrots", quantity: 40 },
                {
                  item_key: "dairy.milk",
                  item_label: "Milk",
                  quantity: 12,
                  requires_cold: true,
                },
              ],
            },
            h
          )
        )
        expect(intake.status).toBe(201)
        expect(intake.data.node_stock).toHaveLength(2)

        // Ownership on intake: another seller cannot stock this seller's hub.
        const foreignIntake = await safe(
          api.post(
            "/vendor/aid-network/intake",
            { node_id: pantryId, lines: [{ item_key: "x", item_label: "x", quantity: 1 }] },
            hOther
          )
        )
        expect(foreignIntake.status).toBe(404)

        const plan = await safe(
          api.post(
            "/vendor/aid-network/allocation-plan",
            {
              demands: [
                { node_id: storeId, item_key: "produce.carrots", quantity: 25 },
                { node_id: storeId, item_key: "dairy.milk", quantity: 6 },
              ],
            },
            h
          )
        )
        expect(plan.status).toBe(200)
        expect(plan.data.transfer_count).toBe(1)
        expect(plan.data.plan.allocations[0]).toMatchObject({
          from_node_id: pantryId,
          to_node_id: storeId,
          item_key: "produce.carrots",
          quantity: 25,
        })
        // Milk cannot go to a hub without cold storage, and the plan says so.
        expect(plan.data.plan.unmet).toHaveLength(1)
        expect(plan.data.plan.unmet[0].reason).toBe("cold_chain_unavailable")

        const suggested = plan.data.plan.allocations[0]
        const transfer = await safe(
          api.post(
            "/vendor/aid-network/transfers",
            {
              from_node_id: suggested.from_node_id,
              to_node_id: suggested.to_node_id,
              item_key: suggested.item_key,
              item_label: "Carrots",
              requested_qty: suggested.quantity,
              source_stock_id: suggested.stock_id,
              reason: "rescue",
            },
            h
          )
        )
        expect(transfer.status).toBe(201)
        const transferId = transfer.data.node_transfer.id

        // A cold transfer to the warm hub is refused at request time (409).
        const coldToWarm = await safe(
          api.post(
            "/vendor/aid-network/transfers",
            {
              from_node_id: pantryId,
              to_node_id: storeId,
              item_key: "dairy.milk",
              item_label: "Milk",
              requested_qty: 1,
              requires_cold: true,
            },
            h
          )
        )
        expect(coldToWarm.status).toBe(409)

        // 25 requested, 23 arrive; the shortfall stays on the transfer.
        const received = await safe(
          api.post(
            `/vendor/aid-network/transfers/${transferId}/receive`,
            { received_qty: 23 },
            h
          )
        )
        expect(received.status).toBe(200)
        expect(Number(received.data.node_transfer.received_qty)).toBe(23)
        expect(received.data.node_transfer.status).toBe("received")

        const again = await safe(
          api.post(
            `/vendor/aid-network/transfers/${transferId}/receive`,
            { received_qty: 1 },
            h
          )
        )
        expect(again.status).toBe(409)
      })
    })
  },
})

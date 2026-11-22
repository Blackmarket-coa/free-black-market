import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BARGAINING_MODULE } from "../../src/modules/bargaining"
import { BUYER_NETWORK_MODULE } from "../../src/modules/buyer-network"
import { COLLECTIVE_CAMPAIGN_MODULE } from "../../src/modules/collective-campaign"
import { CREATOR_PROGRAM_MODULE } from "../../src/modules/creator-program"
import { CREATOR_REWARDS_MODULE } from "../../src/modules/creator-rewards"
import { DEMAND_POOL_MODULE } from "../../src/modules/demand-pool"
import { DONATION_MODULE } from "../../src/modules/donation"
import { KITCHEN_MODULE } from "../../src/modules/kitchen"
import { ORDER_CYCLE_MODULE } from "../../src/modules/order-cycle"
import { ORDER_SUBCONTRACT_MODULE } from "../../src/modules/order-subcontract"
import { SERVICE_PROGRAM_MODULE } from "../../src/modules/service-program"
import { VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE } from "../../src/modules/vendor-hype-operations-prediction"
import { addRawBigNumberColumnsSql, type RawCompanion } from "../../src/lib/raw-big-number-columns"
import { Migration20261117OrderCycleRawBigNumberColumns } from "../../src/modules/order-cycle/migrations/Migration20261117OrderCycleRawBigNumberColumns"
import type OrderCycleModuleService from "../../src/modules/order-cycle/service"
import type DemandPoolModuleService from "../../src/modules/demand-pool/service"

jest.setTimeout(240 * 1000)

/**
 * SD-63, on a database built from the migrations exactly as production's is:
 * every table whose `raw_*` companions the SD-63 migrations add takes an
 * insert through its module's service, and each bigNumber lands as Medusa
 * writes it — the NUMERIC value plus `{ value: "<number>", precision: 20 }`.
 *
 * Before those migrations each of these inserts failed with `column
 * "raw_<field>" of relation "<table>" does not exist`. The MVP paths go
 * through their domain methods (an order-cycle product added to a cycle, a
 * vendor's enterprise fee, a share box generated for a cycle, a demand post,
 * a participant, a bounty and a supplier proposal); the rest through the
 * module's generated CRUD, which every write path of theirs goes through.
 * One case per module, so dropping one module's migration fails its own case.
 *
 * Those tables are empty here, as they are on any database built from the
 * migrations (nothing could be inserted). What the migrations do to a table
 * that already has rows is pinned on a table of its own, through the same
 * SQL builder they use.
 *
 * `character_sheet` (progression) is not here: SD-50's branch adds its
 * columns with its own specs (module-schema-drift.spec.ts says why).
 */

type Crud = Record<string, (data: unknown) => Promise<Array<{ id: string }>>>

const raw = (value: string) => ({ value, precision: 20 })

const MODULES_DIR = path.resolve(__dirname, "../../src/modules")

const SD63_MIGRATIONS = [
  "Migration20261117BargainingRawBigNumberColumns",
  "Migration20261117BuyerNetworkRawBigNumberColumns",
  "Migration20261117CollectiveCampaignRawBigNumberColumns",
  "Migration20261117CreatorProgramRawBigNumberColumns",
  "Migration20261117CreatorRewardsRawBigNumberColumns",
  "Migration20261117DemandBountyMilestonesNullable",
  "Migration20261117DemandPoolRawBigNumberColumns",
  "Migration20261117DonationRawBigNumberColumns",
  "Migration20261117KitchenRawBigNumberColumns",
  "Migration20261117OrderCycleRawBigNumberColumns",
  "Migration20261117OrderSubcontractRawBigNumberColumns",
  "Migration20261117ServiceProgramRawBigNumberColumns",
  "Migration20261117VendorHypeRawBigNumberColumns",
]

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    const pg = () => getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const crud = (key: string) => getContainer().resolve(key) as Crud
    const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const one = async (key: string, method: string, data: Record<string, unknown>) => (await crud(key)[method]([data]))[0]

    /** Each field's NUMERIC value (as text) and `raw_` companion, as stored. */
    async function stored(table: string, id: string, fields: string[]) {
      const cols = fields.map((f) => `"${f}"::text AS "${f}", "raw_${f}" AS "raw_${f}"`).join(", ")
      const { rows } = await pg().raw(`SELECT ${cols} FROM "${table}" WHERE "id" = ?`, [id])
      expect(rows).toHaveLength(1)
      return Object.fromEntries(fields.map((f) => [f, { numeric: rows[0][f], raw: rows[0][`raw_${f}`] }]))
    }
    const n = (value: string) => ({ numeric: value, raw: raw(value) })
    const none = { numeric: null, raw: null }

    it("records every SD-63 migration as run, under a name no other module's migration uses", async () => {
      // mikro_orm_migrations is shared by every module and keyed by name, so
      // a second module's file of the same name would never run.
      const files = readdirSync(MODULES_DIR).flatMap((mod) => {
        const dir = path.join(MODULES_DIR, mod, "migrations")
        return existsSync(dir) ? readdirSync(dir).map((f) => f.replace(/\.[jt]s$/, "")) : []
      })
      expect(files.filter((name) => SD63_MIGRATIONS.includes(name)).sort()).toEqual(SD63_MIGRATIONS)

      const { rows } = await pg().raw(
        `SELECT name FROM mikro_orm_migrations WHERE name IN (${SD63_MIGRATIONS.map(() => "?").join(", ")}) ORDER BY name`,
        SD63_MIGRATIONS
      )
      expect(rows.map((r: { name: string }) => r.name)).toEqual(SD63_MIGRATIONS)
    })

    it("a table that already has rows: each companion is backfilled from its number as Medusa writes it, one already there is kept, and NOT NULL waits for the backfill", async () => {
      const columns = async (table: string) =>
        (
          await pg().raw(
            `SELECT column_name, is_nullable, column_default FROM information_schema.columns
              WHERE table_name = ? AND column_name LIKE 'raw_%' ORDER BY column_name`,
            [table]
          )
        ).rows
      const run = async (list: RawCompanion[]) => {
        for (const sql of addRawBigNumberColumnsSql(list)) await pg().raw(sql)
      }
      try {
        // Rows written before the companions existed, and one companion that
        // is already there (a schema built from the models) holding more
        // precision than a backfill from its number would write.
        await pg().raw(`
          CREATE TABLE "zz_sd63_rows" (
            "id" text PRIMARY KEY,
            "amount" numeric NOT NULL,
            "tip" numeric NOT NULL DEFAULT 0,
            "price" numeric NULL,
            "raw_tip" jsonb NULL
          )`)
        await pg().raw(`
          INSERT INTO "zz_sd63_rows" ("id", "amount", "tip", "price", "raw_tip") VALUES
            ('a', 12.50, 3, NULL, NULL),
            ('b', 0, 7.250, 4.10, '{"value":"7.2500000000000000001","precision":20}')`)
        const shape: RawCompanion[] = [
          ["zz_sd63_rows", "amount", "required"],
          ["zz_sd63_rows", "tip", { default: "0" }],
          ["zz_sd63_rows", "price", "nullable"],
        ]
        const expected = {
          rows: [
            { id: "a", raw_amount: raw("12.5"), raw_tip: raw("3"), raw_price: null },
            { id: "b", raw_amount: raw("0"), raw_tip: raw("7.2500000000000000001"), raw_price: raw("4.1") },
          ],
          columns: [
            { column_name: "raw_amount", is_nullable: "NO", column_default: null },
            { column_name: "raw_price", is_nullable: "YES", column_default: null },
            { column_name: "raw_tip", is_nullable: "NO", column_default: `'{"value": "0", "precision": 20}'::jsonb` },
          ],
        }
        // Twice: the second run meets a schema that already has every column.
        for (const pass of [1, 2]) {
          await run(shape)
          const { rows } = await pg().raw(`SELECT "id", "raw_amount", "raw_tip", "raw_price" FROM "zz_sd63_rows" ORDER BY "id"`)
          expect({ pass, rows, columns: await columns("zz_sd63_rows") }).toEqual({ pass, ...expected })
        }

        // A required field whose number is missing on some row: the column
        // stays nullable rather than failing the migration.
        await pg().raw(`CREATE TABLE "zz_sd63_gap" ("id" text PRIMARY KEY, "amount" numeric NULL)`)
        await pg().raw(`INSERT INTO "zz_sd63_gap" ("id", "amount") VALUES ('a', NULL), ('b', 5)`)
        await run([["zz_sd63_gap", "amount", "required"]])
        const gap = await pg().raw(`SELECT "id", "raw_amount" FROM "zz_sd63_gap" ORDER BY "id"`)
        expect(gap.rows).toEqual([
          { id: "a", raw_amount: null },
          { id: "b", raw_amount: raw("5") },
        ])
        expect(await columns("zz_sd63_gap")).toEqual([{ column_name: "raw_amount", is_nullable: "YES", column_default: null }])
      } finally {
        await pg().raw(`DROP TABLE IF EXISTS "zz_sd63_rows"`)
        await pg().raw(`DROP TABLE IF EXISTS "zz_sd63_gap"`)
      }
    })

    it("order-cycle: a product added to a cycle, an enterprise fee, a share-box template and the box generated for the cycle", async () => {
      const cycles = getContainer().resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
      const coordinator = `sel_coord_${uid()}`
      const now = Date.now()
      const [cycle] = await cycles.createOrderCycles([
        {
          name: `Week ${uid()}`,
          opens_at: new Date(now - 86_400_000),
          closes_at: new Date(now + 86_400_000),
          dispatch_at: new Date(now + 2 * 86_400_000),
          coordinator_seller_id: coordinator,
        },
      ])
      const variantId = `variant_${uid()}`

      // The vendor panel sends the override in cents (order-cycle-products-section.tsx).
      const product = await cycles.addProductToOrderCycle(cycle.id, variantId, coordinator, {
        override_price: 450,
        available_quantity: 10,
      })
      expect(await stored("order_cycle_product", product.id, ["override_price"])).toEqual({ override_price: n("450") })
      // The misnamed leftover was renamed, not left beside a new column.
      const companions = await pg().raw(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'order_cycle_product' AND column_name LIKE 'raw_%'`
      )
      expect(companions.rows).toEqual([{ column_name: "raw_override_price" }])

      const fee = await cycles.createFeeTemplate(coordinator, {
        name: "Packing",
        fee_type: "packing",
        calculator_type: "flat_rate",
        amount: 2.5,
      })
      expect(await stored("enterprise_fee", fee.id, ["amount"])).toEqual({ amount: n("2.5") })

      const template = await cycles.createShareBoxTemplate({
        coordinator_seller_id: coordinator,
        name: "Veg box",
        base_price: 2500,
        slots: [{ key: "greens", quantity: 1, candidate_variant_ids: [variantId] }],
      })
      expect(await stored("share_box_template", template.id, ["base_price"])).toEqual({ base_price: n("2500") })

      await cycles.createShareBoxSubscriptionRecord({ share_box_template_id: template.id, customer_id: `cus_${uid()}` })
      const generated = await cycles.generateBoxesForCycle(cycle.id)
      expect(generated).toMatchObject({ generated: 1, skipped: 0 })
      expect(await stored("share_box", generated.boxes[0].id, ["total_price"])).toEqual({ total_price: n("450") })
    })

    it("order-cycle, on a schema that has the companion under both names: a row with none under the new name takes the old one's", async () => {
      // The rows' cycle, which `order_cycle_product` holds a foreign key to.
      const now = Date.now()
      const [cycle] = await getContainer()
        .resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
        .createOrderCycles([
          {
            name: `Week ${uid()}`,
            opens_at: new Date(now - 86_400_000),
            closes_at: new Date(now + 86_400_000),
            dispatch_at: new Date(now + 2 * 86_400_000),
            coordinator_seller_id: `sel_coord_${uid()}`,
          },
        ])
      try {
        // The old name back beside the new one, as on a schema where somebody
        // added `raw_override_price` by hand without renaming the leftover.
        await pg().raw(`ALTER TABLE "order_cycle_product" ADD COLUMN "raw_price_override" jsonb NULL`)
        await pg().raw(
          `
          INSERT INTO "order_cycle_product"
            ("id", "order_cycle_id", "variant_id", "seller_id", "override_price", "raw_price_override", "raw_override_price") VALUES
            ('ocp_old_only', ?, 'v1', 'sel_1', 450, '{"value":"450.00","precision":20}', NULL),
            ('ocp_both', ?, 'v2', 'sel_1', 99.5, '{"value":"1","precision":20}', '{"value":"99.5","precision":20}'),
            ('ocp_no_number', ?, 'v3', 'sel_1', NULL, '{"value":"7","precision":20}', NULL),
            ('ocp_neither', ?, 'v4', 'sel_1', 12.50, NULL, NULL)`,
          [cycle.id, cycle.id, cycle.id, cycle.id]
        )

        const migration = new Migration20261117OrderCycleRawBigNumberColumns({} as never, {} as never)
        await migration.up()
        for (const sql of migration.getQueries()) await pg().raw(sql as string)

        const { rows } = await pg().raw(
          `SELECT "id", "raw_override_price", "raw_price_override" FROM "order_cycle_product" ORDER BY "id"`
        )
        expect(rows).toEqual([
          // Its own value kept; the old column's differing one ignored.
          { id: "ocp_both", raw_override_price: raw("99.5"), raw_price_override: raw("1") },
          // Neither name had one: backfilled from the number.
          { id: "ocp_neither", raw_override_price: raw("12.5"), raw_price_override: null },
          // No number to pair with: left empty.
          { id: "ocp_no_number", raw_override_price: null, raw_price_override: raw("7") },
          // Carried over from the old name. Its "450.00" is not what a
          // backfill from the number writes ("450"), so this row shows which
          // of the two it got.
          { id: "ocp_old_only", raw_override_price: raw("450.00"), raw_price_override: raw("450.00") },
        ])
      } finally {
        await pg().raw(`ALTER TABLE "order_cycle_product" DROP COLUMN IF EXISTS "raw_price_override"`)
      }
    })

    it("demand-pool: a post, a participant, a bounty with no milestones, a supplier proposal, and a milestone paid out", async () => {
      const pools = getContainer().resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)
      const post = await pools.createDemandPost({
        creator_id: `cus_${uid()}`,
        title: "Bulk oats",
        description: "Sacks between neighbours",
        target_quantity: 50,
        min_quantity: 10,
        target_price: 4.5,
      })
      await pools.publishDemandPost(post.id)

      const participant = await pools.joinDemandPool({
        demand_post_id: post.id,
        customer_id: `cus_${uid()}`,
        quantity_committed: 5,
        price_willing_to_pay: 4.25,
      })
      expect(await stored("demand_participant", participant.id, ["price_willing_to_pay", "escrow_amount"])).toEqual({
        price_willing_to_pay: n("4.25"),
        escrow_amount: n("0"),
      })

      // No milestones: the model writes NULL, which demand_bounty refused
      // while `milestones` was NOT NULL (SD-134 (5)). Every launch is one.
      const bounty = await pools.addBounty({
        demand_post_id: post.id,
        contributor_id: `cus_${uid()}`,
        objective: "FIND_SUPPLIER",
        amount: 25,
      })
      expect(await stored("demand_bounty", bounty.id, ["amount", "amount_paid_out"])).toEqual({
        amount: n("25"),
        amount_paid_out: n("0"),
      })
      const { rows: milestones } = await pg().raw(`SELECT milestones FROM demand_bounty WHERE id = ?`, [bounty.id])
      expect(milestones).toEqual([{ milestones: null }])

      const proposal = await pools.submitProposal({
        demand_post_id: post.id,
        supplier_id: `sel_${uid()}`,
        unit_price: 3.9,
        min_quantity: 10,
        delivery_cost: 15,
      })
      expect(await stored("supplier_proposal", proposal.id, ["unit_price", "delivery_cost"])).toEqual({
        unit_price: n("3.9"),
        delivery_cost: n("15"),
      })

      // The bounty's total reached the post through an ORM update, raw and all.
      expect(
        await stored("demand_post", post.id, ["target_price", "total_bounty_amount", "total_escrowed", "final_unit_price", "final_total_price"])
      ).toEqual({
        target_price: n("4.5"),
        total_bounty_amount: n("25"),
        total_escrowed: n("0"),
        final_unit_price: none,
        final_total_price: none,
      })

      // A milestone completed. Its atomic UPDATE is SQL, not the ORM, and it
      // writes the paid-out total and its companion together: before, the
      // companion kept the "0" it was inserted with beside a paid-out 10.
      const staged = await pools.addBounty({
        demand_post_id: post.id,
        contributor_id: `cus_${uid()}`,
        objective: "NEGOTIATE_PRICE",
        amount: 40,
        milestones: [
          { description: "Quote", percentage: 25, condition: "a signed quote" },
          { description: "Delivery", percentage: 75, condition: "delivered" },
        ],
      })
      const completed = await pools.completeBountyMilestone(staged.id, 0, post.id)
      expect(completed).toMatchObject({ payout_amount: 10, total_paid_out: 10, new_status: "MILESTONE_PARTIAL" })
      expect(await stored("demand_bounty", staged.id, ["amount", "amount_paid_out"])).toEqual({
        amount: n("40"),
        amount_paid_out: n("10"),
      })
    })

    it("bargaining: a group, a member and a proposal", async () => {
      const group = await one(BARGAINING_MODULE, "createBargainingGroups", {
        name: `Oat buyers ${uid()}`,
        organizer_id: `cus_${uid()}`,
        total_budget: 1500.5,
      })
      const member = await one(BARGAINING_MODULE, "createBargainingMembers", {
        group_id: group.id,
        customer_id: `cus_${uid()}`,
        joined_at: new Date(),
        budget: 200,
      })
      const proposal = await one(BARGAINING_MODULE, "createBargainingProposals", {
        group_id: group.id,
        proposer_id: `cus_${uid()}`,
        title: "Bulk oats",
        terms: { delivery: "weekly" },
        unit_price: 3.25,
      })
      expect(await stored("bargaining_group", group.id, ["total_budget"])).toEqual({ total_budget: n("1500.5") })
      expect(await stored("bargaining_member", member.id, ["budget"])).toEqual({ budget: n("200") })
      expect(await stored("bargaining_proposal", proposal.id, ["unit_price", "total_price"])).toEqual({
        unit_price: n("3.25"),
        total_price: none,
      })
    })

    it("buyer-network: a network and a member", async () => {
      const network = await one(BUYER_NETWORK_MODULE, "createBuyerNetworks", {
        name: "Southside buyers",
        handle: `southside-${uid()}`,
        admin_id: `cus_${uid()}`,
        min_purchase_commitment: 50,
      })
      const member = await one(BUYER_NETWORK_MODULE, "createNetworkMembers", {
        network_id: network.id,
        customer_id: `cus_${uid()}`,
        joined_at: new Date(),
        total_savings: 12.75,
      })
      expect(await stored("buyer_network", network.id, ["min_purchase_commitment", "total_savings"])).toEqual({
        min_purchase_commitment: n("50"),
        total_savings: n("0"),
      })
      expect(await stored("network_member", member.id, ["total_savings"])).toEqual({ total_savings: n("12.75") })
    })

    it("collective-campaign: a campaign, a backing, a material line, an asset token, a purchase order, a reputation and a yield report", async () => {
      const K = COLLECTIVE_CAMPAIGN_MODULE
      const campaign = await one(K, "createCampaigns", {
        vendor_id: `sel_${uid()}`,
        name: "Press run",
        description: "Two hundred tees",
        campaign_type: "PRODUCTION_RUN",
        maker_fee: 120,
        funding_goal_override: 5000,
      })
      const backing = await one(K, "createBackings", { campaign_id: campaign.id, backer_id: `cus_${uid()}`, mode: "PRE_ORDER", amount: 25 })
      const line = await one(K, "createMaterialLineItems", {
        campaign_id: campaign.id,
        item_name: "Blank tee",
        supplier_url: "https://supplier.example/tee",
        unit_cost_at_listing: 4.2,
        quantity_per_full_campaign: 200,
      })
      const token = await one(K, "createProductiveAssetTokens", {
        campaign_id: campaign.id,
        token_contract_address: "0x0000000000000000000000000000000000000001",
        chain_id: 1,
        total_supply: 1000000,
      })
      const order = await one(K, "createPurchaseOrders", { campaign_id: campaign.id, supplier_url: "https://supplier.example/po", budget_amount: 840 })
      const reputation = await one(K, "createVendorReputations", { vendor_id: `sel_${uid()}`, campaign_cap: 2500 })
      const report = await one(K, "createYieldReports", {
        campaign_id: campaign.id,
        cycle_label: "2026-Q4",
        measured_output: 87.5,
        reported_at: new Date(),
      })

      expect(
        await stored("collective_campaign", campaign.id, ["maker_fee", "funding_goal_override", "return_cap_multiplier", "yield_per_cycle", "total_backed_amount"])
      ).toEqual({
        maker_fee: n("120"),
        funding_goal_override: n("5000"),
        return_cap_multiplier: n("2"),
        yield_per_cycle: none,
        total_backed_amount: n("0"),
      })
      expect(await stored("collective_backing", backing.id, ["amount", "payout_cap_amount", "payout_released_amount"])).toEqual({
        amount: n("25"),
        payout_cap_amount: none,
        payout_released_amount: n("0"),
      })
      expect(
        await stored("collective_material_line_item", line.id, ["unit_cost_at_listing", "quantity_per_full_campaign", "quantity_per_output_unit", "line_total_estimate"])
      ).toEqual({
        unit_cost_at_listing: n("4.2"),
        quantity_per_full_campaign: n("200"),
        quantity_per_output_unit: n("1"),
        line_total_estimate: n("0"),
      })
      expect(await stored("collective_productive_asset_token", token.id, ["total_supply"])).toEqual({ total_supply: n("1000000") })
      expect(await stored("collective_purchase_order", order.id, ["budget_amount", "actual_amount"])).toEqual({
        budget_amount: n("840"),
        actual_amount: none,
      })
      expect(await stored("collective_vendor_reputation", reputation.id, ["campaign_cap"])).toEqual({ campaign_cap: n("2500") })
      expect(await stored("collective_yield_report", report.id, ["measured_output", "payout_pool_amount", "projected_next_cycle_output"])).toEqual({
        measured_output: n("87.5"),
        payout_pool_amount: n("0"),
        projected_next_cycle_output: none,
      })
    })

    it("creator-program: a creator deal", async () => {
      const deal = await one(CREATOR_PROGRAM_MODULE, "createCreatorDeals", {
        program_id: `cprog_${uid()}`,
        application_id: `capp_${uid()}`,
        creator_seller_id: `sel_${uid()}`,
        vendor_id: `sel_${uid()}`,
        effective_from: new Date(),
        terms_snapshot: { commission_percent: 10 },
        total_attributed_cents: 2500,
      })
      expect(await stored("creator_deal", deal.id, ["total_attributed_cents", "total_paid_out_cents"])).toEqual({
        total_attributed_cents: n("2500"),
        total_paid_out_cents: n("0"),
      })
    })

    it("creator-rewards: an engagement snapshot, a reward pool and a payout from it", async () => {
      const snapshot = await one(CREATOR_REWARDS_MODULE, "createEngagementSnapshots", {
        content_post_id: `cpost_${uid()}`,
        captured_at: new Date(),
        views: 1200,
        qualified_views: 900,
      })
      const pool = await one(CREATOR_REWARDS_MODULE, "createRewardPools", {
        period_start: new Date(Date.now() - 7 * 86_400_000),
        period_end: new Date(),
        total_cents: 50000,
      })
      const payout = await one(CREATOR_REWARDS_MODULE, "createRewardPayouts", {
        pool_id: pool.id,
        creator_seller_id: `sel_${uid()}`,
        amount_cents: 1250,
        qualified_views: 900,
      })
      expect(await stored("engagement_snapshot", snapshot.id, ["views", "qualified_views", "likes", "watch_time_seconds"])).toEqual({
        views: n("1200"),
        qualified_views: n("900"),
        likes: n("0"),
        watch_time_seconds: n("0"),
      })
      expect(await stored("reward_pool", pool.id, ["total_cents"])).toEqual({ total_cents: n("50000") })
      expect(await stored("reward_payout", payout.id, ["amount_cents", "qualified_views"])).toEqual({
        amount_cents: n("1250"),
        qualified_views: n("900"),
      })
    })

    it("donation: a disbursement", async () => {
      const disbursement = await one(DONATION_MODULE, "createDonationDisbursements", {
        beneficiary_id: `dben_${uid()}`,
        amount: 310.4,
        period_start: new Date(Date.now() - 30 * 86_400_000),
        period_end: new Date(),
      })
      expect(await stored("donation_disbursement", disbursement.id, ["amount"])).toEqual({ amount: n("310.4") })
    })

    it("kitchen: a kitchen, a space, a piece of equipment and a membership", async () => {
      const kitchen = await one(KITCHEN_MODULE, "createKitchens", {
        name: "Commons kitchen",
        slug: `commons-${uid()}`,
        address: "1 Market St",
        city: "Chicago",
        state: "IL",
        zip: "60617",
        kitchen_type: "community",
        hourly_rate: 22.5,
      })
      const space = await one(KITCHEN_MODULE, "createKitchenSpaces", { kitchen_id: kitchen.id, name: "Bakery bench", space_type: "general", daily_rate: 120 })
      const equipment = await one(KITCHEN_MODULE, "createKitchenEquipments", {
        kitchen_id: kitchen.id,
        name: "Deck oven",
        category: "cooking",
        purchase_price: 899.99,
      })
      const membership = await one(KITCHEN_MODULE, "createKitchenMemberships", {
        kitchen_id: kitchen.id,
        customer_id: `cus_${uid()}`,
        membership_type: "hourly",
        joined_at: new Date(),
        prepaid_hours_balance: 10,
      })
      expect(await stored("kitchen", kitchen.id, ["hourly_rate", "monthly_membership_fee", "deposit_required"])).toEqual({
        hourly_rate: n("22.5"),
        monthly_membership_fee: none,
        deposit_required: none,
      })
      expect(await stored("kitchen_space", space.id, ["daily_rate", "hourly_rate"])).toEqual({ daily_rate: n("120"), hourly_rate: none })
      expect(await stored("kitchen_equipment", equipment.id, ["purchase_price", "current_value"])).toEqual({
        purchase_price: n("899.99"),
        current_value: none,
      })
      expect(await stored("kitchen_membership", membership.id, ["prepaid_hours_balance", "voting_power", "deposit_balance"])).toEqual({
        prepaid_hours_balance: n("10"),
        voting_power: n("1"),
        deposit_balance: n("0"),
      })
    })

    it("order-subcontract: a subcontract", async () => {
      const subcontract = await one(ORDER_SUBCONTRACT_MODULE, "createOrderSubcontracts", {
        parent_order_id: `order_${uid()}`,
        parent_seller_id: `sel_${uid()}`,
        subcontract_seller_id: `sel_${uid()}`,
        contract_id: `scon_${uid()}`,
        order_item_ids: [`ordli_${uid()}`],
        unit_count: 3,
        unit_price_cents: 400,
        total_cents: 1200,
      })
      expect(await stored("order_subcontract", subcontract.id, ["total_cents"])).toEqual({ total_cents: n("1200") })
    })

    it("service-program: a service contract", async () => {
      const contract = await one(SERVICE_PROGRAM_MODULE, "createServiceContracts", {
        program_id: `sprog_${uid()}`,
        application_id: `sapp_${uid()}`,
        service_seller_id: `sel_${uid()}`,
        vendor_id: `sel_${uid()}`,
        effective_from: new Date(),
        terms_snapshot: { pricing_model: "flat" },
        total_paid_cents: 5000,
      })
      expect(await stored("service_contract", contract.id, ["total_paid_cents"])).toEqual({ total_paid_cents: n("5000") })
    })

    it("vendor-hype-operations-prediction: a hype profile, a position and a payout entry", async () => {
      const K = VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
      const profile = await one(K, "createHypeProfiles", {
        profile_type: "vendor",
        owner_id: `cus_${uid()}`,
        slug: `hype-${uid()}`,
        display_name: "Owner Co",
        mission: "Make boxes",
        capital_need_amount: 15000,
      })
      const position = await one(K, "createPredictionPositions", {
        market_id: `pmkt_${uid()}`,
        supporter_id: `cus_${uid()}`,
        outcome_option_key: "yes",
        stake_amount: 10,
        idempotency_key: uid(),
      })
      const entry = await one(K, "createPredictionPayoutEntries", {
        settlement_id: `pset_${uid()}`,
        market_id: `pmkt_${uid()}`,
        position_id: position.id,
        supporter_id: `cus_${uid()}`,
        payout_amount: 20,
      })
      expect(await stored("hype_profile", profile.id, ["capital_need_amount"])).toEqual({ capital_need_amount: n("15000") })
      expect(await stored("prediction_position", position.id, ["stake_amount", "max_payout_amount"])).toEqual({
        stake_amount: n("10"),
        max_payout_amount: none,
      })
      expect(await stored("prediction_payout_entry", entry.id, ["payout_amount"])).toEqual({ payout_amount: n("20") })
    })
  },
})

import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import creatorRewardsPoolCloseJob from "../../src/jobs/creator-rewards-pool-close"
import { CREATOR_PROGRAM_MODULE } from "../../src/modules/creator-program"
import { CreatorProgramType } from "../../src/modules/creator-program/models/creator-program"
import type CreatorProgramService from "../../src/modules/creator-program/service"
import { CREATOR_REWARDS_MODULE } from "../../src/modules/creator-rewards"
import type CreatorRewardsService from "../../src/modules/creator-rewards/service"
import { HAWALA_LEDGER_MODULE } from "../../src/modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../src/modules/hawala-ledger/service"
import {
  CREATOR_REWARD_POOLS_FLAG,
  SUBCONTRACT_ESCROW_FLAG,
} from "../../src/modules/hawala-ledger/vendor-transfer-switches"
import { ORDER_SUBCONTRACT_MODULE } from "../../src/modules/order-subcontract"
import type OrderSubcontractService from "../../src/modules/order-subcontract/service"
import { SERVICE_PROGRAM_MODULE } from "../../src/modules/service-program"
import {
  ServiceCategory,
  ServicePricingModel,
  ServiceProgramType,
} from "../../src/modules/service-program/models/service-program"
import type ServiceProgramService from "../../src/modules/service-program/service"
import { authHeader, createAuthenticatedSeller, safe } from "./helpers/seller-auth"

jest.setTimeout(240 * 1000)

/**
 * Two vendor-to-vendor money paths stay off until an operator and counsel
 * decide (modules/hawala-ledger/vendor-transfer-switches.ts), on a database
 * built from the migrations.
 *
 * Neither could run there before SD-63: `service_contract`,
 * `order_subcontract`, `reward_pool` and `reward_payout` took no insert. With
 * the `raw_*` columns migrated both work, behind seller authentication alone,
 * with no order behind the money. The sequences below are the ones the
 * review of SD-63 ran to show that:
 *
 * - a service program, an approved application, its contract, a subcontract
 *   against an order id that does not exist, escrow opened from the
 *   buyer-vendor's earnings and released to the provider's;
 * - a reward pool funded from a vendor's earnings and credited to another
 *   seller's creator earnings.
 *
 * Off (no variable set, as in production): the ledger methods refuse, no
 * balance moves, no account is made, and the routes and the daily job stop
 * before writing a subcontract, a pool or a payout. On: the same sequence
 * moves the money, so each switch is what stands in the way.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const pg = () => getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const hawala = () => getContainer().resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    const subcontracts = () => getContainer().resolve<OrderSubcontractService>(ORDER_SUBCONTRACT_MODULE)
    const rewards = () => getContainer().resolve<CreatorRewardsService>(CREATOR_REWARDS_MODULE)
    const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const DAY = 86_400_000

    afterEach(() => {
      delete process.env[SUBCONTRACT_ESCROW_FLAG]
      delete process.env[CREATOR_REWARD_POOLS_FLAG]
    })

    /** A vendor with $200.00 of earnings, and a second vendor with none. */
    async function twoVendors() {
      const buyer = await createAuthenticatedSeller({ api, getContainer })
      const provider = await createAuthenticatedSeller({ api, getContainer })
      const earnings = await hawala().getOrCreateSellerEarnings(buyer.seller.id, "USD")
      // A fixture: the starting balance, written as vendor-store-keying.spec.ts writes one.
      await pg().raw(`UPDATE hawala_ledger_account SET balance = 200, available_balance = 200 WHERE id = ?`, [earnings.id])
      return { buyer, provider }
    }

    /** Every ledger account's balance, as `owner|type` -> dollars. */
    async function balances() {
      const { rows } = await pg().raw(
        `SELECT owner_id, account_type, available_balance::text AS available FROM hawala_ledger_account ORDER BY owner_id, account_type`
      )
      return Object.fromEntries(
        rows.map((r: { owner_id: string; account_type: string; available: string }) => [
          `${r.owner_id}|${r.account_type}`,
          Number(r.available),
        ])
      )
    }

    async function moves() {
      const { rows } = await pg().raw(
        `SELECT entry_type, reference_type, order_id, amount::text AS amount FROM hawala_ledger_entry ORDER BY created_at, id`
      )
      return rows.map((r: { entry_type: string; reference_type: string; order_id: string | null; amount: string }) => ({
        entry_type: r.entry_type,
        reference_type: r.reference_type,
        order_id: r.order_id,
        amount: Number(r.amount),
      }))
    }

    const count = async (table: string) => Number((await pg().raw(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n)

    async function asAdmin() {
      const [user] = await getContainer()
        .resolve(Modules.USER)
        .createUsers([{ email: `admin+${uid()}@example.com` }])
      const token = jwt.sign(
        { actor_id: user.id, actor_type: "user", auth_identity_id: "", app_metadata: { user_id: user.id } },
        process.env.JWT_SECRET as string,
        { expiresIn: "1h" }
      )
      return authHeader(token)
    }

    /** The buyer-vendor's program, the provider's approved application, and its contract. */
    async function contractBetween(buyerId: string, providerId: string) {
      const programs = getContainer().resolve<ServiceProgramService>(SERVICE_PROGRAM_MODULE)
      const program = await programs.createProgram({
        vendorId: buyerId,
        title: "Packing",
        slug: `packing-${uid()}`,
        serviceCategory: ServiceCategory.PACKAGING,
        programType: ServiceProgramType.FIXED_CONTRACT,
        pricingModel: ServicePricingModel.PER_UNIT,
        unitPriceCents: 500,
      })
      await programs.publishProgram(program.id)
      const application = await programs.applyToProgram({ programId: program.id, serviceSellerId: providerId })
      await programs.decideApplication({ applicationId: application.id, decision: "approve", decidedBy: buyerId })
      const contract = await programs.openContractForApprovedApp(application.id)
      return { program, contract } as { program: { id: string }; contract: { id: string } }
    }

    // Ten units at $5.00 against an order nobody checks exists: $50.00.
    const proposal = (contractId: string) => ({
      parent_order_id: "order_that_does_not_exist",
      contract_id: contractId,
      order_item_ids: ["ordli_none"],
      unit_count: 10,
      unit_price_cents: 500,
    })

    describe("subcontract escrow", () => {
      it("is off by default: the ledger refuses to open, release or refund it, nothing moves, and the routes answer before a subcontract is written", async () => {
        const { buyer, provider } = await twoVendors()
        const { program, contract } = await contractBetween(buyer.seller.id, provider.seller.id)
        const before = await balances()
        expect(before).toEqual({ [`${buyer.seller.id}|SELLER_EARNINGS`]: 200 })

        // The routes: refused before a row is written.
        const proposed = await safe(api.post("/v1/seller/services/subcontracts", proposal(contract.id), authHeader(buyer.token)))
        expect([proposed.status, proposed.data]).toEqual([404, { message: "Service subcontracts are not available", type: "feature_disabled" }])
        expect(await count("order_subcontract")).toBe(0)

        // The ledger itself, reached as a caller that skips the routes would
        // reach it: a subcontract row written through the module's service.
        const sub = await subcontracts().proposeSubcontract({
          parentOrderId: "order_that_does_not_exist",
          parentSellerId: buyer.seller.id,
          subcontractSellerId: provider.seller.id,
          contractId: contract.id,
          programId: program.id,
          orderItemIds: ["ordli_none"],
          unitCount: 10,
          unitPriceCents: 500,
        })
        const off = /Service subcontracts are not available \(FBM_SUBCONTRACT_ESCROW_LIVE is not on\)/
        await expect(
          hawala().openSubcontractEscrow({ subcontractId: sub.id, parentSellerId: buyer.seller.id, amountCents: 5000 })
        ).rejects.toThrow(off)
        await expect(
          hawala().releaseSubcontractEscrow({ subcontractId: sub.id, serviceSellerId: provider.seller.id, amountCents: 5000 })
        ).rejects.toThrow(off)
        await expect(
          hawala().refundSubcontractEscrow({ subcontractId: sub.id, parentSellerId: buyer.seller.id, amountCents: 5000, reason: "spec" })
        ).rejects.toThrow(off)

        const accepted = await safe(
          api.post(`/v1/seller/services/subcontracts/${sub.id}/accept-delivery`, {}, authHeader(buyer.token))
        )
        expect([accepted.status, accepted.data.type]).toEqual([404, "feature_disabled"])
        const resolved = await safe(
          api.post(`/v1/admin/marketplace/subcontracts/${sub.id}/resolve`, { decision: "release", reason: "spec" }, await asAdmin())
        )
        expect([resolved.status, resolved.data.type]).toEqual([404, "feature_disabled"])

        // No balance moved, no escrow or provider account was made, no entry written.
        expect(await balances()).toEqual(before)
        expect(await moves()).toEqual([])
      })

      it("with FBM_SUBCONTRACT_ESCROW_LIVE=1 the same subcontract moves $50.00 of the buyer-vendor's earnings to the provider, so the switch is what stops it", async () => {
        const { buyer, provider } = await twoVendors()
        const { contract } = await contractBetween(buyer.seller.id, provider.seller.id)
        process.env[SUBCONTRACT_ESCROW_FLAG] = "1"

        const proposed = await safe(api.post("/v1/seller/services/subcontracts", proposal(contract.id), authHeader(buyer.token)))
        expect({ status: proposed.status, body: proposed.status === 201 ? null : proposed.data }).toEqual({ status: 201, body: null })
        const subId: string = proposed.data.subcontract.id
        expect(await balances()).toEqual({
          [`${buyer.seller.id}|SELLER_EARNINGS`]: 150,
          [`${subId}|ESCROW`]: 50,
        })

        await subcontracts().markDelivered({ subcontractId: subId, actorSellerId: provider.seller.id })
        const accepted = await safe(api.post(`/v1/seller/services/subcontracts/${subId}/accept-delivery`, {}, authHeader(buyer.token)))
        expect({ status: accepted.status, body: accepted.status === 200 ? null : accepted.data }).toEqual({ status: 200, body: null })

        expect(await balances()).toEqual({
          [`${buyer.seller.id}|SELLER_EARNINGS`]: 150,
          [`${provider.seller.id}|SELLER_EARNINGS`]: 50,
          [`${subId}|ESCROW`]: 0,
        })
        // Vendor to vendor, with no order behind either leg.
        expect(await moves()).toEqual([
          { entry_type: "TRANSFER", reference_type: "MANUAL", order_id: null, amount: 50 },
          { entry_type: "TRANSFER", reference_type: "MANUAL", order_id: null, amount: 50 },
        ])
      })
    })

    describe("creator reward pools", () => {
      async function programOf(vendorId: string) {
        const program = await getContainer()
          .resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
          .createProgram({
            vendorId,
            title: "Views",
            slug: `views-${uid()}`,
            programType: CreatorProgramType.ENGAGEMENT_POOL,
          })
        return program as { id: string }
      }

      /** A pool whose period ended yesterday: the daily job's work. */
      const duePool = (programId: string, funderSellerId: string) =>
        rewards().openPool({
          programId,
          funderSellerId,
          periodStart: new Date(Date.now() - 3 * DAY),
          periodEnd: new Date(Date.now() - DAY),
          totalCents: 10000,
        }) as Promise<{ id: string; status: string }>

      const poolStatus = async (id: string) =>
        (await pg().raw(`SELECT status::text AS status FROM reward_pool WHERE id = ?`, [id])).rows[0].status

      it("are off by default: the ledger refuses to fund or pay out of one, nothing moves, the routes answer before a pool is written, and the daily job leaves a due pool alone", async () => {
        const { buyer, provider } = await twoVendors()
        const program = await programOf(buyer.seller.id)
        const before = await balances()

        const opened = await safe(
          api.post(
            `/v1/seller/programs/${program.id}/reward-pools`,
            { total_cents: 10000, period_end: new Date(Date.now() + 7 * DAY).toISOString() },
            authHeader(buyer.token)
          )
        )
        expect([opened.status, opened.data]).toEqual([404, { message: "Creator reward pools are not available", type: "feature_disabled" }])
        expect(await count("reward_pool")).toBe(0)

        const off = /Creator reward pools are not available \(FBM_CREATOR_REWARD_POOLS_LIVE is not on\)/
        await expect(
          hawala().fundCreatorRewardPool({ poolId: `rpool_${uid()}`, funderSellerId: buyer.seller.id, amountCents: 10000 })
        ).rejects.toThrow(off)
        await expect(
          hawala().creditCreatorReward({
            poolId: `rpool_${uid()}`,
            creatorSellerId: provider.seller.id,
            amountCents: 4000,
            rewardPayoutId: `rpay_${uid()}`,
          })
        ).rejects.toThrow(off)

        // A due pool, written through the module's service as a caller that
        // skips the route would write it: the job and the admin route leave it.
        const pool = await duePool(program.id, buyer.seller.id)
        expect(pool.status).toBe("accruing")
        await creatorRewardsPoolCloseJob(getContainer())
        const distributed = await safe(api.post(`/v1/admin/marketplace/reward-pools/${pool.id}/distribute`, {}, await asAdmin()))
        expect([distributed.status, distributed.data.type]).toEqual([404, "feature_disabled"])
        expect(await poolStatus(pool.id)).toBe("accruing")
        expect(await count("reward_payout")).toBe(0)

        expect(await balances()).toEqual(before)
        expect(await moves()).toEqual([])
      })

      it("with FBM_CREATOR_REWARD_POOLS_LIVE=1 a pool takes $100.00 of the vendor's earnings and pays $40.00 of it to another seller, and the job closes a due pool", async () => {
        const { buyer, provider } = await twoVendors()
        const program = await programOf(buyer.seller.id)
        process.env[CREATOR_REWARD_POOLS_FLAG] = "1"

        const opened = await safe(
          api.post(
            `/v1/seller/programs/${program.id}/reward-pools`,
            { total_cents: 10000, period_end: new Date(Date.now() + 7 * DAY).toISOString() },
            authHeader(buyer.token)
          )
        )
        expect({ status: opened.status, body: opened.status === 201 ? null : opened.data }).toEqual({ status: 201, body: null })
        const poolId: string = opened.data.pool.id
        expect(await balances()).toEqual({
          [`${buyer.seller.id}|SELLER_EARNINGS`]: 100,
          [`${poolId}|CREATOR_REWARD_POOL`]: 100,
        })

        await hawala().creditCreatorReward({
          poolId,
          creatorSellerId: provider.seller.id,
          amountCents: 4000,
          rewardPayoutId: `rpay_${uid()}`,
        })
        expect(await balances()).toEqual({
          [`${buyer.seller.id}|SELLER_EARNINGS`]: 100,
          [`${poolId}|CREATOR_REWARD_POOL`]: 60,
          [`${provider.seller.id}|CREATOR_EARNINGS`]: 40,
        })
        expect(await moves()).toEqual([
          { entry_type: "TRANSFER", reference_type: "CREATOR_REWARD_POOL", order_id: null, amount: 100 },
          { entry_type: "CREATOR_REWARD", reference_type: "CREATOR_REWARD_POOL", order_id: null, amount: 40 },
        ])

        // The job is live too: a due pool is closed (here with no creator to pay).
        const due = await duePool(program.id, buyer.seller.id)
        await creatorRewardsPoolCloseJob(getContainer())
        expect(await poolStatus(due.id)).toBe("distributed")
      })
    })
  },
})

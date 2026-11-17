import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { refundPaymentWorkflow } from "@medusajs/medusa/core-flows"
import { PAYOUT_MODULE } from "@mercurjs/b2c-core/modules/payout"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { refundSplitOrderPaymentWorkflow } from "@mercurjs/b2c-core/workflows"
import jwt from "jsonwebtoken"
import { CREATOR_ATTRIBUTION_MODULE } from "../../src/modules/creator-attribution"
import { CommissionStatus } from "../../src/modules/creator-attribution/models/order-attribution"
import { HAWALA_LEDGER_MODULE } from "../../src/modules/hawala-ledger"
import { PAYOUT_BREAKDOWN_MODULE } from "../../src/modules/payout-breakdown"
import { PHASE0_FEATURE_FLAGS } from "../../src/shared/feature-flags"
import { AMOUNT_UNIT_METADATA_KEY, AMOUNT_UNIT_MINOR } from "../../src/shared/minor-units"
import hawalaOrderPaymentSubscriber from "../../src/subscribers/hawala-order-payment"
import processRefundReversesCommission from "../../src/subscribers/process-refund-reverses-commission"
import approveHeldCreatorAttributionsJob from "../../src/jobs/creator-attribution-approve-held"
import { fixCreatorCommissionMinorUnits } from "../../src/scripts/fix-creator-commission-minor-units"
import { reconcileCardOrder } from "../../src/lib/card-order-reconcile"
import { attributeCollectionRefund } from "../../src/lib/card-refund-attribution"
import { readCardSettlementOrder } from "../../src/lib/card-order-settlement"
import { cardOrderFixtures } from "./helpers/card-orders"
import { trackSubscribers } from "./helpers/drain-subscribers"
import { clearStalledWorkflows } from "./helpers/stalled-workflows"
import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"

jest.setTimeout(240 * 1000)

const CARD = PHASE0_FEATURE_FLAGS.CARD_ORDER_LEDGER_V1

/**
 * SD-95 on a real migrated database: creator commission in minor units, from
 * the order placed to the money that moves on it.
 *
 * The order is placed the live way: an affiliate click, the storefront's
 * `POST /store/carts/:id/attribution`, then `POST /store/carts/:id/complete`
 * (Mercur's `split-and-complete-cart`, which emits `order.placed`), with the
 * booted app's own subscribers. Fixtures as in order-confirmation-email.spec.ts
 * (Mercur's order_set display_id trigger, Stripe replaced on the registered
 * provider instance). Settlement, the approve-held job and the refund
 * reversal are the real subscriber, job and ledger.
 *
 * Before the fix the subscriber passed Medusa's major-unit subtotal (25 for
 * $25.00) as `subtotalCents`: on this database the row stored subtotal 25
 * and commission 2, and the stored breakdown gave the creator 2 and the
 * vendor a net of 2423 (2500 less the 75 platform fee and those 2), where
 * 250 and 2175 are right. The ledger credit and its reversal read the same
 * column, so they would have moved $0.02 (but see the cross-rail note below:
 * the credit is refused outright).
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const container = () => getContainer() as any
    const cents = (v: unknown) => Math.round(Number(v) * 100)
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`
    const attribution = () => container().resolve(CREATOR_ATTRIBUTION_MODULE)
    const hawala = () => container().resolve(HAWALA_LEDGER_MODULE)

    let drainSubscribers: () => Promise<void> = async () => {}

    beforeAll(async () => {
      await container().resolve(ContainerRegistrationKeys.PG_CONNECTION).raw(`
        CREATE OR REPLACE FUNCTION fbm_test_order_set_display_id() RETURNS trigger AS $$
        BEGIN
          IF NEW.display_id IS NULL THEN
            NEW.display_id := nextval(pg_get_serial_sequence('order_set', 'display_id'));
          END IF;
          RETURN NEW;
        END
        $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS fbm_test_order_set_display_id ON order_set;
        CREATE TRIGGER fbm_test_order_set_display_id BEFORE INSERT ON order_set
          FOR EACH ROW EXECUTE FUNCTION fbm_test_order_set_display_id();
      `)
    })

    beforeEach(() => {
      delete process.env[CARD]
      delete process.env.CREATOR_ATTRIBUTION_DEFAULT_COMMISSION_PERCENT // the default: 10%
      drainSubscribers = trackSubscribers(container)
      const provider = container().resolve(Modules.PAYMENT).paymentProviderService_.retrieveProvider("pp_stripe_stripe")
      jest.spyOn(provider, "initiatePayment").mockImplementation(async () => {
        const id = `pi_test_${uid()}`
        return { id, data: { id, status: "requires_payment_method" } }
      })
      jest.spyOn(provider, "authorizePayment").mockImplementation(async (input: any) => ({
        status: "authorized",
        data: { ...(input?.data ?? {}), status: "requires_capture" },
      }))
      jest.spyOn(provider, "capturePayment").mockImplementation(async (input: any) => ({
        data: { ...(input?.data ?? {}), status: "succeeded" },
      }))
      jest.spyOn(provider, "cancelPayment").mockImplementation(async (input: any) => ({
        data: { ...(input?.data ?? {}), status: "canceled" },
      }))
      jest.spyOn(provider, "refundPayment").mockImplementation(async (input: any) => ({
        data: { ...(input?.data ?? {}), status: "succeeded" },
      }))
    })

    async function sellerWithProduct(channelId: string) {
      const id = uid()
      const link = container().resolve(ContainerRegistrationKeys.LINK)
      const created = await container().resolve(SELLER_MODULE).createSellers({ name: `Grower ${id}`, handle: `grower-${id}` })
      const seller = Array.isArray(created) ? created[0] : created
      const [product] = await container().resolve(Modules.PRODUCT).createProducts([
        {
          title: `Tomatoes ${id}`,
          handle: `tomatoes-${id}`,
          status: "published",
          options: [{ title: "Size", values: ["Crate"] }],
          variants: [{ title: "Crate", manage_inventory: false, options: { Size: "Crate" } }],
        },
      ])
      await link.create({ [SELLER_MODULE]: { seller_id: seller.id }, [Modules.PRODUCT]: { product_id: product.id } })
      await link.create({ [Modules.PRODUCT]: { product_id: product.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: channelId } })

      const fulfillment = container().resolve(Modules.FULFILLMENT)
      const [location] = await container().resolve(Modules.STOCK_LOCATION).createStockLocations([{ name: `Farm ${id}` }])
      const set = await fulfillment.createFulfillmentSets({
        name: `Pickup ${id}`,
        type: "shipping",
        service_zones: [{ name: `US ${id}`, geo_zones: [{ type: "country", country_code: "us" }] }],
      })
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
        [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
      })
      const profile = await fulfillment.createShippingProfiles({ name: `Default ${id}`, type: "default" })
      const option = await fulfillment.createShippingOptions({
        name: `Pickup ${id}`,
        service_zone_id: set.service_zones[0].id,
        shipping_profile_id: profile.id,
        provider_id: "manual_manual",
        price_type: "flat",
        type: { label: "Pickup", description: "Farm pickup", code: `pickup-${id}` },
        rules: [],
      } as any)
      await link.create({ [SELLER_MODULE]: { seller_id: seller.id }, [Modules.FULFILLMENT]: { shipping_option_id: option.id } })
      return { seller, product, option: option as { id: string; name: string } }
    }

    async function makeSeller(label: string) {
      const id = uid()
      const created = await container().resolve(SELLER_MODULE).createSellers({ name: `${label} ${id}`, handle: `${label.toLowerCase()}-${id}` })
      return Array.isArray(created) ? created[0] : created
    }

    /**
     * A buyer who clicked a creator's link for the vendor, then bought one
     * $25.00 crate through the storefront checkout. Returns the placed order.
     */
    async function placeAttributedOrder() {
      const pak = pakHeaders(await createPublishableKeyToken(getContainer))
      const id = uid()
      const [channel] = await container().resolve(Modules.SALES_CHANNEL).createSalesChannels([{ name: `Storefront ${id}` }])
      const vendor = await sellerWithProduct(channel.id)
      const creator = await makeSeller("Creator")

      const link = await attribution().generateLink({ creatorSellerId: creator.id, vendorId: vendor.seller.id })
      const visitorToken = `vis_${id}`
      await attribution().recordClick({ shortCode: link.short_code, visitorToken })

      const [customer] = await container().resolve(Modules.CUSTOMER).createCustomers([{ email: `buyer-${id}@example.com` }])
      const [region] = await container().resolve(Modules.REGION).createRegions([{ name: `US ${id}`, currency_code: "usd" }])
      const carts = container().resolve(Modules.CART)
      const [cart] = await carts.createCarts([
        {
          currency_code: "usd",
          region_id: region.id,
          sales_channel_id: channel.id,
          customer_id: customer.id,
          email: customer.email,
          items: [
            {
              title: vendor.product.title,
              product_id: vendor.product.id,
              variant_id: vendor.product.variants[0].id,
              quantity: 1,
              unit_price: 25,
              requires_shipping: true,
            },
          ],
        },
      ])
      await carts.addShippingMethods([
        { cart_id: cart.id, name: vendor.option.name, amount: 0, shipping_option_id: vendor.option.id },
      ])

      // The storefront's own call, with its `_fbm_aff` cookie and visitor token.
      const stamped = await api
        .post(`/store/carts/${cart.id}/attribution`, { ref_code: link.short_code, visitor_token: visitorToken }, pak)
        .catch((e: any) => e.response)
      expect(stamped.status).toBe(200)

      const payments = container().resolve(Modules.PAYMENT)
      const [collection] = await payments.createPaymentCollections([{ currency_code: "usd", amount: 25 }])
      await container().resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.CART]: { cart_id: cart.id },
        [Modules.PAYMENT]: { payment_collection_id: collection.id },
      })
      await payments.createPaymentSession(collection.id, { provider_id: "pp_stripe_stripe", amount: 25, currency_code: "usd", data: {} })

      const response = await api.post(`/store/carts/${cart.id}/complete`, {}, pak).catch((e: any) => e.response)
      if (response.status !== 200) {
        throw new Error(`expected 200, the route answered ${response.status}: ${JSON.stringify(response.data)}`)
      }
      await drainSubscribers()

      const orders = await container().resolve(Modules.ORDER).listOrders({ customer_id: customer.id })
      expect(orders).toHaveLength(1)
      return { order: orders[0] as { id: string }, vendor: vendor.seller, creator, link, collectionId: collection.id as string }
    }

    describe("an attributed order placed through the storefront checkout", () => {
      afterEach(async () => {
        await drainSubscribers()
        delete process.env[CARD]
        const stalled = await clearStalledWorkflows(container)
        jest.restoreAllMocks()
        if (stalled.length) {
          throw new Error(`Workflow executions left unfinished: ${stalled.map((w) => `${w.workflow_id} (${w.state})`).join(", ")}`)
        }
      })

      it("a $25.00 order at 10% records commission 250; the breakdown pays the creator 250 and the vendor the rest; the ledger credits and a refund reverses $2.50", async () => {
        const { order, vendor, creator, collectionId } = await placeAttributedOrder()

        // The premise, read off the order module: Medusa v2 amounts are major units.
        const { data: [placed] } = await container()
          .resolve(ContainerRegistrationKeys.QUERY)
          .graph({ entity: "order", fields: ["id", "subtotal", "total", "currency_code"], filters: { id: order.id } })
        expect(Number(placed.subtotal)).toBe(25)
        expect(placed.currency_code).toBe("usd")
        // Placed with FF_CARD_ORDER_LEDGER_V1 off (the default), the app's own
        // order.placed settlement wrote no ledger leg for it (SD-39: the
        // legacy read throws). The corrective script reads exactly this: an
        // order with no settlement leg to the vendor is listed, not corrected.
        expect(await hawala().listLedgerEntries({ order_id: order.id })).toEqual([])

        // What the order.placed subscriber stored.
        const rows = await attribution().listOrderAttributions({ order_id: order.id })
        expect(rows).toHaveLength(1)
        const [row] = rows
        expect(row).toMatchObject({
          creator_seller_id: creator.id,
          vendor_id: vendor.id,
          level: 1,
          commission_status: CommissionStatus.HELD,
          currency_code: "usd",
          metadata: { [AMOUNT_UNIT_METADATA_KEY]: AMOUNT_UNIT_MINOR },
        })
        expect(Number(row.commission_percent)).toBe(10) // NUMERIC: read back as "10"
        expect(Number(row.attributed_subtotal_cents)).toBe(2500)
        expect(Number(row.commission_basis_cents)).toBe(2500)
        expect(Number(row.commission_amount_cents)).toBe(250)
        // And in the column itself, past the service's BigNumber handling.
        const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
        const stored = await pg.raw(
          `SELECT commission_amount_cents::text AS commission, attributed_subtotal_cents::text AS subtotal,
                  raw_commission_amount_cents->>'value' AS raw_commission
             FROM order_attribution WHERE id = ?`,
          [row.id]
        )
        expect(stored.rows[0]).toEqual({ commission: "250", subtotal: "2500", raw_commission: "250" })

        // Settlement on capture (card orders, FF_CARD_ORDER_LEDGER_V1), which
        // stores the payout breakdown. Run here after the attribution is
        // written, which production does NOT guarantee: the hold window
        // governs approve-held, not settlement. A payment captured at
        // authorisation settles inside hawala-order-payment's own
        // `order.placed` handler, which runs concurrently with
        // attribute-order-on-placed (the Redis event bus runs an event's
        // subscribers with Promise.all), and if it reads the attribution
        // first the stored breakdown has no creator line. A pre-existing
        // race, recorded as SD-100 (4); the creator's credit is
        // unaffected, because approve-held reads the attribution row.
        process.env[CARD] = "true"
        const payments = container().resolve(Modules.PAYMENT)
        const collection = await payments.retrievePaymentCollection(collectionId, { relations: ["payments"] })
        const payment = collection.payments[0]
        if (!payment.captured_at) await payments.capturePayment({ payment_id: payment.id, amount: 25 })
        await hawalaOrderPaymentSubscriber({ event: { data: { id: order.id } }, container: container() } as any)

        const breakdowns = await container().resolve(PAYOUT_BREAKDOWN_MODULE).listOrderPayoutBreakdowns({ order_id: order.id })
        expect(breakdowns).toHaveLength(1)
        const [breakdown] = breakdowns
        const platformFee = Number(breakdown.total_platform_fees)
        expect(platformFee).toBeGreaterThan(0)
        expect(Number(breakdown.total_creator_commission)).toBe(250)
        const [vendorShare] = breakdown.seller_breakdown as unknown as Array<{ sellerId: string; gross: number; fees: number; net: number }>
        expect(vendorShare).toMatchObject({ sellerId: vendor.id, gross: 2500 })
        expect(vendorShare.net).toBe(2500 - platformFee - 250)
        expect(vendorShare.fees).toBe(platformFee + 250)
        expect(Number(breakdown.total_to_producers)).toBe(2500 - platformFee - 250)
        const creatorLine = (breakdown.breakdown_items as unknown as Array<{ type: string; amount: number }>).find(
          (i) => i.type === "CREATOR_COMMISSION"
        )
        expect(creatorLine?.amount).toBe(250)

        // The hold window ends and the approve-held job runs.
        await attribution().updateOrderAttributions({ id: row.id, hold_until: new Date(Date.now() - 60_000) })
        const creatorEarnings = async () =>
          (await hawala().listLedgerAccounts({ account_type: "CREATOR_EARNINGS", owner_id: creator.id }))[0]
        await approveHeldCreatorAttributionsJob(container())

        // A separate defect, found here and pinned as it is (the SD-39
        // pattern): the job opens the creator's earnings account in the
        // attribution's currency, Medusa's lowercase "usd", while settlement
        // opened the vendor's in the ledger default "USD", and the ledger's
        // cross-rail guard compares the two codes exactly. The transfer is
        // refused and the commission stays held, on every attributed order.
        // When that is fixed, this block goes.
        expect((await attribution().listOrderAttributions({ id: row.id }))[0].commission_status).toBe(CommissionStatus.HELD)
        expect(await hawala().listLedgerEntries({ reference_id: row.id, entry_type: "CREATOR_COMMISSION" })).toEqual([])
        expect((await creatorEarnings()).currency_code).toBe("usd")
        // The account has never held a cent, so it is relabelled to the rail's
        // code, as an operator repair would, and the job runs again.
        await container()
          .resolve(ContainerRegistrationKeys.PG_CONNECTION)
          .raw(`UPDATE hawala_ledger_account SET currency_code = 'USD' WHERE id = ?`, [(await creatorEarnings()).id])

        // Now it moves $2.50 (250 cents read from the column) from the
        // vendor's earnings to the creator's.
        await approveHeldCreatorAttributionsJob(container())
        const approved = (await attribution().listOrderAttributions({ id: row.id }))[0]
        expect(approved.commission_status).toBe(CommissionStatus.APPROVED)
        const credit = (await hawala().listLedgerEntries({ reference_id: row.id, entry_type: "CREATOR_COMMISSION" }))[0]
        expect(credit.id).toBe(approved.ledger_entry_id)
        expect(cents(credit.amount)).toBe(250)
        expect(cents((await creatorEarnings()).balance)).toBe(250)
        expect(credit.credit_account_id).toBe((await creatorEarnings()).id)
        const vendorEarnings = (await hawala().listLedgerAccounts({ account_type: "SELLER_EARNINGS", owner_id: vendor.id }))[0]
        expect(credit.debit_account_id).toBe(vendorEarnings.id)

        // The order is refunded: the reversal reads the same column and takes
        // back exactly what was credited.
        await processRefundReversesCommission({ event: { data: { id: order.id } }, container: container() } as any)
        const reversal = (await hawala().listLedgerEntries({ reference_id: row.id, entry_type: "REFUND" }))[0]
        expect(cents(reversal.amount)).toBe(250)
        expect(reversal.debit_account_id).toBe((await creatorEarnings()).id)
        expect(cents((await creatorEarnings()).balance)).toBe(0)
        expect((await attribution().listOrderAttributions({ id: row.id }))[0].commission_status).toBe(CommissionStatus.REVERSED)
      })
    })

    /**
     * The corrective script against rows as the old subscriber wrote them,
     * for real $25.00 orders whose subtotal the order module computes, each
     * linked to its seller the way Mercur's split links a placed order.
     *
     * The script corrects a held row only when the order's proceeds reached
     * the vendor's earnings and the order is past the payout window, counted
     * from when it settled, so an order a case expects corrected is settled
     * for real (`settle`: payment captured, then the settlement subscriber
     * under FF_CARD_ORDER_LEDGER_V1) and the script is run as of three days
     * on (`afterPayoutWindow`).
     *
     * ORDER SHAPE. `order25` + `settle` build an order with a payment
     * collection of its own and no `split_order_payment` row. That is NOT
     * the shape of an order placed through the storefront: Mercur's checkout
     * puts every order of a cart on one shared collection with a split row
     * each, and the ledger reads such an order's refunds from its split row.
     * A refund behaves differently on the two (Medusa's own refund is posted
     * to the ledger on a single-order collection and is not on a storefront
     * order), so the cases about refunds the ledger has not posted run on
     * orders placed through the real checkout, in the nested block below.
     */
    describe("scripts/fix-creator-commission-minor-units.ts", () => {
      const card = cardOrderFixtures(getContainer)

      afterEach(async () => {
        await drainSubscribers()
        delete process.env[CARD]
      })

      /** The reasons an order was listed for, without the closing sentence about the raised debit. */
      const why = (reason: string | undefined) => (reason ?? "(not listed for review)").split(". Correcting would raise")[0]

      /** A moment by which every order placed during the test is past the 2-day payout window. */
      const afterPayoutWindow = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

      /**
       * Settle the order as a card order settles when its payment is captured
       * at placement: the payment captured, then the real `order.placed`
       * settlement subscriber. Returns the leg that credited the seller's
       * earnings, checked to be the one the script looks for, and the payment.
       */
      async function settle(orderId: string, sellerId: string) {
        let paymentId: string
        process.env[CARD] = "true"
        try {
          ;({ paymentId } = await card.pay([orderId], 25, { capture: true }))
          await card.placed(orderId)
        } finally {
          delete process.env[CARD]
        }
        await drainSubscribers()
        const [leg] = await hawala().listLedgerEntries({ idempotency_key: `order-payment-${orderId}-seller` })
        expect(leg).toMatchObject({ status: "COMPLETED", entry_type: "TRANSFER", order_id: orderId })
        expect(leg.credit_account_id).toBe((await card.sellerEarnings(sellerId)).id)
        return { id: leg.id as string, paymentId }
      }

      /** The order's refund legs that moved money, as the script reads them. */
      const refundLegs = async (orderId: string) =>
        (await hawala().listLedgerEntries({ order_id: orderId, entry_type: "REFUND", status: ["COMPLETED", "SETTLED"] })) as Array<{
          id: string
          amount: unknown
          debit_account_id: string
        }>

      /** A Mercur payout of the order, recorded as Mercur's nightly job records one (`order_payout`). */
      async function mercurPayout(orderId: string, amount: number) {
        const payouts = container().resolve(PAYOUT_MODULE)
        const madeAccount = await payouts.createPayoutAccounts({
          status: "active",
          reference_id: `acct_${uid()}`,
          data: {},
          context: {},
        })
        const account = Array.isArray(madeAccount) ? madeAccount[0] : madeAccount
        const made = await payouts.createPayouts({
          amount,
          currency_code: "usd",
          data: { id: `tr_${uid()}` },
          payout_account: account.id,
        })
        const payout = Array.isArray(made) ? made[0] : made
        await container()
          .resolve(ContainerRegistrationKeys.LINK)
          .create({ [Modules.ORDER]: { order_id: orderId }, [PAYOUT_MODULE]: { payout_id: payout.id } })
        return payout as { id: string }
      }

      async function order25(sellerId: string) {
        const [order] = await container().resolve(Modules.ORDER).createOrders([
          {
            currency_code: "usd",
            customer_id: `cus_${uid()}`,
            email: "buyer@example.com",
            items: [{ title: "Tomatoes", quantity: 1, unit_price: 25 }],
          },
        ])
        await container()
          .resolve(ContainerRegistrationKeys.LINK)
          .create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.ORDER]: { order_id: order.id } })
        return order as { id: string }
      }

      async function attributionRow(orderId: string, vendorId: string, over: Record<string, unknown> = {}) {
        const created = await attribution().createOrderAttributions({
          order_id: orderId,
          creator_seller_id: "sel_creator",
          vendor_id: vendorId,
          source: "link_click",
          attribution_decided_at: new Date(),
          attributed_subtotal_cents: 25, // the old subscriber: major units as cents
          commission_basis_cents: 25,
          commission_amount_cents: 2, // floor(25 × 10 / 100)
          commission_percent: 10,
          currency_code: "usd",
          commission_status: CommissionStatus.HELD,
          level: 1,
          level_split_percent: 80,
          ...over,
        })
        return (Array.isArray(created) ? created[0] : created) as { id: string }
      }

      const read = async (id: string) => {
        const [r] = await attribution().listOrderAttributions({ id })
        return {
          subtotal: Number(r.attributed_subtotal_cents),
          basis: Number(r.commission_basis_cents),
          commission: Number(r.commission_amount_cents),
          status: r.commission_status,
          metadata: r.metadata,
        }
      }

      async function payoutRequest(vendorId: string, status: string) {
        const account = await hawala().getOrCreateSellerEarnings(vendorId, "USD")
        const [request] = await hawala().createPayoutRequests([
          {
            vendor_id: vendorId,
            ledger_account_id: account.id,
            payout_tier: "WEEKLY",
            payout_method: "ACH_BATCH",
            gross_amount: 100,
            fee_amount: 0,
            net_amount: 100,
            fee_rate: 0,
            requested_at: new Date(),
            status,
          },
        ])
        return request as { id: string }
      }

      // The ledger row's operator SQL, verbatim (trailing semicolon dropped),
      // run here so a typo or a wrong column fails a test, not an operator.
      const OPERATOR_SQL_1 =
        "SELECT oa.id, oa.order_id, oa.creator_seller_id, oa.vendor_id, oa.commission_status, oa.commission_amount_cents, oa.ledger_entry_id, le.amount, le.created_at FROM order_attribution oa LEFT JOIN hawala_ledger_entry le ON le.id = oa.ledger_entry_id WHERE oa.deleted_at IS NULL AND oa.commission_status IN ('approved','paid') AND COALESCE(oa.metadata->>'amount_unit','') <> 'minor' AND (oa.metadata -> 'amount_units_corrected') IS NULL"
      const OPERATOR_SQL_2 =
        "SELECT * FROM hawala_ledger_entry WHERE reference_type = 'CREATOR_ATTRIBUTION' AND entry_type IN ('CREATOR_COMMISSION','REFUND') ORDER BY created_at"
      // (3) the ledger rail's payouts (FF_LEDGER_CONNECT_PAYOUTS_V1): payout
      // requests that moved money, created since the vendor's first
      // attributed order was placed.
      const OPERATOR_SQL_3 =
        "SELECT pr.id, pr.vendor_id, pr.net_amount, pr.status, pr.created_at, pr.completed_at, fa.first_attributed_order_at FROM hawala_payout_request pr JOIN (SELECT oa.vendor_id, MIN(COALESCE(o.created_at, oa.created_at)) AS first_attributed_order_at FROM order_attribution oa LEFT JOIN \"order\" o ON o.id = oa.order_id WHERE oa.deleted_at IS NULL AND oa.vendor_id IS NOT NULL AND oa.commission_status NOT IN ('reversed','disqualified') GROUP BY oa.vendor_id) fa ON fa.vendor_id = pr.vendor_id WHERE pr.deleted_at IS NULL AND pr.status IN ('PROCESSING','IN_TRANSIT','COMPLETED') AND pr.created_at >= fa.first_attributed_order_at ORDER BY pr.created_at"
      // (3b) Mercur's payouts, the rail vendors are paid by while that flag
      // is off (the default): each attributed order Mercur has paid out.
      const OPERATOR_SQL_3B =
        "SELECT oa.id AS attribution_id, oa.order_id, oa.vendor_id, oa.commission_status, oa.commission_amount_cents, p.id AS payout_id, p.amount, p.currency_code, p.created_at FROM order_attribution oa JOIN order_payout op ON op.order_id = oa.order_id AND op.deleted_at IS NULL JOIN payout p ON p.id = op.payout_id AND p.deleted_at IS NULL WHERE oa.deleted_at IS NULL AND oa.level = 1 AND oa.commission_status NOT IN ('reversed','disqualified') ORDER BY p.created_at"
      const OPERATOR_SQL_4 =
        "SELECT b.order_id, b.total_creator_commission, b.total_to_producers FROM order_payout_breakdown b JOIN order_attribution oa ON oa.order_id = b.order_id AND oa.level = 1 WHERE COALESCE(oa.metadata->>'amount_unit','') <> 'minor' OR (oa.metadata -> 'amount_units_corrected') IS NOT NULL"

      it("dry run writes nothing; apply corrects the held row to 2500 / 250 and marks it, leaves the credited and the new rows alone; a second run skips it; the operator's SQL lists only the old-figure credit", async () => {
        const vendor = await makeSeller("Vendor")
        const [held, credited, fresh] = [await order25(vendor.id), await order25(vendor.id), await order25(vendor.id)]
        const heldRow = await attributionRow(held.id, vendor.id)
        const creditedRow = await attributionRow(credited.id, vendor.id, {
          commission_status: CommissionStatus.APPROVED,
          ledger_entry_id: "hle_already_credited",
        })
        const freshRow = await attributionRow(fresh.id, vendor.id, {
          attributed_subtotal_cents: 2500,
          commission_basis_cents: 2500,
          commission_amount_cents: 250,
          metadata: { [AMOUNT_UNIT_METADATA_KEY]: AMOUNT_UNIT_MINOR },
        })
        // The held order's payment is captured and it settles, after its
        // attribution was written: the vendor's earnings receive the sale and
        // the breakdown is stored with the old creator line.
        await settle(held.id, vendor.id)
        const now = afterPayoutWindow()

        const dry = await fixCreatorCommissionMinorUnits(container(), { now })
        expect(dry.corrected).toEqual([
          { order_id: held.id, subtotal: { from: 25, to: 2500 }, commission_total: { from: 2, to: 250 }, rows: [heldRow.id] },
        ])
        expect(dry.review.map((r) => r.order_id)).toEqual([credited.id])
        expect(dry.review[0].reason).toContain("hle_already_credited")
        expect(dry.skipped).toEqual([{ order_id: fresh.id, reason: "marked_minor_units" }])
        expect(await read(heldRow.id)).toMatchObject({ subtotal: 25, basis: 25, commission: 2 })

        const applied = await fixCreatorCommissionMinorUnits(container(), { apply: true, now })
        expect(applied.corrected.map((c) => c.order_id)).toEqual([held.id])
        const after = await read(heldRow.id)
        expect(after).toMatchObject({ subtotal: 2500, basis: 2500, commission: 250, status: CommissionStatus.HELD })
        expect(after.metadata).toMatchObject({
          [AMOUNT_UNIT_METADATA_KEY]: AMOUNT_UNIT_MINOR,
          amount_units_corrected: {
            by: "script:fix-creator-commission-minor-units",
            commission_amount_cents: { from: 2, to: 250 },
          },
        })
        // The raw SQL write leaves the bigNumber columns' JSONB companions
        // exactly as Medusa writes them for the same figures (the fresh row
        // was written through the ORM), so the ORM reads back the column.
        const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
        const raw = await pg.raw(
          `SELECT id, commission_amount_cents::text AS c, raw_commission_amount_cents AS rc,
                  raw_attributed_subtotal_cents AS rs, raw_commission_basis_cents AS rb
             FROM order_attribution WHERE id IN (?, ?)`,
          [heldRow.id, freshRow.id]
        )
        const byId = Object.fromEntries(raw.rows.map((r: any) => [r.id, r]))
        expect(byId[heldRow.id].c).toBe("250")
        expect(byId[heldRow.id].rc).toEqual(byId[freshRow.id].rc)
        expect(byId[heldRow.id].rs).toEqual(byId[freshRow.id].rs)
        expect(byId[heldRow.id].rb).toEqual(byId[freshRow.id].rb)
        expect(await read(creditedRow.id)).toMatchObject({ subtotal: 25, commission: 2, status: CommissionStatus.APPROVED })
        expect(await read(freshRow.id)).toMatchObject({ subtotal: 2500, commission: 250 })

        const again = await fixCreatorCommissionMinorUnits(container(), { apply: true, now })
        expect(again.corrected).toEqual([])
        expect(again.skipped).toEqual(
          expect.arrayContaining([
            { order_id: held.id, reason: "already_corrected" },
            { order_id: fresh.id, reason: "marked_minor_units" },
          ])
        )

        // approve-held later credits the corrected row at the right 250. The
        // operator's list of commission approved at the old figure must not
        // name it (that would invite topping the creator up twice), only the
        // row credited at 2.
        await attribution().updateOrderAttributions({
          id: heldRow.id,
          commission_status: CommissionStatus.APPROVED,
          ledger_entry_id: "hle_credited_at_250",
        })
        const ours = [heldRow.id, creditedRow.id, freshRow.id]
        const sql1 = await pg.raw(`SELECT q.id FROM (${OPERATOR_SQL_1}) q WHERE q.id = ANY(?)`, [ours])
        expect(sql1.rows.map((r: any) => r.id)).toEqual([creditedRow.id])

        // The corrected order's stored breakdown still carries the old
        // creator line, as settlement wrote it from the row's old figure
        // (breakdowns are not recomputed): SQL (4) names it, and not the new
        // order's.
        const breakdowns = container().resolve(PAYOUT_BREAKDOWN_MODULE)
        const [heldBreakdown] = await breakdowns.listOrderPayoutBreakdowns({ order_id: held.id })
        expect(Number(heldBreakdown.total_creator_commission)).toBe(2)
        await breakdowns.createOrderPayoutBreakdowns({
          order_id: fresh.id,
          customer_id: "cus_breakdown",
          customer_paid: 2500,
          breakdown_items: [],
          seller_breakdown: [],
          total_to_producers: 2500 - 75 - 250,
          total_platform_fees: 75,
          total_payment_processing: 0,
          total_creator_commission: 250,
        })
        const sql4 = await pg.raw(`SELECT q.order_id FROM (${OPERATOR_SQL_4}) q WHERE q.order_id = ANY(?)`, [
          [held.id, credited.id, fresh.id],
        ])
        expect(sql4.rows.map((r: any) => r.order_id)).toEqual([held.id])
        // (2) is a read-only listing; it runs. (3) and (3b) are checked in
        // the cases below.
        await pg.raw(OPERATOR_SQL_2)
      })

      it("lists instead of correcting a held row whose vendor was paid out after the order or did not sell it; corrects one whose vendor was paid only before it or not at all", async () => {
        // Every order here settled to its seller's earnings, so each is
        // listed for the one reason its fixture gives it.
        // Paid out after the order: a payout request whose legs took money
        // off the vendor's earnings, and a completed withdrawal leg.
        const paidVendor = await makeSeller("Paid")
        const paidOrder = await order25(paidVendor.id)
        const paidRow = await attributionRow(paidOrder.id, paidVendor.id)
        await settle(paidOrder.id, paidVendor.id)
        const request = await payoutRequest(paidVendor.id, "COMPLETED")

        const withdrawnVendor = await makeSeller("Withdrawn")
        const withdrawnOrder = await order25(withdrawnVendor.id)
        const withdrawnRow = await attributionRow(withdrawnOrder.id, withdrawnVendor.id)
        await settle(withdrawnOrder.id, withdrawnVendor.id)
        const earnings = await hawala().getOrCreateSellerEarnings(withdrawnVendor.id, "USD")
        const settlement = await hawala().getOrCreateSystemAccount("SETTLEMENT")
        const [withdrawal] = await hawala().createLedgerEntries([
          {
            debit_account_id: earnings.id,
            credit_account_id: settlement.id,
            amount: 10,
            entry_type: "WITHDRAWAL",
            status: "COMPLETED",
            reference_type: "PAYOUT_REQUEST",
            reference_id: "pr_elsewhere",
          },
        ])

        // The same, after the daily settlement batch anchored the vendor's
        // legs (jobs/hawala-settlement.ts re-labels COMPLETED as SETTLED):
        // the settlement leg still counts as the order's proceeds arriving,
        // and the withdrawal still counts as money gone.
        const anchoredVendor = await makeSeller("Anchored")
        const anchoredOrder = await order25(anchoredVendor.id)
        const anchoredRow = await attributionRow(anchoredOrder.id, anchoredVendor.id)
        const anchoredLeg = await settle(anchoredOrder.id, anchoredVendor.id)
        const anchoredEarnings = await hawala().getOrCreateSellerEarnings(anchoredVendor.id, "USD")
        const [anchoredWithdrawal] = await hawala().createLedgerEntries([
          {
            debit_account_id: anchoredEarnings.id,
            credit_account_id: settlement.id,
            amount: 10,
            entry_type: "WITHDRAWAL",
            status: "COMPLETED",
            reference_type: "PAYOUT_REQUEST",
            reference_id: "pr_anchored",
          },
        ])
        for (const id of [anchoredLeg.id, anchoredWithdrawal.id]) {
          await hawala().updateLedgerEntries({ id, status: "SETTLED", settled_at: new Date() })
        }

        // Paid another vendor out of their earnings after the order
        // (createVendorToVendorPayment's leg type, outside the model's enum).
        const payingVendor = await makeSeller("Paying")
        const payingOrder = await order25(payingVendor.id)
        const payingRow = await attributionRow(payingOrder.id, payingVendor.id)
        await settle(payingOrder.id, payingVendor.id)
        const payingEarnings = await hawala().getOrCreateSellerEarnings(payingVendor.id, "USD")
        const [vendorPayment] = await hawala().createLedgerEntries([
          {
            debit_account_id: payingEarnings.id,
            credit_account_id: earnings.id,
            amount: 5,
            entry_type: "VENDOR_PAYMENT",
            status: "COMPLETED",
            reference_type: "VENDOR_PAYMENT",
          },
        ])

        // The creator's link named a vendor that did not sell this order;
        // the order settled to its seller.
        const seller = await makeSeller("Seller")
        const linkVendor = await makeSeller("LinkVendor")
        const splitOrder = await order25(seller.id)
        const splitRow = await attributionRow(splitOrder.id, linkVendor.id)
        await settle(splitOrder.id, seller.id)

        // Paid out only BEFORE the order, and a payout after it that failed
        // (moved nothing): neither counts, so this one is corrected.
        const earlyVendor = await makeSeller("Early")
        const earlyRequest = await payoutRequest(earlyVendor.id, "COMPLETED")
        await new Promise((r) => setTimeout(r, 20))
        const earlyOrder = await order25(earlyVendor.id)
        const earlyRow = await attributionRow(earlyOrder.id, earlyVendor.id)
        await settle(earlyOrder.id, earlyVendor.id)
        const failedRequest = await payoutRequest(earlyVendor.id, "FAILED")

        const summary = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
        const reasons = Object.fromEntries(summary.review.map((r) => [r.order_id, r.reason]))
        const paidOut = (vendorId: string, what: string) =>
          `vendor ${vendorId} has been paid out since the order was placed (${what}), ` +
          `and the commission was never carved out of what they were paid`
        // Each of these four is listed for its payout and nothing else.
        expect(why(reasons[paidOrder.id])).toBe(paidOut(paidVendor.id, `payout request ${request.id} COMPLETED`))
        expect(reasons[paidOrder.id]).toContain("from 2 to 250")
        expect(why(reasons[withdrawnOrder.id])).toBe(paidOut(withdrawnVendor.id, `withdrawal ${withdrawal.id} COMPLETED`))
        expect(why(reasons[anchoredOrder.id])).toBe(paidOut(anchoredVendor.id, `withdrawal ${anchoredWithdrawal.id} SETTLED`))
        expect(why(reasons[payingOrder.id])).toBe(paidOut(payingVendor.id, `vendor payment ${vendorPayment.id} COMPLETED`))
        expect(reasons[splitOrder.id]).toContain(`the attributed vendor ${linkVendor.id} is not the order's seller ${seller.id}`)
        // Its settlement credited the seller, which is not the link's vendor's earnings.
        expect(reasons[splitOrder.id]).toContain(`the order's proceeds never reached vendor ${linkVendor.id}'s earnings in the ledger`)
        expect(summary.corrected.map((c) => c.order_id)).toEqual([earlyOrder.id])

        for (const id of [paidRow.id, withdrawnRow.id, anchoredRow.id, payingRow.id, splitRow.id]) {
          expect(await read(id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null })
        }
        expect(await read(earlyRow.id)).toMatchObject({ subtotal: 2500, commission: 250 })

        // Operator SQL (3): payout requests that moved money since the
        // vendor's first attributed order. Not the one made before it, not
        // the one that failed after it.
        const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
        const sql3 = await pg.raw(`SELECT q.id, q.vendor_id FROM (${OPERATOR_SQL_3}) q WHERE q.vendor_id = ANY(?)`, [
          [paidVendor.id, earlyVendor.id],
        ])
        expect(sql3.rows).toEqual([{ id: request.id, vendor_id: paidVendor.id }])
        expect([earlyRequest.id, failedRequest.id]).not.toContain(sql3.rows[0].id)
      })

      it("lists a held row whose order never settled to the vendor's earnings; corrects it once the settlement subscriber has run", async () => {
        const vendor = await makeSeller("Unsettled")
        const order = await order25(vendor.id)
        const row = await attributionRow(order.id, vendor.id)

        // No leg of this order exists: nothing credited the vendor. (With
        // FF_CARD_ORDER_LEDGER_V1 off no order settles at all, SD-39.)
        expect(await hawala().listLedgerEntries({ order_id: order.id })).toEqual([])
        const before = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
        expect(before.corrected).toEqual([])
        expect(before.review).toEqual([
          {
            order_id: order.id,
            reason: expect.stringContaining(`the order's proceeds never reached vendor ${vendor.id}'s earnings in the ledger`),
          },
        ])
        expect(before.review[0].reason).toContain("from 2 to 250")
        expect(await read(row.id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null })
        // Nor was it paid by card: it has no payment collection, and the
        // payment-side read says nothing was captured or refunded that it
        // can put on the order. Listed for that as well, not taken as
        // "not refunded".
        expect(await readCardSettlementOrder(container(), order.id)).toMatchObject({
          funding: "other",
          payment_collection_ids: [],
          captured: null,
          refunded: null,
          unattributed_refund: null,
          dispute_open: 0,
        })
        expect(before.review[0].reason).toContain(
          `the order was not paid through FBM's own card account (its payment reads as "other"; it has no payment collection), ` +
            `so its payment records cannot show that it was not refunded`
        )

        // The same order once its payment is captured and the settlement
        // subscriber has credited the vendor's earnings.
        await settle(order.id, vendor.id)
        const after = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
        expect(after.review).toEqual([])
        expect(after.corrected.map((c) => c.order_id)).toEqual([order.id])
        expect(await read(row.id)).toMatchObject({ subtotal: 2500, commission: 250, status: CommissionStatus.HELD })
      })

      it("lists a held row on an order placed in the last 2 days or one Mercur already paid out; corrects the first once the payout window has passed; operator SQL (3b) lists the Mercur payout", async () => {
        // Settled to its seller, nobody paid: only its age stands in the way.
        const recentVendor = await makeSeller("Recent")
        const recentOrder = await order25(recentVendor.id)
        const recentRow = await attributionRow(recentOrder.id, recentVendor.id)
        await settle(recentOrder.id, recentVendor.id)

        // Settled, and Mercur's nightly job has already paid the order out.
        const mercurVendor = await makeSeller("MercurPaid")
        const mercurOrder = await order25(mercurVendor.id)
        const mercurRow = await attributionRow(mercurOrder.id, mercurVendor.id)
        await settle(mercurOrder.id, mercurVendor.id)
        const payout = await mercurPayout(mercurOrder.id, 24.25)
        // An order Mercur paid that no creator is attributed on.
        const plainOrder = await order25(mercurVendor.id)
        await mercurPayout(plainOrder.id, 24.25)

        // Run now, as the CLI does: both are listed, each for its own reason.
        const today = await fixCreatorCommissionMinorUnits(container(), { apply: true })
        const todays = Object.fromEntries(today.review.map((r) => [r.order_id, r.reason]))
        expect(today.corrected).toEqual([])
        // It settled moments after it was placed; the window runs from that.
        expect(why(todays[recentOrder.id])).toBe(
          "the order's proceeds reached the vendor's earnings 0 hours before this check (the order was placed 0 hours before it), " +
            "inside the 48 hours in which the nightly payout sends an order's proceeds to its vendor, and no payout for it exists yet"
        )
        expect(why(todays[mercurOrder.id])).toBe(
          `the order's proceeds were already sent to the vendor by Mercur payout ${payout.id}`
        )
        for (const id of [recentRow.id, mercurRow.id]) {
          expect(await read(id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null })
        }

        // Three days on: the unpaid order is corrected; the one Mercur paid
        // is still listed, whatever its age.
        const later = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
        expect(later.corrected.map((c) => c.order_id)).toEqual([recentOrder.id])
        expect(later.review.map((r) => r.order_id)).toEqual([mercurOrder.id])
        expect(later.review[0].reason).toContain(`Mercur payout ${payout.id}`)
        expect(await read(recentRow.id)).toMatchObject({ subtotal: 2500, commission: 250 })
        expect(await read(mercurRow.id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null })

        // Operator SQL (3b): Mercur payouts of attributed orders. The
        // attributed order's payout, not the unattributed order's.
        const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
        const sql3b = await pg.raw(
          `SELECT q.attribution_id, q.order_id, q.vendor_id, q.payout_id, q.amount::float AS amount, q.currency_code
             FROM (${OPERATOR_SQL_3B}) q WHERE q.order_id = ANY(?)`,
          [[recentOrder.id, mercurOrder.id, plainOrder.id]]
        )
        expect(sql3b.rows).toEqual([
          {
            attribution_id: mercurRow.id,
            order_id: mercurOrder.id,
            vendor_id: mercurVendor.id,
            payout_id: payout.id,
            amount: 24.25,
            currency_code: "usd",
          },
        ])
      })

      it("counts the payout window from the settlement: an order placed 5 days ago whose payment is captured only now is listed, and corrected once 2 days have passed since it settled", async () => {
        const vendor = await makeSeller("LateCapture")
        const order = await order25(vendor.id)
        const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
        await pg.raw(`UPDATE "order" SET created_at = now() - interval '120 hours' WHERE id = ?`, [order.id])
        const row = await attributionRow(order.id, vendor.id)

        // Authorised at placement and not captured. Stripe intents here are
        // manual-capture (the provider is registered with no `capture`
        // option); Mercur's capture-on-placement subscriber normally
        // captures at once, and this is the order it did not capture. The
        // order.placed settlement finds nothing captured and writes no leg.
        process.env[CARD] = "true"
        const { paymentId } = await card.pay([order.id], 25, { capture: false })
        await card.placed(order.id)
        expect(await hawala().listLedgerEntries({ order_id: order.id })).toEqual([])

        // Run now, five days after the order: nothing has reached the vendor.
        const uncaptured = await fixCreatorCommissionMinorUnits(container(), { apply: true })
        expect(uncaptured.corrected).toEqual([])
        expect(uncaptured.review.map((r) => r.order_id)).toEqual([order.id])
        expect(why(uncaptured.review[0].reason)).toBe(
          `the order's proceeds never reached vendor ${vendor.id}'s earnings in the ledger ` +
            `(no settlement leg of the order that moved money credits them), so the debit would come out of other orders' proceeds`
        )
        expect(uncaptured.never_settled).toEqual([order.id])

        // The payment is captured today and `payment.captured` settles the
        // order: the nightly payout will send these proceeds tonight.
        await card.setProvider(paymentId, "pp_system_default")
        await container().resolve(Modules.PAYMENT).capturePayment({ payment_id: paymentId, amount: 25 })
        await card.setProvider(paymentId, "pp_stripe_stripe")
        await card.captured(paymentId)
        delete process.env[CARD]
        await drainSubscribers()
        const [leg] = await hawala().listLedgerEntries({ idempotency_key: `order-payment-${order.id}-seller` })
        expect(leg).toMatchObject({ status: "COMPLETED", entry_type: "TRANSFER", order_id: order.id })
        expect(leg.credit_account_id).toBe((await card.sellerEarnings(vendor.id)).id)

        // Run now, as the CLI does: the order is five days old, its proceeds
        // minutes old. Listed for the settlement's age and nothing else.
        const today = await fixCreatorCommissionMinorUnits(container(), { apply: true })
        expect(today.corrected).toEqual([])
        expect(today.review.map((r) => r.order_id)).toEqual([order.id])
        expect(why(today.review[0].reason)).toBe(
          "the order's proceeds reached the vendor's earnings 0 hours before this check (the order was placed 120 hours before it), " +
            "inside the 48 hours in which the nightly payout sends an order's proceeds to its vendor, and no payout for it exists yet"
        )
        expect(today.never_settled).toEqual([])
        expect(await read(row.id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null })

        // One millisecond short of two days after the leg was written: still
        // listed. At two days: corrected.
        const settledAt = new Date(leg.created_at).getTime()
        const almost = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: new Date(settledAt + 2 * 24 * 60 * 60 * 1000 - 1) })
        expect(almost.corrected).toEqual([])
        expect(why(almost.review[0].reason)).toContain("the order's proceeds reached the vendor's earnings 47 hours before this check")
        const later = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: new Date(settledAt + 2 * 24 * 60 * 60 * 1000) })
        expect(later.review).toEqual([])
        expect(later.corrected.map((c) => c.order_id)).toEqual([order.id])
        expect(await read(row.id)).toMatchObject({ subtotal: 2500, commission: 250, status: CommissionStatus.HELD })
      })

      it("single-order collections, not storefront orders: lists a held row whose order was refunded in the ledger, in part, in full, or with nothing left to take from the vendor; the refund is on its payment records too, and leaves the attribution held", async () => {
        const notReversed = "and its attribution was not reversed (a refund does not reverse a held attribution; only a cancellation does)"
        const statusOf = async (id: string) => (await read(id)).status
        const onPaymentRecords = (refunded: number) => `the order's payment records show ${refunded} refunded of 25 captured`

        // NOT STOREFRONT ORDERS. Each order here has a payment collection of
        // its own and no split payment row, so the ledger takes its refund
        // straight from the collection and posts it. An order placed through
        // the storefront checkout shares its cart's collection, and the same
        // refund on it is posted to no order: those are the cases in the
        // nested block below.
        //
        // Refunded in part, $20 of $25, through Medusa's own refund workflow
        // (the admin "Refund Payment" route). It emits `payment.refunded` and
        // nothing about the order; the app's own subscribers take it from
        // the event bus.
        const partVendor = await makeSeller("PartRefund")
        const partOrder = await order25(partVendor.id)
        const partRow = await attributionRow(partOrder.id, partVendor.id)
        const part = await settle(partOrder.id, partVendor.id)
        const partEarnings = await card.sellerEarnings(partVendor.id)
        expect(card.cents(partEarnings.balance)).toBe(2425)
        process.env[CARD] = "true"
        await refundPaymentWorkflow(container()).run({ input: { payment_id: part.paymentId, amount: 20 } })
        await drainSubscribers()
        delete process.env[CARD]
        // The ledger took the seller's share of the refund out of the
        // vendor's earnings and left the settlement leg as it was.
        const partLegs = await refundLegs(partOrder.id)
        const partOffVendor = partLegs.filter((l) => l.debit_account_id === partEarnings.id)
        expect(partOffVendor.map((l) => card.cents(l.amount))).toEqual([1940])
        expect(card.cents((await card.sellerEarnings(partVendor.id)).balance)).toBe(485)
        expect((await hawala().listLedgerEntries({ id: part.id }))[0].status).toBe("COMPLETED")
        // The payment side, as the script reads it: no split row, so the
        // collection's own refunded amount is this order's.
        expect(await readCardSettlementOrder(container(), partOrder.id)).toMatchObject({
          funding: "fbm_card",
          captured: 25,
          refunded: 20,
          unattributed_refund: null,
        })
        // And nothing reversed the attribution.
        expect(await statusOf(partRow.id)).toBe(CommissionStatus.HELD)

        // Refunded in full: the settlement legs are marked REVERSED.
        const fullVendor = await makeSeller("FullRefund")
        const fullOrder = await order25(fullVendor.id)
        const fullRow = await attributionRow(fullOrder.id, fullVendor.id)
        const full = await settle(fullOrder.id, fullVendor.id)
        const fullEarnings = await card.sellerEarnings(fullVendor.id)
        process.env[CARD] = "true"
        await card.refund(full.paymentId, 25)
        await card.refunded(full.paymentId)
        delete process.env[CARD]
        await drainSubscribers()
        const fullOffVendor = (await refundLegs(fullOrder.id)).filter((l) => l.debit_account_id === fullEarnings.id)
        expect(fullOffVendor.map((l) => card.cents(l.amount))).toEqual([2425])
        expect((await hawala().listLedgerEntries({ id: full.id }))[0].status).toBe("REVERSED")
        expect(await statusOf(fullRow.id)).toBe(CommissionStatus.HELD)

        // Refunded in part when the vendor's earnings hold nothing: the money
        // was taken to repay what the vendor owed (simulated here by one
        // ADJUSTMENT transfer off their earnings, which the script reads as
        // their earnings having been drawn on). The ledger records the refund
        // as owed by the vendor and posts no leg off their earnings; the
        // order was refunded all the same.
        const owedVendor = await makeSeller("OwedRefund")
        const owedOrder = await order25(owedVendor.id)
        const owedRow = await attributionRow(owedOrder.id, owedVendor.id)
        const owed = await settle(owedOrder.id, owedVendor.id)
        const owedEarnings = await card.sellerEarnings(owedVendor.id)
        const reserve = await hawala().getOrCreateSystemAccount("RESERVE")
        const taken = await hawala().createTransfer({
          debit_account_id: owedEarnings.id,
          credit_account_id: reserve.id,
          amount: Number(owedEarnings.balance),
          entry_type: "ADJUSTMENT",
          description: "spec: the vendor's earnings recovered against what they owe",
        })
        expect(taken).toMatchObject({ status: "COMPLETED", entry_type: "ADJUSTMENT" })
        expect(card.cents((await card.sellerEarnings(owedVendor.id)).balance)).toBe(0)
        process.env[CARD] = "true"
        await card.refund(owed.paymentId, 20)
        await card.refunded(owed.paymentId)
        delete process.env[CARD]
        await drainSubscribers()
        const owedLegs = await refundLegs(owedOrder.id)
        expect(owedLegs.length).toBeGreaterThan(0)
        expect(owedLegs.filter((l) => l.debit_account_id === owedEarnings.id)).toEqual([])
        expect((await hawala().listLedgerEntries({ id: owed.id }))[0].status).toBe("COMPLETED")
        expect(await statusOf(owedRow.id)).toBe(CommissionStatus.HELD)

        // Three days on, so nothing about any order's age stands in the way.
        const summary = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
        const reasons = Object.fromEntries(summary.review.map((r) => [r.order_id, r.reason]))
        expect(summary.corrected).toEqual([])
        // Each line: what the ledger posted, then what the payment records
        // show. The ledger read words the line; either lists the order.
        expect(why(reasons[partOrder.id])).toBe(
          `the order was refunded out of vendor ${partVendor.id}'s earnings (refund leg ${partOffVendor[0].id} 19.4 COMPLETED) ${notReversed}; ` +
            onPaymentRecords(20)
        )
        expect(reasons[partOrder.id]).toContain("from 2 to 250")
        expect(why(reasons[fullOrder.id])).toBe(
          `the order's proceeds reached vendor ${fullVendor.id}'s earnings in the ledger and a refund reversed them ` +
            `(its settlement leg is REVERSED), so the debit would come out of other orders' proceeds; ` +
            `the order was refunded out of vendor ${fullVendor.id}'s earnings (refund leg ${fullOffVendor[0].id} 24.25 COMPLETED) ${notReversed}; ` +
            onPaymentRecords(25)
        )
        const owedReason = why(reasons[owedOrder.id])
        const drawnOn =
          `vendor ${owedVendor.id}'s earnings were drawn on since the order was placed ` +
          `(adjustment ${taken.id} COMPLETED), ` +
          `and the commission was never carved out of what was taken; `
        expect(owedReason.startsWith(`${drawnOn}the order was refunded in the ledger (refund leg `)).toBe(true)
        expect(owedReason.endsWith(`) with nothing taken from ${owedVendor.id}'s earnings, ${notReversed}; ${onPaymentRecords(20)}`)).toBe(true)
        for (const leg of owedLegs) expect(owedReason).toContain(`refund leg ${leg.id} `)
        // None of the three is counted as never having settled.
        expect(summary.never_settled).toEqual([])
        for (const id of [partRow.id, fullRow.id, owedRow.id]) {
          expect(await read(id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null, status: CommissionStatus.HELD })
        }
      })

      it("lists a held row whose payment is not a card payment's, though its proceeds are in the vendor's earnings; corrects it once the payment is FBM card money again", async () => {
        // Settled as a card order, so nothing else stands in the way; then
        // its payment is another provider's (the fixtures' own system
        // provider, with the label the settlement code reads put back).
        const vendor = await makeSeller("OtherProvider")
        const order = await order25(vendor.id)
        const row = await attributionRow(order.id, vendor.id)
        const { paymentId } = await settle(order.id, vendor.id)
        await card.setProvider(paymentId, "pp_system_default")

        // What the payment-side read returns for an order not paid by card
        // that has a collection of its own: that collection's amounts, under
        // a funding that is not FBM card money.
        const paid = await readCardSettlementOrder(container(), order.id)
        expect(paid).toMatchObject({ funding: "other", captured: 25, refunded: 0, unattributed_refund: null, dispute_open: 0 })
        const [collectionId] = paid!.payment_collection_ids

        const listed = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
        expect(listed.corrected).toEqual([])
        expect(listed.review.map((r) => r.order_id)).toEqual([order.id])
        expect(why(listed.review[0].reason)).toBe(
          `the order was not paid through FBM's own card account (its payment reads as "other"; payment collection ${collectionId}), ` +
            `so its payment records cannot show that it was not refunded`
        )
        expect(listed.never_settled).toEqual([])
        expect(await read(row.id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null })

        await card.setProvider(paymentId, "pp_stripe_stripe")
        const corrected = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
        expect(corrected.review).toEqual([])
        expect(corrected.corrected.map((c) => c.order_id)).toEqual([order.id])
        expect(await read(row.id)).toMatchObject({ subtotal: 2500, commission: 250, status: CommissionStatus.HELD })
      })

      it("lists a held row whose vendor's earnings were drawn on since the order: the ledger's own recovery of what the vendor owed at settlement, and an advance repayment", async () => {
        // A vendor who owes for a refund. An earlier order of theirs, with no
        // creator on it, settles; their earnings leave; the order is then
        // refunded, and with nothing to take the ledger records the seller's
        // share as owed by the vendor.
        const owing = await makeSeller("Owing")
        const earlier = await order25(owing.id)
        const earlierPaid = await settle(earlier.id, owing.id)
        const owingEarnings = await card.sellerEarnings(owing.id)
        const reserve = await hawala().getOrCreateSystemAccount("RESERVE")
        const before = await hawala().createTransfer({
          debit_account_id: owingEarnings.id,
          credit_account_id: reserve.id,
          amount: Number(owingEarnings.balance),
          entry_type: "ADJUSTMENT",
          description: "spec: the vendor's earnings leave before the attributed order is placed",
        })
        process.env[CARD] = "true"
        await card.refund(earlierPaid.paymentId, 20)
        await card.refunded(earlierPaid.paymentId)
        delete process.env[CARD]
        await drainSubscribers()
        expect((await hawala().getCardProcessingReceivable(owingEarnings.id)).total_cents).toBe(1940)

        // The attributed order is placed after all of that and settles. The
        // ledger takes what the vendor owes out of this order's seller
        // credit (`recoverFromSellerCredit_`): the real recovery, an
        // ADJUSTMENT leg off their earnings.
        await new Promise((r) => setTimeout(r, 20))
        const order = await order25(owing.id)
        const row = await attributionRow(order.id, owing.id)
        await settle(order.id, owing.id)
        const recoveries = (
          (await hawala().listLedgerEntries(
            { debit_account_id: owingEarnings.id, entry_type: "ADJUSTMENT", status: "COMPLETED" },
            { order: { created_at: "ASC" } }
          )) as Array<{ id: string; amount: unknown; metadata: Record<string, unknown> | null }>
        ).filter((e) => e.id !== before.id)
        expect(recoveries).toHaveLength(1)
        expect(card.cents(recoveries[0].amount)).toBe(1940)
        expect(recoveries[0].metadata).toMatchObject({ source: "seller_credit", source_order_id: order.id })
        // The order's proceeds are no longer all there: 24.25 came in, 19.40 went to the debt.
        expect(card.cents((await card.sellerEarnings(owing.id)).balance)).toBe(485)

        // A vendor repaying an advance out of the sale, through the
        // service's own `processAdvanceRepayment` (nothing calls it today).
        const advanced = await makeSeller("Advanced")
        const advancedOrder = await order25(advanced.id)
        const advancedRow = await attributionRow(advancedOrder.id, advanced.id)
        await settle(advancedOrder.id, advanced.id)
        const advancedEarnings = await card.sellerEarnings(advanced.id)
        await hawala().createVendorAdvances({
          vendor_id: advanced.id,
          ledger_account_id: advancedEarnings.id,
          principal_amount: 100,
          outstanding_balance: 110,
          fee_type: "FACTOR_RATE",
          fee_rate: 1.1,
          repayment_method: "AUTO_DEDUCT",
          repayment_rate: 0.2,
          term_days: 30,
          start_date: new Date(),
          expected_end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          status: "ACTIVE",
        })
        expect(await hawala().processAdvanceRepayment({ vendor_id: advanced.id, order_id: advancedOrder.id, sale_amount: 25 })).toMatchObject({
          repayment_amount: 5,
        })
        const [repayment] = await hawala().listLedgerEntries({ debit_account_id: advancedEarnings.id, entry_type: "ADVANCE_REPAYMENT" })
        expect(repayment).toMatchObject({ status: "COMPLETED" })
        expect(card.cents(repayment.amount)).toBe(500)

        const summary = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
        const reasons = Object.fromEntries(summary.review.map((r) => [r.order_id, r.reason]))
        const drawnOn = (vendorId: string, what: string) =>
          `vendor ${vendorId}'s earnings were drawn on since the order was placed ` +
          `(${what}), and the commission was never carved out of what was taken`
        expect(summary.corrected).toEqual([])
        // Each is listed for that and nothing else. The transfer made before
        // the order was placed is not named: only what left since counts.
        expect(why(reasons[order.id])).toBe(drawnOn(owing.id, `adjustment ${recoveries[0].id} COMPLETED`))
        expect(reasons[order.id]).toContain("from 2 to 250")
        expect(why(reasons[advancedOrder.id])).toBe(drawnOn(advanced.id, `advance repayment ${repayment.id} COMPLETED`))
        for (const id of [row.id, advancedRow.id]) {
          expect(await read(id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null })
        }
      })

      it("a cart of two sellers on one payment collection (split rows, built from fixtures): a refund recorded on no order lists the attributed order; assigned by an admin to the other seller's order it is corrected, assigned to it it stays listed as refunded", async () => {
        const notReversed = "its attribution was not reversed (a refund does not reverse a held attribution; only a cancellation does)"

        /**
         * Two sellers' $25 orders paid by one $50 card payment, each with
         * its split row, as Mercur's checkout leaves a two-seller cart; the
         * first carries a held attribution at the old figures. Both settled.
         */
        async function cartOfTwo(label: string) {
          const vendor = await makeSeller(`${label}Vendor`)
          const otherSeller = await makeSeller(`${label}Other`)
          const attributed = await order25(vendor.id)
          const other = await order25(otherSeller.id)
          const row = await attributionRow(attributed.id, vendor.id)
          process.env[CARD] = "true"
          try {
            const { collectionId, paymentId } = await card.pay([attributed.id, other.id], 50, { capture: true })
            await card.split(attributed.id, collectionId, 25)
            await card.split(other.id, collectionId, 25)
            await card.placed(attributed.id)
            await card.placed(other.id)
            // $20 of the $50 refunded with Medusa's own refund: on the
            // collection, on neither order's split row.
            await card.refund(paymentId, 20)
            await card.refunded(paymentId)
            await drainSubscribers()
            const [leg] = await hawala().listLedgerEntries({ idempotency_key: `order-payment-${attributed.id}-seller` })
            expect(leg).toMatchObject({ status: "COMPLETED", order_id: attributed.id })
            expect(leg.credit_account_id).toBe((await card.sellerEarnings(vendor.id)).id)
            return { vendor, attributed, other, row, collectionId }
          } finally {
            delete process.env[CARD]
          }
        }

        const toOther = await cartOfTwo("ToOther")
        const toAttributed = await cartOfTwo("ToAttributed")
        for (const cart of [toOther, toAttributed]) {
          // The refund could be either order's: it is reported for both,
          // and neither has a refund leg.
          for (const order of [cart.attributed, cart.other]) {
            expect(await readCardSettlementOrder(container(), order.id)).toMatchObject({
              captured: 25,
              refunded: 0,
              unattributed_refund: 20,
              refund_attribution: "gap",
            })
            expect(await refundLegs(order.id)).toEqual([])
          }
        }

        const unassigned = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
        const reasons = Object.fromEntries(unassigned.review.map((r) => [r.order_id, r.reason]))
        expect(unassigned.corrected).toEqual([])
        for (const cart of [toOther, toAttributed]) {
          expect(why(reasons[cart.attributed.id])).toBe(
            `20 was refunded on the order's payment collection ${cart.collectionId} and is recorded on no order ` +
              `(Medusa's own refund on a storefront order, or a refund made in Stripe: the ledger posts nothing for it until ` +
              `an admin assigns it to the sellers' orders), so some or all of it may be this order's, and ${notReversed}`
          )
          expect(await read(cart.row.id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null })
        }

        // An admin assigns each refund (`POST /admin/hawala/card-refunds/:id/attribute`
        // runs this): one cart's to the other seller's order, the other
        // cart's to the attributed order. The ledger then posts each to the
        // order it was assigned to.
        process.env[CARD] = "true"
        await attributeCollectionRefund(container(), {
          payment_collection_id: toOther.collectionId,
          allocations: [{ order_id: toOther.other.id, amount: 20 }],
          actor_id: "spec-admin",
        })
        await attributeCollectionRefund(container(), {
          payment_collection_id: toAttributed.collectionId,
          allocations: [{ order_id: toAttributed.attributed.id, amount: 20 }],
          actor_id: "spec-admin",
        })
        delete process.env[CARD]
        expect(await readCardSettlementOrder(container(), toOther.attributed.id)).toMatchObject({
          refunded: 0,
          unattributed_refund: null,
          refund_attribution: "complete",
        })
        expect(await readCardSettlementOrder(container(), toAttributed.attributed.id)).toMatchObject({
          refunded: 20,
          unattributed_refund: null,
        })
        const earnings = await card.sellerEarnings(toAttributed.vendor.id)
        const offVendor = (await refundLegs(toAttributed.attributed.id)).filter((l) => l.debit_account_id === earnings.id)
        expect(offVendor.map((l) => card.cents(l.amount))).toEqual([1940])

        const assigned = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
        // Not this order's refund after all: corrected.
        expect(assigned.corrected.map((c) => c.order_id)).toEqual([toOther.attributed.id])
        expect(await read(toOther.row.id)).toMatchObject({ subtotal: 2500, commission: 250, status: CommissionStatus.HELD })
        // This order's refund: listed, by the ledger's leg and by its split row.
        expect(assigned.review.map((r) => r.order_id)).toEqual([toAttributed.attributed.id])
        expect(why(assigned.review[0].reason)).toBe(
          `the order was refunded out of vendor ${toAttributed.vendor.id}'s earnings (refund leg ${offVendor[0].id} 19.4 COMPLETED) and ${notReversed}; ` +
            `the order's payment records show 20 refunded of 25 captured`
        )
        expect(await read(toAttributed.row.id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null })
      })

      /**
       * Orders placed through the storefront checkout, the way every
       * attributed order is placed: Mercur's split puts the order on the
       * cart's shared payment collection with a `split_order_payment` row of
       * its own. The ledger reads such an order's refunds from the split row,
       * so a refund can reach the customer and leave no REFUND leg: made with
       * Medusa's own refund (recorded on the collection, on no split row);
       * made on the split row before the reconciler job has run; or made
       * after the order's legs were anchored SETTLED. The script reads the
       * payment records for these; before it did, each order here was
       * corrected to 250 with its attribution still held.
       *
       * Two more, found by the review of that read, each corrected before
       * its case below: a vendor's earnings debited since the order by a leg
       * of an entry type the script did not name (it named four), and a
       * refund on a second payment collection of the order's, which the
       * payment records (read from the split row's collection) do not see.
       */
      describe("on orders placed through the storefront checkout", () => {
        afterEach(async () => {
          await drainSubscribers()
          delete process.env[CARD]
          const stalled = await clearStalledWorkflows(container)
          jest.restoreAllMocks()
          if (stalled.length) {
            throw new Error(`Workflow executions left unfinished: ${stalled.map((w) => `${w.workflow_id} (${w.state})`).join(", ")}`)
          }
        })

        const notReversed = "its attribution was not reversed (a refund does not reverse a held attribution; only a cancellation does)"
        const refundLegsOf = async (orderId: string) =>
          (await hawala().listLedgerEntries({ order_id: orderId, entry_type: "REFUND" })) as Array<{ id: string; status: string }>

        /**
         * A real checkout (`placeAttributedOrder`), its attribution row put
         * back to what the old subscriber wrote for it, then settled under
         * FF_CARD_ORDER_LEDGER_V1. Checked to have the storefront shape: a
         * split payment row on the cart's collection.
         */
        async function storefrontOrder() {
          const { order, vendor, creator, collectionId } = await placeAttributedOrder()
          const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
          await pg.raw(`DELETE FROM order_attribution WHERE order_id = ?`, [order.id])
          const row = await attributionRow(order.id, vendor.id, { creator_seller_id: creator.id })

          const { data: [shape] } = await container()
            .resolve(ContainerRegistrationKeys.QUERY)
            .graph({
              entity: "order",
              fields: ["id", "split_order_payment.id", "split_order_payment.payment_collection_id"],
              filters: { id: order.id },
            })
          expect(shape.split_order_payment).toMatchObject({ payment_collection_id: collectionId })
          const splitId = shape.split_order_payment.id as string

          const payments = container().resolve(Modules.PAYMENT)
          const collection = await payments.retrievePaymentCollection(collectionId, { relations: ["payments"] })
          const payment = collection.payments[0]
          process.env[CARD] = "true"
          try {
            // Mercur's order-set subscriber captures at checkout; this is
            // for the run where it has not.
            if (!payment.captured_at) await payments.capturePayment({ payment_id: payment.id, amount: 25 })
            await card.placed(order.id)
          } finally {
            delete process.env[CARD]
          }
          await drainSubscribers()
          const [leg] = await hawala().listLedgerEntries({ idempotency_key: `order-payment-${order.id}-seller` })
          expect(leg).toMatchObject({ status: "COMPLETED", entry_type: "TRANSFER", order_id: order.id })
          expect(leg.credit_account_id).toBe((await card.sellerEarnings(vendor.id)).id)
          expect(await readCardSettlementOrder(container(), order.id)).toMatchObject({
            funding: "fbm_card",
            payment_collection_ids: [collectionId],
            captured: 25,
            refunded: 0,
            unattributed_refund: null,
            dispute_open: 0,
          })
          return { order, vendor, creator, row, splitId, collectionId, paymentId: payment.id as string }
        }

        const asAdmin = async () => {
          const secret = process.env.JWT_SECRET as string
          expect(secret).toBeTruthy()
          const [user] = await container().resolve(Modules.USER).createUsers([{ email: `admin+${uid()}@example.com` }])
          const token = jwt.sign(
            { actor_id: user.id, actor_type: "user", auth_identity_id: "", app_metadata: { user_id: user.id } },
            secret,
            { expiresIn: "1h" }
          )
          return { headers: { authorization: `Bearer ${token}` } }
        }
        /** Every leg that debits the vendor's earnings, whatever its type or status. */
        const debitsOf = async (vendorId: string) =>
          (await hawala().listLedgerEntries(
            { debit_account_id: (await card.sellerEarnings(vendorId)).id },
            { order: { created_at: "ASC" } }
          )) as Array<{
            id: string
            entry_type: string
            status: string
            amount: unknown
            reference_type: string | null
            reference_id: string | null
            order_id: string | null
            idempotency_key: string | null
          }>
        const balanceOf = async (vendorId: string) => card.cents((await card.sellerEarnings(vendorId)).balance)
        const drawnOn = (vendorId: string, what: string) =>
          `vendor ${vendorId}'s earnings were drawn on since the order was placed (${what}), ` +
          `and the commission was never carved out of what was taken`
        /** `POST /admin/hawala/transfers` off the vendor's earnings into the platform's RESERVE, as an admin. */
        const adminTransfer = async (vendorId: string, body: Record<string, unknown>) => {
          const reserve = await hawala().getOrCreateSystemAccount("RESERVE")
          return api
            .post(
              `/admin/hawala/transfers`,
              { debit_account_id: (await card.sellerEarnings(vendorId)).id, credit_account_id: reserve.id, amount: 20, ...body },
              await asAdmin()
            )
            .catch((e: any) => e.response)
        }

        it("corrects one that was not refunded; lists one refunded through Medusa's own refund, one refunded on its split row before the reconciler ran, one refunded after its legs were SETTLED, and one with an open dispute, none of which has a refund leg in the ledger", async () => {
          // Not refunded: the storefront shape alone does not list an order.
          const clean = await storefrontOrder()

          // (1) $20 of $25 through Medusa's own refund workflow, which is
          // what the admin panel's Refund button runs, with the app's own
          // `payment.refunded` subscriber and the card ledger on. The refund
          // lands on the shared collection and on no split row: the ledger
          // will not guess whose sale it was and posts nothing.
          const medusa = await storefrontOrder()
          process.env[CARD] = "true"
          await refundPaymentWorkflow(container()).run({ input: { payment_id: medusa.paymentId, amount: 20 } })
          await drainSubscribers()
          expect(await reconcileCardOrder(container(), medusa.order.id)).toEqual({ outcome: "unattributed_refund" })
          delete process.env[CARD]
          expect(await refundLegsOf(medusa.order.id)).toEqual([])
          expect(await readCardSettlementOrder(container(), medusa.order.id)).toMatchObject({
            captured: 25,
            refunded: 0,
            unattributed_refund: 20,
            refund_attribution: "gap",
          })

          // (2) $20 of $25 on the order's split row, through Mercur's own
          // split refund. It emits nothing the ledger listens for; the
          // refund waits for the reconciler job, which has not run.
          const split = await storefrontOrder()
          process.env[CARD] = "true"
          await refundSplitOrderPaymentWorkflow(container()).run({ input: { id: split.splitId, amount: 20 } })
          await drainSubscribers()
          delete process.env[CARD]
          expect(await refundLegsOf(split.order.id)).toEqual([])
          expect(await readCardSettlementOrder(container(), split.order.id)).toMatchObject({
            captured: 25,
            refunded: 20,
            unattributed_refund: null,
            refund_attribution: "complete",
          })

          // (3) The order's legs anchored SETTLED (what the settlement batch
          // does to every COMPLETED entry, simulated by the same update),
          // then $20 refunded on its split row, and the reconciler run. It
          // builds on a COMPLETED purchase leg only and posts nothing
          // (SD-109 in docs/AUDIT_DEBT.md; pinned as it is: when that is
          // fixed the outcome and the leg count here change, and the order
          // is then listed with the ledger's line as well).
          const anchored = await storefrontOrder()
          for (const leg of (await hawala().listLedgerEntries({ order_id: anchored.order.id })) as Array<{ id: string; status: string }>) {
            if (leg.status === "COMPLETED") await hawala().updateLedgerEntries({ id: leg.id, status: "SETTLED", settled_at: new Date() })
          }
          process.env[CARD] = "true"
          await refundSplitOrderPaymentWorkflow(container()).run({ input: { id: anchored.splitId, amount: 20 } })
          await drainSubscribers()
          expect(await reconcileCardOrder(container(), anchored.order.id)).toEqual({ outcome: "needs_attention" })
          delete process.env[CARD]
          expect(await refundLegsOf(anchored.order.id)).toEqual([])
          expect(await readCardSettlementOrder(container(), anchored.order.id)).toMatchObject({ captured: 25, refunded: 20 })

          // (4) A chargeback still open on the order's charge, as the Stripe
          // sync records one (`hawala_card_charge_state`; the row is written
          // here, Stripe is not called). Nothing is posted while it is open.
          const disputed = await storefrontOrder()
          await hawala().createCardChargeStates({
            stripe_charge_id: `ch_${uid()}`,
            payment_id: disputed.paymentId,
            payment_collection_id: disputed.collectionId,
            currency_code: "usd",
            amount_cents: 2500,
            dispute_open_cents: 2500,
            disputed_cents: 2500,
            synced_at: new Date(),
          })
          expect(await refundLegsOf(disputed.order.id)).toEqual([])
          expect(await readCardSettlementOrder(container(), disputed.order.id)).toMatchObject({ refunded: 0, dispute_open: 25 })

          // Every attribution is still held: nothing reversed any of them.
          const all = [clean, medusa, split, anchored, disputed]
          for (const o of all) expect((await read(o.row.id)).status).toBe(CommissionStatus.HELD)

          // Three days on, so nothing about any order's age stands in the way.
          const summary = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
          const reasons = Object.fromEntries(summary.review.map((r) => [r.order_id, r.reason]))
          expect(summary.corrected.map((c) => c.order_id)).toEqual([clean.order.id])
          expect(await read(clean.row.id)).toMatchObject({ subtotal: 2500, commission: 250, status: CommissionStatus.HELD })

          // Each of the four is listed for what its payment records show and
          // for nothing else: no other check would have kept it from being
          // corrected.
          const unposted =
            `the order's payment records show 20 refunded of 25 captured and the ledger has posted no refund leg for it ` +
            `(the reconciler has not posted it yet, or does not post it), and ${notReversed}`
          expect(why(reasons[medusa.order.id])).toBe(
            `20 was refunded on the order's payment collection ${medusa.collectionId} and is recorded on no order ` +
              `(Medusa's own refund on a storefront order, or a refund made in Stripe: the ledger posts nothing for it until ` +
              `an admin assigns it to the sellers' orders), so some or all of it may be this order's, and ${notReversed}`
          )
          expect(reasons[medusa.order.id]).toContain("from 2 to 250")
          expect(why(reasons[split.order.id])).toBe(unposted)
          expect(why(reasons[anchored.order.id])).toBe(unposted)
          expect(why(reasons[disputed.order.id])).toBe(
            `a card dispute holding 25 is open on the order's payment collection ${disputed.collectionId}: ` +
              `the ledger posts no refund for it while it is open, and a dispute lost is a refund of the order`
          )
          expect(summary.never_settled).toEqual([])
          for (const o of [medusa, split, anchored, disputed]) {
            expect(await read(o.row.id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null, status: CommissionStatus.HELD })
          }

          // (2) again once the reconciler has run: the refund is posted, a
          // delay and not a loss, and the line now names the ledger's leg
          // beside the payment records' figure.
          process.env[CARD] = "true"
          expect((await reconcileCardOrder(container(), split.order.id)).outcome).toBe("refund_posted")
          delete process.env[CARD]
          const splitEarnings = await card.sellerEarnings(split.vendor.id)
          const offVendor = (await refundLegs(split.order.id)).filter((l) => l.debit_account_id === splitEarnings.id)
          expect(offVendor.map((l) => card.cents(l.amount))).toEqual([1940])
          const later = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
          const laterReasons = Object.fromEntries(later.review.map((r) => [r.order_id, r.reason]))
          expect(later.corrected).toEqual([])
          expect(why(laterReasons[split.order.id])).toBe(
            `the order was refunded out of vendor ${split.vendor.id}'s earnings (refund leg ${offVendor[0].id} 19.4 COMPLETED) and ${notReversed}; ` +
              `the order's payment records show 20 refunded of 25 captured`
          )
        })

        it("lists one whose vendor's earnings were debited since the order by a leg of an entry type no list would name: a creator reward pool funded from the vendor's earnings, a transfer an admin makes through the manual-transfer route, a refund of another order of the vendor's; corrects one whose vendor's earnings only gained since", async () => {
          // Money came in since the order and nothing left: a second sale
          // settles to the same vendor. That lists nothing. (Another order's
          // creator commission off the same earnings is a debit like any
          // other; it has a case of its own below.)
          const clean = await storefrontOrder()
          const laterSale = await order25(clean.vendor.id)
          await settle(laterSale.id, clean.vendor.id)
          expect(await debitsOf(clean.vendor.id)).toEqual([])
          expect(await balanceOf(clean.vendor.id)).toBe(4850)

          // (1) A creator reward pool funded out of the vendor's earnings:
          // the ledger call `POST /v1/seller/programs/:id/reward-pools`
          // makes once it has stored the pool, with that route's arguments.
          // The call, not the route: it was written when the route answered
          // 400 before reaching it on a migrated database, `reward_pool`
          // having no `raw_total_cents` column until SD-63's migrations.
          const funded = await storefrontOrder()
          await hawala().fundCreatorRewardPool({
            poolId: `rpool_${uid()}`,
            funderSellerId: funded.vendor.id,
            amountCents: 2000,
            currencyCode: "USD",
          })
          const fundedDebits = await debitsOf(funded.vendor.id)
          expect(fundedDebits).toHaveLength(1)
          expect(fundedDebits[0]).toMatchObject({ entry_type: "TRANSFER", status: "COMPLETED", reference_type: "CREATOR_REWARD_POOL", order_id: null })
          expect(card.cents(fundedDebits[0].amount)).toBe(2000)
          // $24.25 came in for the order; $4.25 of it is left.
          expect(await balanceOf(funded.vendor.id)).toBe(425)

          // (2) An admin moves money off the vendor's earnings by hand,
          // through `POST /admin/hawala/transfers`, under an entry type of
          // their own wording: the route passes it to the ledger unchanged.
          const moved = await storefrontOrder()
          const manual = await adminTransfer(moved.vendor.id, {
            entry_type: "CORRECTION",
            description: "spec: an admin's manual transfer off the vendor's earnings",
          })
          expect({ status: manual.status, body: manual.status === 201 ? null : manual.data }).toEqual({ status: 201, body: null })
          const movedDebits = await debitsOf(moved.vendor.id)
          expect(movedDebits).toHaveLength(1)
          expect(movedDebits[0]).toMatchObject({ entry_type: "CORRECTION", status: "COMPLETED", reference_type: null, order_id: null })
          expect(await balanceOf(moved.vendor.id)).toBe(425)

          // (3) Another order of the vendor's, placed later, is refunded
          // $20: the seller's share comes out of the same earnings.
          const sibling = await storefrontOrder()
          const laterOrder = await order25(sibling.vendor.id)
          const laterPaid = await settle(laterOrder.id, sibling.vendor.id)
          process.env[CARD] = "true"
          await card.refund(laterPaid.paymentId, 20)
          await card.refunded(laterPaid.paymentId)
          delete process.env[CARD]
          await drainSubscribers()
          const siblingDebits = await debitsOf(sibling.vendor.id)
          expect(siblingDebits).toHaveLength(1)
          expect(siblingDebits[0]).toMatchObject({ entry_type: "REFUND", status: "COMPLETED", order_id: laterOrder.id })
          expect(card.cents(siblingDebits[0].amount)).toBe(1940)
          // The attributed order itself has no refund: not in the ledger, not on its payment records.
          expect(await refundLegsOf(sibling.order.id)).toEqual([])
          expect(await readCardSettlementOrder(container(), sibling.order.id)).toMatchObject({ refunded: 0, unattributed_refund: null })

          for (const o of [clean, funded, moved, sibling]) expect((await read(o.row.id)).status).toBe(CommissionStatus.HELD)

          const summary = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
          const reasons = Object.fromEntries(summary.review.map((r) => [r.order_id, r.reason]))
          expect(summary.corrected.map((c) => c.order_id)).toEqual([clean.order.id])
          expect(await read(clean.row.id)).toMatchObject({ subtotal: 2500, commission: 250, status: CommissionStatus.HELD })
          // Each of the three is listed for that debit and for nothing else.
          expect(why(reasons[funded.order.id])).toBe(
            drawnOn(funded.vendor.id, `TRANSFER leg for CREATOR_REWARD_POOL ${fundedDebits[0].id} COMPLETED`)
          )
          expect(reasons[funded.order.id]).toContain("from 2 to 250")
          expect(why(reasons[moved.order.id])).toBe(drawnOn(moved.vendor.id, `CORRECTION leg ${movedDebits[0].id} COMPLETED`))
          expect(why(reasons[sibling.order.id])).toBe(
            drawnOn(sibling.vendor.id, `REFUND leg of order ${laterOrder.id} ${siblingDebits[0].id} COMPLETED`)
          )
          expect(summary.never_settled).toEqual([])
          for (const o of [funded, moved, sibling]) {
            expect(await read(o.row.id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null, status: CommissionStatus.HELD })
          }
        })

        it("lists one whose vendor's earnings were debited under the creator-commission label, whoever posted the leg: an admin's manual transfer so labelled, the same with the attribution reference on it, another order's commission as approve-held posts it; corrects one whose vendor's earnings only gained since", async () => {
          // (B) The review's case: $20 off the vendor's earnings through
          // `POST /admin/hawala/transfers`, labelled CREATOR_COMMISSION. The
          // route hands the label to the ledger as it came.
          const labelled = await storefrontOrder()
          const b = await adminTransfer(labelled.vendor.id, {
            entry_type: "CREATOR_COMMISSION",
            description: "spec: an admin's manual transfer labelled CREATOR_COMMISSION",
          })
          expect({ status: b.status, body: b.status === 201 ? null : b.data }).toEqual({ status: 201, body: null })
          const labelledDebits = await debitsOf(labelled.vendor.id)
          expect(labelledDebits).toHaveLength(1)
          expect(labelledDebits[0]).toMatchObject({ entry_type: "CREATOR_COMMISSION", status: "COMPLETED", reference_type: null, order_id: null })
          // $24.25 came in for the order; $4.25 of it is left.
          expect(await balanceOf(labelled.vendor.id)).toBe(425)

          // (B2) The same transfer with every label the route lets an admin
          // choose set as approve-held's leg has them: the reference type, and
          // for a reference id the attribution row of another order of the
          // vendor's. The route takes no order id: the one sent is dropped.
          const referenced = await storefrontOrder()
          const otherOrder = await order25(referenced.vendor.id)
          const otherRow = await attributionRow(otherOrder.id, referenced.vendor.id)
          const b2 = await adminTransfer(referenced.vendor.id, {
            entry_type: "CREATOR_COMMISSION",
            reference_type: "CREATOR_ATTRIBUTION",
            reference_id: otherRow.id,
            order_id: otherOrder.id,
            description: `Creator commission for order ${otherOrder.id} (attribution ${otherRow.id})`,
          })
          expect({ status: b2.status, body: b2.status === 201 ? null : b2.data }).toEqual({ status: 201, body: null })
          const referencedDebits = await debitsOf(referenced.vendor.id)
          expect(referencedDebits).toHaveLength(1)
          expect(referencedDebits[0]).toMatchObject({
            entry_type: "CREATOR_COMMISSION",
            status: "COMPLETED",
            reference_type: "CREATOR_ATTRIBUTION",
            reference_id: otherRow.id,
            order_id: null,
          })
          expect(await balanceOf(referenced.vendor.id)).toBe(425)

          // (C) Another order's creator commission, as approve-held posts it
          // (`creditCreatorCommission`, the ledger call that job makes, here
          // in the ledger's own currency code): a later sale settles to the
          // same vendor and its commission goes to a creator out of the
          // vendor's earnings. Listed like any other debit, naming that
          // order. Whether a leg is another order's commission is a matter
          // of its labels, which `createTransfer` takes from any caller, and
          // it takes nothing of this order's only if that order's own
          // proceeds were in the same earnings, which the script does not
          // read.
          const commissioned = await storefrontOrder()
          const laterSale = await order25(commissioned.vendor.id)
          await settle(laterSale.id, commissioned.vendor.id)
          await hawala().creditCreatorCommission({
            vendorSellerId: commissioned.vendor.id,
            creatorSellerId: (await makeSeller("OtherCreator")).id,
            amountCents: 250,
            orderId: laterSale.id,
            attributionId: `oatt_${uid()}`,
          })
          const commissionedDebits = await debitsOf(commissioned.vendor.id)
          expect(commissionedDebits).toHaveLength(1)
          expect(commissionedDebits[0]).toMatchObject({
            entry_type: "CREATOR_COMMISSION",
            status: "COMPLETED",
            reference_type: "CREATOR_ATTRIBUTION",
            order_id: laterSale.id,
          })
          expect(await balanceOf(commissioned.vendor.id)).toBe(4850 - 250)

          // Money came in since the order and none left: a later sale
          // settles to the same vendor. Nothing here lists an order.
          const gained = await storefrontOrder()
          await settle((await order25(gained.vendor.id)).id, gained.vendor.id)
          expect(await debitsOf(gained.vendor.id)).toEqual([])
          expect(await balanceOf(gained.vendor.id)).toBe(4850)

          const all = [labelled, referenced, commissioned, gained]
          for (const o of all) expect((await read(o.row.id)).status).toBe(CommissionStatus.HELD)

          // A dry run first, as the review ran it, then the same with `apply`.
          const dry = await fixCreatorCommissionMinorUnits(container(), { now: afterPayoutWindow() })
          expect(dry.corrected.map((c) => c.order_id)).toEqual([gained.order.id])
          for (const o of all) expect(await read(o.row.id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null })

          const summary = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
          const reasons = Object.fromEntries(summary.review.map((r) => [r.order_id, r.reason]))
          expect(summary.corrected.map((c) => c.order_id)).toEqual([gained.order.id])
          expect(await read(gained.row.id)).toMatchObject({ subtotal: 2500, commission: 250, status: CommissionStatus.HELD })
          expect(dry.review).toEqual(summary.review)

          // Each is listed for that one leg and for nothing else.
          expect(why(reasons[labelled.order.id])).toBe(
            drawnOn(labelled.vendor.id, `CREATOR_COMMISSION leg ${labelledDebits[0].id} COMPLETED`)
          )
          expect(reasons[labelled.order.id]).toContain("from 2 to 250")
          expect(why(reasons[referenced.order.id])).toBe(
            drawnOn(referenced.vendor.id, `CREATOR_COMMISSION leg for CREATOR_ATTRIBUTION ${referencedDebits[0].id} COMPLETED`)
          )
          expect(why(reasons[commissioned.order.id])).toBe(
            drawnOn(commissioned.vendor.id, `CREATOR_COMMISSION leg of order ${laterSale.id} ${commissionedDebits[0].id} COMPLETED`)
          )
          // (B2)'s other order is an attributed order too, and never settled.
          expect(summary.never_settled).toEqual([otherOrder.id])
          for (const o of [labelled, referenced, commissioned]) {
            expect(await read(o.row.id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null, status: CommissionStatus.HELD })
          }
        })

        it("lists one that already has a ledger entry under the key approve-held credits its row with: the job's own credit landed and its row update did not (commission already taken), an admin posted one under the key by hand, the job's credit failed at the balance move; approve-held is then handed each entry back and approves the row, at the old figure because the row was left alone", async () => {
          const due = (rowId: string) => attribution().updateOrderAttributions({ id: rowId, hold_until: new Date(Date.now() - 60_000) })
          const notDue = (rowId: string) => attribution().updateOrderAttributions({ id: rowId, hold_until: new Date(Date.now() + 86_400_000) })
          const rowOf = async (rowId: string) => (await attribution().listOrderAttributions({ id: rowId }))[0]
          const underKey = async (rowId: string) =>
            (await hawala().listLedgerEntries({ idempotency_key: `creator-commission-${rowId}` })) as Array<{
              id: string
              status: string
              amount: unknown
              entry_type: string
              reference_type: string | null
              reference_id: string | null
              order_id: string | null
              debit_account_id: string
            }>
          // The creator's earnings account opened in the ledger's own "USD",
          // so the job's credit is not refused for the code alone (SD-99 (1)
          // in docs/AUDIT_DEBT.md: the job opens it in the attribution's "usd").
          const creatorEarnings = async (creatorId: string) => hawala().getOrCreateCreatorEarnings(creatorId, "USD")
          const heldUntouched = { commission_status: CommissionStatus.HELD, ledger_entry_id: null }

          // (D) The review's case, made by the job itself: approve-held
          // credits first and updates the row second, and here the row
          // update is lost. The $0.02 has moved; the row still says held.
          const taken = await storefrontOrder()
          await creatorEarnings(taken.creator.id)
          await due(taken.row.id)
          const lostUpdate = jest
            .spyOn(attribution(), "approveCommission")
            .mockRejectedValueOnce(new Error("spec: the row update was lost"))
          await approveHeldCreatorAttributionsJob(container())
          expect(lostUpdate).toHaveBeenCalledTimes(1)
          lostUpdate.mockRestore()
          await notDue(taken.row.id)
          const [credit] = await underKey(taken.row.id)
          expect(credit).toMatchObject({
            entry_type: "CREATOR_COMMISSION",
            status: "COMPLETED",
            reference_type: "CREATOR_ATTRIBUTION",
            reference_id: taken.row.id,
            order_id: taken.order.id,
            debit_account_id: (await card.sellerEarnings(taken.vendor.id)).id,
          })
          expect(card.cents(credit.amount)).toBe(2)
          expect((await debitsOf(taken.vendor.id)).map((l) => l.id)).toEqual([credit.id])
          expect(await balanceOf(taken.vendor.id)).toBe(2425 - 2)
          expect(await rowOf(taken.row.id)).toMatchObject(heldUntouched)

          // (D2) An entry under the row's key that the vendor's earnings
          // never saw: an admin pays the creator the commission by hand out
          // of another seller's earnings, through the manual-transfer route,
          // which takes an idempotency key as it takes a label.
          const byHand = await storefrontOrder()
          const bank = await makeSeller("Bank")
          await settle((await order25(bank.id)).id, bank.id)
          const paid = await adminTransfer(bank.id, {
            credit_account_id: (await creatorEarnings(byHand.creator.id)).id,
            amount: 0.02,
            entry_type: "CREATOR_COMMISSION",
            reference_type: "CREATOR_ATTRIBUTION",
            reference_id: byHand.row.id,
            idempotency_key: `creator-commission-${byHand.row.id}`,
          })
          expect({ status: paid.status, body: paid.status === 201 ? null : paid.data }).toEqual({ status: 201, body: null })
          const [handEntry] = await underKey(byHand.row.id)
          expect(handEntry).toMatchObject({ status: "COMPLETED", debit_account_id: (await card.sellerEarnings(bank.id)).id })
          expect(await debitsOf(byHand.vendor.id)).toEqual([])
          expect(await balanceOf(byHand.vendor.id)).toBe(2425)
          expect(await rowOf(byHand.row.id)).toMatchObject(heldUntouched)

          // (D3) The job's credit fails at the balance move (the balance
          // changed under it, a lost race): `createTransfer` has already
          // written the leg and marks it FAILED. Nothing moved; the entry
          // stays under the row's key.
          const failedCredit = await storefrontOrder()
          await creatorEarnings(failedCredit.creator.id)
          await due(failedCredit.row.id)
          const lostRace = jest
            .spyOn(hawala(), "updateBalancesAtomic")
            .mockRejectedValueOnce(new Error("spec: the balance moved under the transfer"))
          await approveHeldCreatorAttributionsJob(container())
          expect(lostRace).toHaveBeenCalledTimes(1)
          lostRace.mockRestore()
          await notDue(failedCredit.row.id)
          const [failedEntry] = await underKey(failedCredit.row.id)
          expect(failedEntry).toMatchObject({ entry_type: "CREATOR_COMMISSION", status: "FAILED", order_id: failedCredit.order.id })
          expect(await balanceOf(failedCredit.vendor.id)).toBe(2425)
          expect(await rowOf(failedCredit.row.id)).toMatchObject(heldUntouched)

          // No entry under its key, no debit: corrected.
          const clean = await storefrontOrder()
          expect(await underKey(clean.row.id)).toEqual([])

          const dry = await fixCreatorCommissionMinorUnits(container(), { now: afterPayoutWindow() })
          expect(dry.corrected.map((c) => c.order_id)).toEqual([clean.order.id])
          const summary = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
          const reasons = Object.fromEntries(summary.review.map((r) => [r.order_id, r.reason]))
          expect(summary.corrected.map((c) => c.order_id)).toEqual([clean.order.id])
          expect(dry.review).toEqual(summary.review)

          // Each is listed for the entry under its key and for nothing else.
          // The entry is named once: (D)'s and (D3)'s also debit the
          // vendor's earnings and are not listed again as a debit of them.
          const handedBack = (rowId: string) =>
            `is under the key approve-held credits row ${rowId} with, and the row is still held with no ledger entry recorded on it, ` +
            `so approve-held would be handed that entry back, move nothing more, and approve the row at whatever its column then says`
          expect(why(reasons[taken.order.id])).toBe(
            `commission was already taken from vendor ${taken.vendor.id} for this order: ledger entry ${credit.id} (0.02 COMPLETED) ` +
              handedBack(taken.row.id)
          )
          expect(reasons[taken.order.id]).toContain("from 2 to 250")
          expect(why(reasons[byHand.order.id])).toBe(
            `a commission credit for this order is already in the ledger: ledger entry ${handEntry.id} (0.02 COMPLETED) ` +
              handedBack(byHand.row.id)
          )
          expect(why(reasons[failedCredit.order.id])).toBe(
            `a commission credit for this order is already in the ledger: ledger entry ${failedEntry.id} (0.02 FAILED) ` +
              handedBack(failedCredit.row.id)
          )
          expect(summary.never_settled).toEqual([])
          for (const o of [taken, byHand, failedCredit]) {
            expect(await read(o.row.id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null, status: CommissionStatus.HELD })
          }

          // What those lines say approve-held would do, run: with the holds
          // ended, the job is handed each existing entry back, moves nothing,
          // and approves the row with that entry's id. (D): left at the old
          // figure, the row says 2 and the ledger moved $0.02; corrected
          // first, it would have said 250. (D2) and (D3) are approved on an
          // entry that took nothing from the vendor, and for (D3) paid the
          // creator nothing: `createTransfer` returns whatever sits under a
          // key, FAILED included, and the job does not look at its status.
          // Pinned as it is; when approve-held checks the entry it is
          // handed, the last two change.
          for (const o of [taken, byHand, failedCredit]) await due(o.row.id)
          await approveHeldCreatorAttributionsJob(container())
          expect(await rowOf(taken.row.id)).toMatchObject({ commission_status: CommissionStatus.APPROVED, ledger_entry_id: credit.id })
          expect(await read(taken.row.id)).toMatchObject({ subtotal: 25, commission: 2 })
          expect((await debitsOf(taken.vendor.id)).map((l) => l.id)).toEqual([credit.id])
          expect(await balanceOf(taken.vendor.id)).toBe(2425 - 2)
          expect(await rowOf(byHand.row.id)).toMatchObject({ commission_status: CommissionStatus.APPROVED, ledger_entry_id: handEntry.id })
          expect(await balanceOf(byHand.vendor.id)).toBe(2425)
          expect(await rowOf(failedCredit.row.id)).toMatchObject({ commission_status: CommissionStatus.APPROVED, ledger_entry_id: failedEntry.id })
          expect((await underKey(failedCredit.row.id)).map((e) => e.status)).toEqual(["FAILED"])
          expect(await balanceOf(failedCredit.vendor.id)).toBe(2425)
          expect(card.cents((await creatorEarnings(failedCredit.creator.id)).balance)).toBe(0)
        })

        it("lists one with a leg off the vendor's earnings that is still PENDING, whether its money moved (a transfer cut off before it was marked COMPLETED) or not (a leg written and never applied); corrects one with neither", async () => {
          // (1) `createTransfer` writes a leg PENDING, moves the balances in
          // one database transaction, then marks the leg COMPLETED in a
          // separate statement. Here that last statement fails, through the
          // admin's manual-transfer route: the route answers 400, the $20
          // has left the vendor's earnings, and the leg says PENDING for good.
          const cutOff = await storefrontOrder()
          const ledger = hawala()
          const realUpdate = ledger.updateLedgerEntries.bind(ledger)
          const flip = jest.spyOn(ledger, "updateLedgerEntries").mockImplementation(async (...args: any[]) => {
            if (args[0]?.status === "COMPLETED") throw new Error("spec: the connection dropped before the leg was marked COMPLETED")
            return realUpdate(...args)
          })
          const failed = await adminTransfer(cutOff.vendor.id, { entry_type: "WITHDRAWAL", description: "spec: a transfer cut off" })
          flip.mockRestore()
          expect(failed.status).toBe(400)
          const cutOffDebits = await debitsOf(cutOff.vendor.id)
          expect(cutOffDebits).toHaveLength(1)
          expect(cutOffDebits[0]).toMatchObject({ entry_type: "WITHDRAWAL", status: "PENDING" })
          expect(card.cents(cutOffDebits[0].amount)).toBe(2000)
          // The money moved: $4.25 of the order's $24.25 is left.
          expect(await balanceOf(cutOff.vendor.id)).toBe(425)

          // (2) A PENDING leg whose money did not move: the row alone, as a
          // process stopped between writing the leg and moving the balances
          // leaves it.
          const unapplied = await storefrontOrder()
          const reserve = await hawala().getOrCreateSystemAccount("RESERVE")
          const [pendingLeg] = await hawala().createLedgerEntries([
            {
              debit_account_id: (await card.sellerEarnings(unapplied.vendor.id)).id,
              credit_account_id: reserve.id,
              amount: 20,
              entry_type: "TRANSFER",
              status: "PENDING",
            },
          ])
          expect(await balanceOf(unapplied.vendor.id)).toBe(2425)

          const clean = await storefrontOrder()
          expect(await debitsOf(clean.vendor.id)).toEqual([])

          const summary = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
          const reasons = Object.fromEntries(summary.review.map((r) => [r.order_id, r.reason]))
          expect(summary.corrected.map((c) => c.order_id)).toEqual([clean.order.id])
          const unconfirmed = (vendorId: string, what: string) =>
            `vendor ${vendorId}'s earnings have a debit written since the order was placed that is neither COMPLETED nor SETTLED (${what}), ` +
            `so whether that money moved, or stayed moved, cannot be read from the ledger`
          expect(why(reasons[cutOff.order.id])).toBe(unconfirmed(cutOff.vendor.id, `withdrawal ${cutOffDebits[0].id} PENDING`))
          expect(reasons[cutOff.order.id]).toContain("from 2 to 250")
          expect(why(reasons[unapplied.order.id])).toBe(unconfirmed(unapplied.vendor.id, `TRANSFER leg ${pendingLeg.id} PENDING`))
          expect(summary.never_settled).toEqual([])
          for (const o of [cutOff, unapplied]) {
            expect(await read(o.row.id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null, status: CommissionStatus.HELD })
          }
        })

        it("lists one with a second payment collection its payment records were not read from, whether $10 was refunded there or nothing was; corrects one whose only collection is the one its split row names", async () => {
          const linkedCollections = async (orderId: string) => {
            const { data: [order] } = await container()
              .resolve(ContainerRegistrationKeys.QUERY)
              .graph({ entity: "order", fields: ["id", "subtotal", "payment_collections.id"], filters: { id: orderId } })
            return {
              subtotal: Number(order.subtotal),
              collections: ((order.payment_collections ?? []) as Array<{ id: string }>).map((c) => c.id).sort(),
            }
          }

          const clean = await storefrontOrder()
          expect(await linkedCollections(clean.order.id)).toEqual({ subtotal: 25, collections: [clean.collectionId] })

          // (1) A second collection linked to the order, $10 captured on it
          // and refunded there, with the app's card-refund subscriber. Built
          // from fixtures: Medusa adds a further collection to an order only
          // after an order change raised its total, and such a change moves
          // the subtotal, which the planner lists on its own. The subtotal
          // here is untouched, so only the payment side can list the order.
          const second = await storefrontOrder()
          process.env[CARD] = "true"
          const extra = await card.pay([second.order.id], 10, { capture: true })
          await card.refund(extra.paymentId, 10)
          await card.refunded(extra.paymentId)
          delete process.env[CARD]
          await drainSubscribers()
          const extraCollection = await container().resolve(Modules.PAYMENT).retrievePaymentCollection(extra.collectionId)
          expect({ captured: Number(extraCollection.captured_amount), refunded: Number(extraCollection.refunded_amount) }).toEqual({
            captured: 10,
            refunded: 10,
          })
          expect(await linkedCollections(second.order.id)).toEqual({
            subtotal: 25,
            collections: [second.collectionId, extra.collectionId].sort(),
          })
          // The refund is in neither place the script reads refunds from:
          // no leg in the ledger, and the payment records, read from the
          // split row's collection alone, show nothing refunded.
          expect(await refundLegsOf(second.order.id)).toEqual([])
          expect(await readCardSettlementOrder(container(), second.order.id)).toMatchObject({
            funding: "fbm_card",
            payment_collection_ids: [second.collectionId],
            captured: 25,
            refunded: 0,
            unattributed_refund: null,
            refund_attribution: "complete",
            dispute_open: 0,
          })

          // (2) A second collection with nothing refunded on it: still a
          // collection the records were not read from.
          const idle = await storefrontOrder()
          const unread = await card.pay([idle.order.id], 10, { capture: true })
          expect((await linkedCollections(idle.order.id)).collections).toEqual([idle.collectionId, unread.collectionId].sort())

          for (const o of [clean, second, idle]) expect((await read(o.row.id)).status).toBe(CommissionStatus.HELD)

          const summary = await fixCreatorCommissionMinorUnits(container(), { apply: true, now: afterPayoutWindow() })
          const reasons = Object.fromEntries(summary.review.map((r) => [r.order_id, r.reason]))
          const notRead = (collectionId: string, readFrom: string) =>
            `payment collection ${collectionId} of the order's was not read: its payment records were read from ` +
            `payment collection ${readFrom} only (a storefront order's are read from the collection its split payment row names), ` +
            `so a refund made on it is not seen`
          expect(summary.corrected.map((c) => c.order_id)).toEqual([clean.order.id])
          expect(await read(clean.row.id)).toMatchObject({ subtotal: 2500, commission: 250, status: CommissionStatus.HELD })
          // Each is listed for the unread collection and for nothing else.
          expect(why(reasons[second.order.id])).toBe(notRead(extra.collectionId, second.collectionId))
          expect(reasons[second.order.id]).toContain("from 2 to 250")
          expect(why(reasons[idle.order.id])).toBe(notRead(unread.collectionId, idle.collectionId))
          expect(summary.never_settled).toEqual([])
          for (const o of [second, idle]) {
            expect(await read(o.row.id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null, status: CommissionStatus.HELD })
          }
        })
      })

      it("writes an order's chain in one transaction: a row that changed since it was planned rolls back the rows before it", async () => {
        const vendor = await makeSeller("Chain")
        const order = await order25(vendor.id)
        const l1 = await attributionRow(order.id, vendor.id)
        const l2 = await attributionRow(order.id, vendor.id, { level: 2, level_split_percent: 20, commission_amount_cents: 0 })
        const fix = (id: string, status: string, commission: { from: number; to: number }) => ({
          id,
          status,
          from: { subtotal_cents: 25, commission_cents: commission.from },
          to: { subtotal_cents: 2500, commission_cents: commission.to },
          record: { by: "spec" },
        })

        // L2 is held; planned from pending, as if approve-held or a refund
        // had moved it after the read.
        const stale = await attribution().correctAttributionAmountsIfUnchanged([
          fix(l1.id, CommissionStatus.HELD, { from: 2, to: 200 }),
          fix(l2.id, CommissionStatus.PENDING, { from: 0, to: 50 }),
        ])
        expect(stale).toEqual({ written: false, stale_id: l2.id })
        expect(await read(l1.id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null })
        expect(await read(l2.id)).toMatchObject({ subtotal: 25, commission: 0, metadata: null })

        const ok = await attribution().correctAttributionAmountsIfUnchanged([
          fix(l1.id, CommissionStatus.HELD, { from: 2, to: 200 }),
          fix(l2.id, CommissionStatus.HELD, { from: 0, to: 50 }),
        ])
        expect(ok).toEqual({ written: true })
        expect(await read(l1.id)).toMatchObject({ subtotal: 2500, commission: 200 })
        expect(await read(l2.id)).toMatchObject({ subtotal: 2500, commission: 50 })

        // A second write of the same plan finds nothing to match (figures
        // moved, row marked) and changes nothing.
        const twice = await attribution().correctAttributionAmountsIfUnchanged([fix(l1.id, CommissionStatus.HELD, { from: 2, to: 200 })])
        expect(twice).toEqual({ written: false, stale_id: l1.id })
        expect(await read(l1.id)).toMatchObject({ subtotal: 2500, commission: 200 })
      })
    })
  },
})

import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
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
        // race, recorded in the SD-95 follow-up; the creator's credit is
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
     */
    describe("scripts/fix-creator-commission-minor-units.ts", () => {
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
      const OPERATOR_SQL_3 =
        "SELECT pr.id, pr.vendor_id, pr.net_amount, pr.status, pr.completed_at FROM hawala_payout_request pr WHERE pr.status IN ('PROCESSING','IN_TRANSIT','COMPLETED') AND pr.vendor_id IN (SELECT DISTINCT vendor_id FROM order_attribution WHERE deleted_at IS NULL AND vendor_id IS NOT NULL AND commission_status NOT IN ('reversed','disqualified'))"
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

        const dry = await fixCreatorCommissionMinorUnits(container())
        expect(dry.corrected).toEqual([
          { order_id: held.id, subtotal: { from: 25, to: 2500 }, commission_total: { from: 2, to: 250 }, rows: [heldRow.id] },
        ])
        expect(dry.review.map((r) => r.order_id)).toEqual([credited.id])
        expect(dry.review[0].reason).toContain("hle_already_credited")
        expect(dry.skipped).toEqual([{ order_id: fresh.id, reason: "marked_minor_units" }])
        expect(await read(heldRow.id)).toMatchObject({ subtotal: 25, basis: 25, commission: 2 })

        const applied = await fixCreatorCommissionMinorUnits(container(), { apply: true })
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

        const again = await fixCreatorCommissionMinorUnits(container(), { apply: true })
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

        // A stored breakdown for the corrected order still carries the old
        // creator line (breakdowns are not recomputed): SQL (4) names it, and
        // not the new order's.
        const breakdowns = container().resolve(PAYOUT_BREAKDOWN_MODULE)
        for (const [orderId, creatorLine] of [
          [held.id, 2],
          [fresh.id, 250],
        ] as const) {
          await breakdowns.createOrderPayoutBreakdowns({
            order_id: orderId,
            customer_id: "cus_breakdown",
            customer_paid: 2500,
            breakdown_items: [],
            seller_breakdown: [],
            total_to_producers: 2500 - 75 - creatorLine,
            total_platform_fees: 75,
            total_payment_processing: 0,
            total_creator_commission: creatorLine,
          })
        }
        const sql4 = await pg.raw(`SELECT q.order_id FROM (${OPERATOR_SQL_4}) q WHERE q.order_id = ANY(?)`, [
          [held.id, credited.id, fresh.id],
        ])
        expect(sql4.rows.map((r: any) => r.order_id)).toEqual([held.id])
        // (2) and (3) are read-only listings; they run.
        await pg.raw(OPERATOR_SQL_2)
        await pg.raw(OPERATOR_SQL_3)
      })

      it("lists instead of correcting a held row whose vendor was paid out after the order or did not sell it; corrects one whose vendor was paid only before it or not at all", async () => {
        // Paid out after the order: a payout request whose legs took money
        // off the vendor's earnings, and a completed withdrawal leg.
        const paidVendor = await makeSeller("Paid")
        const paidOrder = await order25(paidVendor.id)
        const paidRow = await attributionRow(paidOrder.id, paidVendor.id)
        const request = await payoutRequest(paidVendor.id, "COMPLETED")

        const withdrawnVendor = await makeSeller("Withdrawn")
        const withdrawnOrder = await order25(withdrawnVendor.id)
        const withdrawnRow = await attributionRow(withdrawnOrder.id, withdrawnVendor.id)
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

        // The creator's link named a vendor that did not sell this order.
        const seller = await makeSeller("Seller")
        const linkVendor = await makeSeller("LinkVendor")
        const splitOrder = await order25(seller.id)
        const splitRow = await attributionRow(splitOrder.id, linkVendor.id)

        // Paid out only BEFORE the order, and a payout after it that failed
        // (moved nothing): neither counts, so this one is corrected.
        const earlyVendor = await makeSeller("Early")
        await payoutRequest(earlyVendor.id, "COMPLETED")
        await new Promise((r) => setTimeout(r, 20))
        const earlyOrder = await order25(earlyVendor.id)
        const earlyRow = await attributionRow(earlyOrder.id, earlyVendor.id)
        await payoutRequest(earlyVendor.id, "FAILED")

        const summary = await fixCreatorCommissionMinorUnits(container(), { apply: true })
        const reasons = Object.fromEntries(summary.review.map((r) => [r.order_id, r.reason]))
        expect(reasons[paidOrder.id]).toContain(`payout request ${request.id} COMPLETED`)
        expect(reasons[paidOrder.id]).toContain("from 2 to 250")
        expect(reasons[withdrawnOrder.id]).toContain(`withdrawal ${withdrawal.id} COMPLETED`)
        expect(reasons[splitOrder.id]).toContain(`the attributed vendor ${linkVendor.id} is not the order's seller ${seller.id}`)
        expect(summary.corrected.map((c) => c.order_id)).toEqual([earlyOrder.id])

        for (const id of [paidRow.id, withdrawnRow.id, splitRow.id]) {
          expect(await read(id)).toMatchObject({ subtotal: 25, commission: 2, metadata: null })
        }
        expect(await read(earlyRow.id)).toMatchObject({ subtotal: 2500, commission: 250 })
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

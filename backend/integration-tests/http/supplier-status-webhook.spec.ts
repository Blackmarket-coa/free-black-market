import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { SUPPLIER_FORWARDING_MODULE } from "../../src/modules/supplier-forwarding"
import type SupplierForwardingModuleService from "../../src/modules/supplier-forwarding/service"
import { ManualFulfillmentStatus, SupplierContactMethod } from "../../src/modules/supplier-forwarding/models"
import {
  SUPPLIER_WEBHOOK_SECRET_ENV,
  SUPPLIER_WEBHOOK_SIGNATURE_HEADER,
  signSupplierWebhookBody,
  supplierWebhookKey,
} from "../../src/modules/supplier-forwarding/webhook-auth"

jest.setTimeout(120 * 1000)

/**
 * `POST /webhooks/suppliers/status` on the real server and a real migrated
 * database: Medusa's ApiLoader mounting `src/api/middlewares.ts` (raw-body
 * preservation, the supplier limiter) and the route, and the real
 * supplier-forwarding module. Orders reach suppliers the way the
 * `order.placed` subscriber sends them, through `forwardOrder`: a MANUAL
 * supplier gets a forwarding attempt and a PENDING manual-fulfillment row, an
 * EMAIL supplier a forwarding attempt (no mail is sent; email delivery is
 * still open work).
 *
 * The unit specs (route.unit.spec.ts, supplier-webhook-middleware.unit.spec.ts)
 * cover every refusal in isolation; this proves the same doors on the
 * assembled app and that only the correctly signed, valid update is persisted.
 */

const SECRET = "supplier-webhook-integration-secret-0123456789abcdef"
const ACME = "sup_acme"
const BOLT = "sup_bolt"
const ORDER_ACME = "order_01INTEGACME"
const ORDER_BOLT = "order_01INTEGBOLT"

medusaIntegrationTestRunner({
  inApp: true,
  env: { [SUPPLIER_WEBHOOK_SECRET_ENV]: SECRET },
  testSuite: ({ api, getContainer }) => {
    const service = () => getContainer().resolve<SupplierForwardingModuleService>(SUPPLIER_FORWARDING_MODULE)

    // The runner resets the database between tests, so each test seeds.
    async function seed() {
      const s = service()
      await s.createSupplierProfiles([
        { supplier_id: ACME, display_name: "Acme", contact_method: SupplierContactMethod.MANUAL },
        { supplier_id: BOLT, display_name: "Bolt", contact_method: SupplierContactMethod.EMAIL, contact_email: "orders@bolt.example" },
      ])
      await s.forwardOrder({ id: ORDER_ACME, email: "shopper@example.com", metadata: { supplier_id: ACME }, items: [] })
      await s.forwardOrder({ id: ORDER_BOLT, email: "shopper@example.com", metadata: { supplier_id: BOLT }, items: [] })
    }

    async function post(payload: Record<string, unknown>, signer: string | null | { signature: string }) {
      const raw = Buffer.from(JSON.stringify(payload), "utf8")
      const headers: Record<string, string> = { "content-type": "application/json" }
      if (signer && typeof signer === "object") headers[SUPPLIER_WEBHOOK_SIGNATURE_HEADER] = signer.signature
      else if (typeof signer === "string") {
        headers[SUPPLIER_WEBHOOK_SIGNATURE_HEADER] = signSupplierWebhookBody(supplierWebhookKey(SECRET, signer), raw)
      }
      return api
        .post("/webhooks/suppliers/status", raw, { headers })
        .catch((e: { response: { status: number; data: Record<string, unknown> } }) => e.response)
    }

    const supplierRows = async () =>
      (await service().listManualFulfillmentUpdates({ source: "supplier_webhook" })) as Array<{
        order_id: string
        supplier_id: string
        status: string
      }>

    it("refuses unsigned, forged, wrong-supplier and invalid-transition updates, and persists the one valid update", async () => {
      await seed()

      const unsigned = await post({ order_id: ORDER_ACME, supplier_id: ACME, status: "delivered" }, null)
      expect(unsigned.status).toBe(401)

      const forged = await post(
        { order_id: ORDER_ACME, supplier_id: ACME, status: "delivered" },
        { signature: "f".repeat(64) }
      )
      expect(forged.status).toBe(401)

      // Bolt's real key cannot speak for Acme...
      const impersonation = await post({ order_id: ORDER_ACME, supplier_id: ACME, status: "canceled" }, BOLT)
      expect(impersonation.status).toBe(401)
      // ...and speaking as Bolt reaches only orders forwarded to Bolt.
      const wrongSupplier = await post({ order_id: ORDER_ACME, supplier_id: BOLT, status: "acknowledged" }, BOLT)
      expect(wrongSupplier.status).toBe(403)
      expect(wrongSupplier.data).toMatchObject({ type: "not_allowed" })

      // forwardOrder left Acme's order PENDING; shipped skips two steps.
      const skipped = await post({ order_id: ORDER_ACME, supplier_id: ACME, status: "shipped" }, ACME)
      expect(skipped.status).toBe(409)
      expect(skipped.data).toMatchObject({ type: "invalid_transition", current_status: "pending" })

      expect(await supplierRows()).toEqual([])

      const ok = await post(
        { order_id: ORDER_ACME, supplier_id: ACME, status: "acknowledged", notes: "Seen" },
        ACME
      )
      expect(ok.status).toBe(200)
      expect(ok.data).toMatchObject({ received: true })

      const bolt = await post({ order_id: ORDER_BOLT, supplier_id: BOLT, status: "acknowledged" }, BOLT)
      expect(bolt.status).toBe(200)

      const rows = await supplierRows()
      expect(rows.map((r) => [r.order_id, r.supplier_id, r.status]).sort()).toEqual(
        [
          [ORDER_ACME, ACME, ManualFulfillmentStatus.ACKNOWLEDGED],
          [ORDER_BOLT, BOLT, ManualFulfillmentStatus.ACKNOWLEDGED],
        ].sort()
      )
    })

    it("a deactivated supplier is refused on its own order", async () => {
      await seed()
      const [acme] = await service().listSupplierProfiles({ supplier_id: ACME })
      await service().updateSupplierProfiles({ id: acme.id, is_active: false })

      const res = await post({ order_id: ORDER_ACME, supplier_id: ACME, status: "acknowledged" }, ACME)
      expect(res.status).toBe(403)
      expect(await supplierRows()).toEqual([])
    })

    it("is closed (503) while SUPPLIER_WEBHOOK_SECRET is unset", async () => {
      await seed()
      const saved = process.env[SUPPLIER_WEBHOOK_SECRET_ENV]
      delete process.env[SUPPLIER_WEBHOOK_SECRET_ENV]
      try {
        const res = await post({ order_id: ORDER_ACME, supplier_id: ACME, status: "acknowledged" }, ACME)
        expect(res.status).toBe(503)
      } finally {
        process.env[SUPPLIER_WEBHOOK_SECRET_ENV] = saved
      }
      expect(await supplierRows()).toEqual([])
    })
  },
})

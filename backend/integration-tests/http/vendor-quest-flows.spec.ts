import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createAuthenticatedSeller,
  authHeader,
  safe,
  AuthenticatedSeller,
} from "./helpers/seller-auth"

// Boot (~45-55s) + seller bootstrap need headroom.
jest.setTimeout(120 * 1000)

/**
 * The vendor-rules module ships a migration only for `wholesale_application`;
 * its `vendor_customer_tier` table is created via `medusa db:generate` in real
 * deployments and is therefore absent in a bare test DB. Our per-channel pricing
 * routes reuse that pre-existing table, so ensure it exists (mirrors how
 * ensureStoreInfra seeds sales channels / shipping profiles that a fresh DB
 * lacks). This is test-only setup for a pre-existing dependency, not a schema
 * owned by the quest engine.
 */
async function ensureVendorCustomerTierTable(container: any): Promise<void> {
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  await pg.raw(`
    CREATE TABLE IF NOT EXISTS "vendor_customer_tier" (
      "id" TEXT NOT NULL,
      "seller_id" TEXT NOT NULL,
      "tier_type" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT NULL,
      "discount_percent" INTEGER NOT NULL DEFAULT 0,
      "waive_order_minimum" BOOLEAN NOT NULL DEFAULT false,
      "priority_fulfillment" BOOLEAN NOT NULL DEFAULT false,
      "payment_terms_days" INTEGER NOT NULL DEFAULT 0,
      "free_delivery_threshold" INTEGER NOT NULL DEFAULT 0,
      "min_monthly_order" INTEGER NOT NULL DEFAULT 0,
      "requires_application" BOOLEAN NOT NULL DEFAULT false,
      "customer_ids" JSONB NULL,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "metadata" JSONB NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "deleted_at" TIMESTAMPTZ NULL,
      CONSTRAINT "vendor_customer_tier_pkey" PRIMARY KEY ("id")
    );
  `)
}

/**
 * End-to-end HTTP coverage for the Vendor Quest engine and its opt-in modules.
 *
 * Runs the real seller-auth path through our /vendor/* routes with the engine's
 * feature flags enabled. All requests run inside a SINGLE test on purpose — the
 * in-app server closes idle keep-alive sockets between separate it() blocks,
 * which surfaces as intermittent "Connection is closed" errors.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {
    FF_VENDOR_QUESTS_V1: "true",
    FF_PRODUCTION_LEDGER_V1: "true",
    FF_DOCUMENT_VAULT_V1: "true",
    FF_NURSERY_VERTICAL_V1: "true",
  },
  testSuite: ({ api, getContainer }) => {
    describe("Vendor Quest engine flows", () => {
      let ctx: AuthenticatedSeller

      beforeAll(async () => {
        await ensureVendorCustomerTierTable(getContainer())
        ctx = await createAuthenticatedSeller({ api, getContainer })
      })

      it("drives catalog, enrollment, opt-in modules, packet gating, and collective consent", async () => {
        const h = authHeader(ctx.token)

        // ── Auth gate ──────────────────────────────────────────────────────
        const noAuth = await safe(api.get("/vendor/quests"))
        expect(noAuth.status).toBe(401)

        // ── Catalog: all 13 quests, config-only, before any opt-in ─────────
        const catalog = await safe(api.get("/vendor/quests", h))
        expect(catalog.status).toBe(200)
        expect(catalog.data.count).toBe(13)
        const keys = catalog.data.quests.map((q: any) => q.key)
        expect(keys).toContain("fsa-farm-loan")
        expect(keys).toContain("coop-formation")
        // Requirements are tagged for the "what it needs" surface.
        const fsa = catalog.data.quests.find((q: any) => q.key === "fsa-farm-loan")
        expect(fsa.requirements.some((r: any) => r.tag === "outside-fbm")).toBe(true)

        // ── No quests enrolled initially ───────────────────────────────────
        const empty = await safe(api.get("/vendor/quests/enrollments", h))
        expect(empty.status).toBe(200)
        expect(empty.data.enrollments).toHaveLength(0)

        // ── Enroll in FSA (opt-in, never auto) ─────────────────────────────
        const enroll = await safe(
          api.post("/vendor/quests/enrollments", { quest_key: "fsa-farm-loan" }, h)
        )
        expect(enroll.status).toBe(201)
        const enrollmentId = enroll.data.enrollment.id
        expect(enroll.data.enrollment.status).toBe("ACTIVE")

        // Idempotent: enrolling again returns the same active enrollment.
        const enrollAgain = await safe(
          api.post("/vendor/quests/enrollments", { quest_key: "fsa-farm-loan" }, h)
        )
        expect(enrollAgain.status).toBe(201)
        expect(enrollAgain.data.enrollment.id).toBe(enrollmentId)

        // ── Enrollment carries a live evaluation with 3 FSA stages ─────────
        const withEval = await safe(api.get("/vendor/quests/enrollments", h))
        expect(withEval.status).toBe(200)
        const fsaEnrollment = withEval.data.enrollments.find(
          (e: any) => e.enrollment.quest_key === "fsa-farm-loan"
        )
        expect(fsaEnrollment.evaluation.stages).toHaveLength(3)
        // A brand-new seller has no ledger revenue, so no gate is open yet.
        expect(fsaEnrollment.evaluation.current_stage_index).toBe(0)
        expect(fsaEnrollment.evaluation.packet_available).toBe(false)

        // ── Packet is gated until the final stage opens ────────────────────
        const packetTooEarly = await safe(
          api.post(`/vendor/quests/enrollments/${enrollmentId}/packet`, {}, h)
        )
        expect(packetTooEarly.status).toBe(400)

        // ── Opt-in document vault (independently adoptable) ────────────────
        const createDoc = await safe(
          api.post("/vendor/vault", { label: "Land lease 2026", doc_type: "lease" }, h)
        )
        expect(createDoc.status).toBe(201)
        const docId = createDoc.data.document.id
        expect(createDoc.data.document.verified).toBe(false) // never auto-verified

        // ── Drop the quest — substrate records MUST survive ────────────────
        const drop = await safe(
          api.delete(`/vendor/quests/enrollments/${enrollmentId}`, h)
        )
        expect(drop.status).toBe(200)
        expect(drop.data.enrollment.status).toBe("DROPPED")

        const vaultAfterDrop = await safe(api.get("/vendor/vault", h))
        expect(vaultAfterDrop.status).toBe(200)
        expect(vaultAfterDrop.data.documents.some((d: any) => d.id === docId)).toBe(true)

        // ── Opt-in production ledger ───────────────────────────────────────
        const batch = await safe(
          api.post(
            "/vendor/production-batches",
            { item_label: "Elderberry liners", method: "cutting", qty_started: 200, source: "own" },
            h
          )
        )
        expect(batch.status).toBe(201)
        const batches = await safe(api.get("/vendor/production-batches", h))
        expect(batches.data.production_batches).toHaveLength(1)

        // ── Nursery listing attributes (upsert) ────────────────────────────
        const upsert = await safe(
          api.post(
            "/vendor/nursery/products",
            { product_id: "prod_test_123", subtype: "live_plant_1gal", hardiness_zone: "7a-9b" },
            h
          )
        )
        expect(upsert.status).toBe(201)
        expect(upsert.data.attribute.product_id).toBe("prod_test_123")
        const upsert2 = await safe(
          api.post(
            "/vendor/nursery/products",
            { product_id: "prod_test_123", subtype: "live_plant_3gal" },
            h
          )
        )
        expect(upsert2.status).toBe(201)
        // Upsert, not duplicate — same row updated.
        expect(upsert2.data.attribute.id).toBe(upsert.data.attribute.id)
        expect(upsert2.data.attribute.subtype).toBe("live_plant_3gal")

        // ── Per-channel wholesale pricing, end-to-end via vendor_customer_tier
        const channel = await safe(
          api.post(
            "/vendor/nursery/channels",
            { channel: "apothecary", discountPercent: 20, paymentTermsDays: 30 },
            h
          )
        )
        expect(channel.status).toBe(201)
        const channels = await safe(api.get("/vendor/nursery/channels", h))
        expect(channels.status).toBe(200)
        expect(channels.data.tiers.some((t: any) => t.discount_percent === 20)).toBe(true)

        // ── Profit-per-sqft (usable with no quest enrolled) ────────────────
        const pps = await safe(
          api.post(
            "/vendor/nursery/profit-per-sqft",
            {
              rows: [
                { label: "fast", sellPrice: 10, costToProduce: 3, footprintSqFtPerUnit: 0.5, weeksToSell: 13 },
                { label: "slow", sellPrice: 10, costToProduce: 3, footprintSqFtPerUnit: 0.5, weeksToSell: 52 },
              ],
            },
            h
          )
        )
        expect(pps.status).toBe(200)
        expect(pps.data.ranking[0].label).toBe("fast") // ranked by annual profit/sqft

        // ── Collective quest: form → consent → aggregate over consenting only
        const form = await safe(
          api.post(
            "/vendor/quests/collective",
            { quest_key: "coop-formation", title: "Piedmont Growers Co-op" },
            h
          )
        )
        expect(form.status).toBe(201)
        const collectiveId = form.data.collective.id

        // Before consent: no members are aggregated (never aggregate un-consented data).
        const beforeConsent = await safe(
          api.get(`/vendor/quests/collective/${collectiveId}`, h)
        )
        expect(beforeConsent.status).toBe(200)
        expect(beforeConsent.data.consented_member_ids).toHaveLength(0)

        // Owner (auto-joined) records scoped consent.
        const consent = await safe(
          api.post(
            `/vendor/quests/collective/${collectiveId}/consent`,
            { scopes: ["revenue", "operating", "customers", "reputation", "documents"] },
            h
          )
        )
        expect(consent.status).toBe(201)

        const afterConsent = await safe(
          api.get(`/vendor/quests/collective/${collectiveId}`, h)
        )
        expect(afterConsent.data.consented_member_ids).toHaveLength(1)
        // Evaluation now runs on the aggregate (1 member → co-op gate still closed).
        expect(afterConsent.data.evaluation.stages.length).toBeGreaterThan(0)
        expect(afterConsent.data.evaluation.current_stage_index).toBe(0)

        // Revoke → excluded from aggregation again.
        const revoke = await safe(
          api.delete(`/vendor/quests/collective/${collectiveId}/consent`, h)
        )
        expect(revoke.status).toBe(200)
        const afterRevoke = await safe(
          api.get(`/vendor/quests/collective/${collectiveId}`, h)
        )
        expect(afterRevoke.data.consented_member_ids).toHaveLength(0)
      })
    })
  },
})

import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { PARTNER_DIRECTORY_MODULE } from ".."
import PartnerDirectoryModuleService from "../service"
import { PartnerOrg } from "../models"

/**
 * Real-Postgres coverage for `partner_org`.
 *
 * What a stubbed repository cannot show: that the database applies the
 * defaults (`published = false`, `verification_status = 'unverified'`), that
 * the unique key is enforced as a constraint rather than by the service's
 * pre-check alone, and that the verification columns the service strips are
 * genuinely absent from the row that comes back.
 *
 * Requires a database — run with:
 *   TEST_TYPE=integration:modules pnpm test:integration:modules \
 *     src/modules/partner-directory/__tests__/partner-org.integration.spec.ts
 *
 * Intentionally NOT a *.unit.spec.ts so the DB-less unit suite skips it. The
 * runner builds the schema from `moduleModels`; the hand-written migration's
 * shape is pinned separately in `partner-org-migration.unit.spec.ts`.
 */
moduleIntegrationTestRunner<PartnerDirectoryModuleService>({
  moduleName: PARTNER_DIRECTORY_MODULE,
  resolve: "./src/modules/partner-directory",
  moduleModels: [PartnerOrg],
  testSuite: ({ service }) => {
    const unique = () => Math.random().toString(36).slice(2, 8)

    describe("partner_org on a real database", () => {
      it("creates with published=false and verification_status=unverified from column defaults", async () => {
        const key = `org_${unique()}`
        const created = await service.createOrg({ key, name: "Default Org" })
        expect(created.published).toBe(false)
        expect(created.verification_status).toBe("unverified")
        expect(created.relationship).toBe("standalone")
        expect(created.org_type).toBeNull()
        expect(created.ein).toBeNull()
        expect(created.stripe_connect_account_id).toBeNull()
        expect(created.states).toEqual([])
        expect(created.serves).toEqual([])

        const read = await service.getOrgByKey(key)
        expect(read?.id).toBe(created.id)
        expect(read?.published).toBe(false)
      })

      it("enforces the unique key at the database, not only in the service pre-check", async () => {
        const key = `org_${unique()}`
        await service.createPartnerOrgs({ key, name: "First" })
        await expect(service.createPartnerOrgs({ key, name: "Second" })).rejects.toBeDefined()
        const rows = await service.listPartnerOrgs({ key })
        expect(rows).toHaveLength(1)
      })

      it("strips verification columns from an operator write and normalises the EIN", async () => {
        const key = `org_${unique()}`
        const created = await service.createOrg({
          key,
          name: "Typed Status",
          org_type: "irs_501c3",
          ein: "12-3456789",
          // Not in the input type; cast to prove the runtime strip, not the compiler.
          ...({ verification_status: "pub78_eligible", verified_as_of: new Date() } as Record<string, unknown>),
        })
        expect(created.verification_status).toBe("unverified")
        expect(created.verified_as_of).toBeNull()
        expect(created.ein).toBe("123456789")

        const updated = await service.updateOrg(key, {
          name: "Still Typed",
          ...({ verification_status: "revoked" } as Record<string, unknown>),
        })
        expect(updated.name).toBe("Still Typed")
        expect(updated.verification_status).toBe("unverified")
      })

      it("refuses to publish an unverified 501c3 and publishes once the ingest writes an affirmed status", async () => {
        const key = `org_${unique()}`
        await service.createOrg({ key, name: "Pending Verification", org_type: "irs_501c3" })

        await expect(service.updateOrg(key, { published: true })).rejects.toThrow(/L11|verification_status/)
        expect((await service.getOrgByKey(key))?.published).toBe(false)

        // The ingest path (S8) writes through the generated update, not updateOrg.
        const row = await service.getOrgByKey(key)
        await service.updatePartnerOrgs({
          id: row!.id,
          verification_status: "pub78_eligible",
          verification_source: "irs_bulk_file",
          verified_as_of: new Date("2026-09-01T00:00:00Z"),
          verification_checked_at: new Date(),
        })

        const published = await service.updateOrg(key, { published: true })
        expect(published.published).toBe(true)
        expect(published.verified_as_of?.toISOString()).toBe("2026-09-01T00:00:00.000Z")
      })

      it("listPublishedOrgs returns only published rows", async () => {
        const hidden = `org_${unique()}`
        const shown = `org_${unique()}`
        await service.createOrg({ key: hidden, name: "Hidden", org_type: "coop" })
        await service.createOrg({ key: shown, name: "Shown", org_type: "coop" })
        await service.updateOrg(shown, { published: true }, { publish_unverified_ack: true })

        const keys = (await service.listPublishedOrgs()).map((o) => o.key)
        expect(keys).toContain(shown)
        expect(keys).not.toContain(hidden)
      })

      it("fiscal_host_key must reference an existing org and survives the round trip", async () => {
        const host = `host_${unique()}`
        const collective = `coll_${unique()}`
        await service.createOrg({ key: host, name: "Host", org_type: "irs_501c3", relationship: "fiscal_host" })
        await expect(
          service.createOrg({ key: collective, name: "Collective", relationship: "sponsored_collective", fiscal_host_key: "ghost" })
        ).rejects.toThrow(/does not name an existing partner org/)
        const created = await service.createOrg({
          key: collective,
          name: "Collective",
          relationship: "sponsored_collective",
          fiscal_host_key: host,
        })
        expect(created.fiscal_host_key).toBe(host)
      })
    })
  },
})

import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { SELLER_EXTENSION_MODULE } from "../../src/modules/seller-extension"
import {
  createSellerMetadataRecord,
  listSellerMetadataRecords,
} from "../../src/modules/seller-extension/metadata-service"
import { unionFeatureKeys } from "../../src/modules/playbook"
import seedPlaybooks from "../../src/scripts/seed-playbooks"
import { authHeader, createAuthenticatedSeller, safe } from "./helpers/seller-auth"

jest.setTimeout(240 * 1000)

/**
 * `POST /vendor/playbook/assign` keeps a multi-role seller's features in
 * `seller_metadata.enabled_extensions` (SD-141), on the real server and a real
 * migrated database.
 *
 * The route read the seller's row with `listSellerMetadatas`, the name the
 * generated types declare. The module has no such method: Medusa's runtime
 * pluralize leaves "SellerMetadata" as it is, so it has `listSellerMetadata`.
 * The call threw a TypeError, the route logged it as a warning and answered
 * 200, and the union of the roles' features was never written. Its unit spec
 * passed because its double mocked the plural name.
 *
 * Spends 2 of the auth limiter's 20 a minute (the seller's register and login).
 */

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const container = () => getContainer() as any
    const sellerExtension = () => container().resolve(SELLER_EXTENSION_MODULE)

    it("the module has the singular method names, not the plural ones its types declare", () => {
      const service = sellerExtension()
      for (const name of ["listSellerMetadata", "createSellerMetadata", "updateSellerMetadata", "deleteSellerMetadata"]) {
        expect({ name, type: typeof service[name] }).toEqual({ name, type: "function" })
      }
      for (const name of ["listSellerMetadatas", "createSellerMetadatas", "updateSellerMetadatas", "deleteSellerMetadatas"]) {
        expect({ name, type: typeof service[name] }).toEqual({ name, type: "undefined" })
      }
    })

    it("a multi-role assignment writes the union of the roles' features to the seller's metadata", async () => {
      // The registry the assign workflow reads, as `medusa exec seed-playbooks` fills it.
      await seedPlaybooks({ container: container(), args: [] } as any)
      const seller = await createAuthenticatedSeller({ api, getContainer })
      await createSellerMetadataRecord(sellerExtension(), { seller_id: seller.seller.id, vendor_type: "general" })
      const [before] = await listSellerMetadataRecords(sellerExtension(), { seller_id: seller.seller.id })
      expect(before.enabled_extensions).toBeNull()

      const assigned = await safe(
        api.post("/vendor/playbook/assign", { recipe_id: "stall", roles: ["stall", "kitchen"] }, authHeader(seller.token))
      )
      expect(assigned.status).toBe(200)
      expect(assigned.data.playbook_assignment).toMatchObject({ seller_id: seller.seller.id, recipe_id: "stall" })

      const [after] = await listSellerMetadataRecords(sellerExtension(), { seller_id: seller.seller.id })
      expect(after.enabled_extensions).toEqual(unionFeatureKeys(["stall", "kitchen"]))
      // Kitchen's own feature, which stall's defaults do not have.
      expect(after.enabled_extensions).toContain("hasMenu")
    })
  },
})

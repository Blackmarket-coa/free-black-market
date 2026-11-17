import PlaybookModule from "../index"
import ListingTypeModule from "../../listing-type"
import seedPlaybookRegistry, { PLAYBOOK_MODEL_SERVICE_KEY } from "../loaders/seed-registry"
import seedListingTypeRegistry, {
  LISTING_TYPE_MODEL_SERVICE_KEY,
} from "../../listing-type/loaders/seed-registry"
import { PLAYBOOK_IDS, PLAYBOOK_RECIPES } from "../recipes"
import { playbookRegistryRow } from "../registry"
import { LISTING_TYPE_IDS } from "../../listing-type/catalog"
import type { MedusaContainer } from "@medusajs/framework/types"

/**
 * The registries are seeded by module loaders, which Medusa runs when it loads
 * the module. The project's `src/loaders/` directory is not loaded by Medusa
 * 2.14 at all, so a seed placed there would never run.
 */
describe("registry seed loaders", () => {
  const containerWith = (key: string, service: unknown) =>
    ({
      resolve: (name: string) => {
        if (name === key) return service
        throw new Error(`unexpected resolve(${name})`)
      },
    }) as unknown as MedusaContainer
  const logger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })

  it("the playbook and listing-type modules declare their seed loaders", () => {
    expect(PlaybookModule.loaders).toContain(seedPlaybookRegistry)
    expect(ListingTypeModule.loaders).toContain(seedListingTypeRegistry)
  })

  it("the playbook loader inserts every recipe's row into an empty registry", async () => {
    const service = { list: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue([]) }

    await seedPlaybookRegistry({ container: containerWith(PLAYBOOK_MODEL_SERVICE_KEY, service), logger: logger() as any })

    expect(service.list).toHaveBeenCalledWith({ recipe_id: PLAYBOOK_IDS }, { withDeleted: true })
    const created = service.create.mock.calls[0][0]
    expect(created.map((row: { recipe_id: string }) => row.recipe_id)).toEqual(PLAYBOOK_IDS)
    expect(created).toContainEqual(playbookRegistryRow(PLAYBOOK_RECIPES.service))
    expect(PLAYBOOK_IDS).toHaveLength(11)
  })

  it("the listing-type loader inserts every catalog entry's row into an empty registry", async () => {
    const service = { list: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue([]) }

    await seedListingTypeRegistry({ container: containerWith(LISTING_TYPE_MODEL_SERVICE_KEY, service), logger: logger() as any })

    const created = service.create.mock.calls[0][0]
    expect(created.map((row: { catalog_id: string }) => row.catalog_id)).toEqual(LISTING_TYPE_IDS)
  })

  it("a loader that cannot find its model service logs and returns: boot goes on", async () => {
    const log = logger()

    await expect(
      seedPlaybookRegistry({ container: containerWith("somethingElse", {}), logger: log as any })
    ).resolves.toBeUndefined()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(`no "${PLAYBOOK_MODEL_SERVICE_KEY}"`))
  })
})

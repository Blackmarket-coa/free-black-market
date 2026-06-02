import { MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import {
  resolveListingTypeId,
  assertListingTypeAllowed,
} from "../listing-type-guard"
import { PLAYBOOK_MODULE } from "../../modules/playbook"
import { LISTING_TYPE_MODULE } from "../../modules/listing-type"

type PlaybookStub = {
  listPlaybookAssignments: jest.Mock
  isListingTypeAllowed: jest.Mock
  getRecipe: jest.Mock
}
type ListingTypeStub = { getDefinition: jest.Mock }

function buildContainer(opts: {
  playbook?: Partial<PlaybookStub>
  listingType?: Partial<ListingTypeStub>
}): MedusaContainer {
  const playbook: PlaybookStub = {
    listPlaybookAssignments: jest.fn().mockResolvedValue([]),
    isListingTypeAllowed: jest.fn().mockReturnValue(true),
    getRecipe: jest.fn().mockReturnValue({
      display_name: "Maker",
      allowed_listing_types: ["physical_product", "digital_product"],
    }),
    ...opts.playbook,
  }
  const listingType: ListingTypeStub = {
    getDefinition: jest.fn().mockReturnValue({ id: "physical_product" }),
    ...opts.listingType,
  }
  return {
    resolve: (key: string) => {
      if (key === PLAYBOOK_MODULE) return playbook
      if (key === LISTING_TYPE_MODULE) return listingType
      throw new Error(`unexpected resolve(${key})`)
    },
  } as unknown as MedusaContainer
}

describe("resolveListingTypeId", () => {
  it("defaults to physical_product when absent", () => {
    expect(resolveListingTypeId(undefined)).toEqual("physical_product")
    expect(resolveListingTypeId({})).toEqual("physical_product")
  })

  it("prefers listing_type_id over the fbm_listing_type alias", () => {
    expect(
      resolveListingTypeId({
        listing_type_id: "digital_product",
        fbm_listing_type: "physical_product",
      })
    ).toEqual("digital_product")
  })

  it("falls back to the fbm_listing_type alias", () => {
    expect(resolveListingTypeId({ fbm_listing_type: "service" })).toEqual(
      "service"
    )
  })
})

describe("assertListingTypeAllowed", () => {
  it("no-ops when no seller id is present", async () => {
    const container = buildContainer({})
    await expect(
      assertListingTypeAllowed(container, { sellerId: undefined })
    ).resolves.toBeUndefined()
  })

  it("no-ops for a legacy seller with no playbook assignment", async () => {
    const container = buildContainer({
      playbook: { listPlaybookAssignments: jest.fn().mockResolvedValue([]) },
    })
    await expect(
      assertListingTypeAllowed(container, {
        sellerId: "sel_1",
        additionalData: { listing_type_id: "digital_product" },
      })
    ).resolves.toBeUndefined()
  })

  it("passes for an allowed playbook × listing-type combination", async () => {
    const container = buildContainer({
      playbook: {
        listPlaybookAssignments: jest
          .fn()
          .mockResolvedValue([{ recipe_id: "maker" }]),
        isListingTypeAllowed: jest.fn().mockReturnValue(true),
      },
    })
    await expect(
      assertListingTypeAllowed(container, {
        sellerId: "sel_1",
        additionalData: { listing_type_id: "physical_product" },
      })
    ).resolves.toBeUndefined()
  })

  it("throws INVALID_DATA for a disallowed listing type", async () => {
    const container = buildContainer({
      playbook: {
        listPlaybookAssignments: jest
          .fn()
          .mockResolvedValue([{ recipe_id: "maker" }]),
        isListingTypeAllowed: jest.fn().mockReturnValue(false),
      },
    })
    await expect(
      assertListingTypeAllowed(container, {
        sellerId: "sel_1",
        additionalData: { listing_type_id: "event_ticket" },
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })
  })

  it("throws INVALID_DATA when the listing-type id is not in the catalog", async () => {
    const container = buildContainer({
      playbook: {
        listPlaybookAssignments: jest
          .fn()
          .mockResolvedValue([{ recipe_id: "maker" }]),
        isListingTypeAllowed: jest.fn().mockReturnValue(true),
      },
      listingType: {
        getDefinition: jest.fn().mockImplementation(() => {
          throw new Error("unknown")
        }),
      },
    })
    await expect(
      assertListingTypeAllowed(container, {
        sellerId: "sel_1",
        additionalData: { listing_type_id: "not_a_real_type" },
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })
  })
})

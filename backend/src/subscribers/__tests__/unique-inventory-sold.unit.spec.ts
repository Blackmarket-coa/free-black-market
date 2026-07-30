import { Modules } from "@medusajs/framework/utils"
import handler from "../unique-inventory-sold"
import {
  planUniqueInventorySaleUpdates,
  UNIQUE_INVENTORY_CATALOG_ID,
} from "../../lib/unique-inventory-sale"

const uniqueProduct = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  status: "published",
  metadata: null,
  listing_type: { catalog_id: UNIQUE_INVENTORY_CATALOG_ID },
  ...overrides,
})

describe("planUniqueInventorySaleUpdates", () => {
  it("retires a sold unique-inventory product: draft + sold stamp + order id", () => {
    const updates = planUniqueInventorySaleUpdates({
      items: [{ product_id: "prod_1", variant_id: "var_1" }],
      products: [uniqueProduct("prod_1")],
      order_id: "order_1",
    })
    expect(updates).toEqual([
      {
        product_id: "prod_1",
        variant_ids: ["var_1"],
        product_update: {
          id: "prod_1",
          status: "draft",
          metadata: {
            unique_inventory_sold: true,
            unique_inventory_sold_order_id: "order_1",
          },
        },
      },
    ])
  })

  it("preserves existing product metadata when stamping", () => {
    const [update] = planUniqueInventorySaleUpdates({
      items: [{ product_id: "prod_1", variant_id: "var_1" }],
      products: [
        uniqueProduct("prod_1", { metadata: { artist: "june", year: 1998 } }),
      ],
      order_id: "order_1",
    })
    expect(update.product_update.metadata).toEqual({
      artist: "june",
      year: 1998,
      unique_inventory_sold: true,
      unique_inventory_sold_order_id: "order_1",
    })
  })

  it("omits the order-id stamp when no order id is given", () => {
    const [update] = planUniqueInventorySaleUpdates({
      items: [{ product_id: "prod_1", variant_id: "var_1" }],
      products: [uniqueProduct("prod_1")],
    })
    expect(update.product_update.metadata).toEqual({
      unique_inventory_sold: true,
    })
  })

  it("ignores products with other listing types or no listing-type link", () => {
    const updates = planUniqueInventorySaleUpdates({
      items: [
        { product_id: "prod_physical", variant_id: "var_a" },
        { product_id: "prod_unlinked", variant_id: "var_b" },
      ],
      products: [
        uniqueProduct("prod_physical", {
          listing_type: { catalog_id: "physical_product" },
        }),
        uniqueProduct("prod_unlinked", { listing_type: null }),
      ],
      order_id: "order_1",
    })
    expect(updates).toEqual([])
  })

  it("ignores products not referenced by any order item", () => {
    const updates = planUniqueInventorySaleUpdates({
      items: [{ product_id: "prod_other", variant_id: "var_1" }],
      products: [uniqueProduct("prod_1")],
      order_id: "order_1",
    })
    expect(updates).toEqual([])
  })

  it("is idempotent: an already-sold product yields no update", () => {
    const updates = planUniqueInventorySaleUpdates({
      items: [{ product_id: "prod_1", variant_id: "var_1" }],
      products: [
        uniqueProduct("prod_1", { metadata: { unique_inventory_sold: true } }),
      ],
      order_id: "order_2",
    })
    expect(updates).toEqual([])
  })

  it("dedupes variants and duplicate product rows", () => {
    const updates = planUniqueInventorySaleUpdates({
      items: [
        { product_id: "prod_1", variant_id: "var_1" },
        { product_id: "prod_1", variant_id: "var_1" },
        { product_id: "prod_1", variant_id: "var_2" },
        { product_id: "prod_1", variant_id: null },
      ],
      products: [uniqueProduct("prod_1"), uniqueProduct("prod_1")],
      order_id: "order_1",
    })
    expect(updates).toHaveLength(1)
    expect(updates[0].variant_ids).toEqual(["var_1", "var_2"])
  })

  it("handles items without product ids and empty inputs", () => {
    expect(
      planUniqueInventorySaleUpdates({
        items: [{ product_id: null, variant_id: "var_1" }],
        products: [uniqueProduct("prod_1")],
      })
    ).toEqual([])
    expect(planUniqueInventorySaleUpdates({ items: [], products: [] })).toEqual(
      []
    )
  })
})

describe("unique-inventory-sold subscriber", () => {
  const makeContainer = (graphResponses: Record<string, unknown[]>) => {
    const graph = jest.fn(async ({ entity }: { entity: string }) => ({
      data: graphResponses[entity] ?? [],
    }))
    const productService = { updateProducts: jest.fn().mockResolvedValue({}) }
    const inventoryService = {
      updateInventoryLevels: jest.fn().mockResolvedValue([]),
    }
    const container = {
      resolve: (token: string) => {
        if (token === "query") return { graph }
        if (token === Modules.PRODUCT) return productService
        if (token === Modules.INVENTORY) return inventoryService
        return {}
      },
    }
    return { container, graph, productService, inventoryService }
  }

  const run = (container: unknown) =>
    handler({ event: { data: { id: "order_1" } }, container } as any)

  it("zeroes stock levels and drafts the product for a unique-inventory sale", async () => {
    const { container, productService, inventoryService } = makeContainer({
      order: [
        {
          id: "order_1",
          items: [{ product_id: "prod_1", variant_id: "var_1" }],
        },
      ],
      product: [uniqueProduct("prod_1")],
      product_variant_inventory_item: [
        { variant_id: "var_1", inventory_item_id: "iitem_1" },
      ],
      inventory_item: [
        {
          id: "iitem_1",
          inventory_levels: [
            { location_id: "loc_1" },
            { location_id: "loc_2" },
          ],
        },
      ],
    })

    await run(container)

    expect(inventoryService.updateInventoryLevels).toHaveBeenCalledWith([
      { inventory_item_id: "iitem_1", location_id: "loc_1", stocked_quantity: 0 },
      { inventory_item_id: "iitem_1", location_id: "loc_2", stocked_quantity: 0 },
    ])
    expect(productService.updateProducts).toHaveBeenCalledWith("prod_1", {
      status: "draft",
      metadata: {
        unique_inventory_sold: true,
        unique_inventory_sold_order_id: "order_1",
      },
    })
  })

  it("does nothing for orders with only non-unique products", async () => {
    const { container, productService, inventoryService } = makeContainer({
      order: [
        {
          id: "order_1",
          items: [{ product_id: "prod_1", variant_id: "var_1" }],
        },
      ],
      product: [
        uniqueProduct("prod_1", {
          listing_type: { catalog_id: "physical_product" },
        }),
      ],
    })

    await run(container)

    expect(productService.updateProducts).not.toHaveBeenCalled()
    expect(inventoryService.updateInventoryLevels).not.toHaveBeenCalled()
  })

  it("still drafts the product when the variant has no inventory link", async () => {
    const { container, productService, inventoryService } = makeContainer({
      order: [
        {
          id: "order_1",
          items: [{ product_id: "prod_1", variant_id: "var_1" }],
        },
      ],
      product: [uniqueProduct("prod_1")],
      product_variant_inventory_item: [],
    })

    await run(container)

    expect(inventoryService.updateInventoryLevels).not.toHaveBeenCalled()
    expect(productService.updateProducts).toHaveBeenCalledWith(
      "prod_1",
      expect.objectContaining({ status: "draft" })
    )
  })

  it("swallows errors so the order pipeline never breaks", async () => {
    const graph = jest.fn().mockRejectedValue(new Error("boom"))
    const container = { resolve: () => ({ graph }) }
    await expect(run(container)).resolves.toBeUndefined()
  })
})

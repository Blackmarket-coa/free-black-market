import {
  planPosInventoryAdjustments,
  type PosVariantInventoryContext,
} from "../pos-helpers"

const managed = (
  variantId: string,
  overrides: Partial<PosVariantInventoryContext> = {}
): PosVariantInventoryContext => ({
  variant_id: variantId,
  manage_inventory: true,
  inventory_item_id: `iitem_${variantId}`,
  location_id: `loc_${variantId}`,
  ...overrides,
})

describe("planPosInventoryAdjustments", () => {
  it("maps a managed catalog item to a single positive-quantity adjustment", () => {
    const plan = planPosInventoryAdjustments(
      [{ variant_id: "var_1", quantity: 2 }],
      [managed("var_1")]
    )
    expect(plan.adjustments).toEqual([
      {
        variant_id: "var_1",
        inventory_item_id: "iitem_var_1",
        location_id: "loc_var_1",
        quantity: 2,
      },
    ])
    expect(plan.skipped).toEqual([])
  })

  it("aggregates repeated lines for the same variant into one adjustment", () => {
    const plan = planPosInventoryAdjustments(
      [
        { variant_id: "var_1", quantity: 1 },
        { variant_id: "var_1", quantity: 3 },
      ],
      [managed("var_1")]
    )
    expect(plan.adjustments).toHaveLength(1)
    expect(plan.adjustments[0].quantity).toBe(4)
  })

  it("ignores ad-hoc lines with no variant_id", () => {
    const plan = planPosInventoryAdjustments(
      [{ variant_id: undefined, quantity: 5 }],
      []
    )
    expect(plan.adjustments).toEqual([])
    expect(plan.skipped).toEqual([])
  })

  it("skips unmanaged variants with a reason instead of adjusting", () => {
    const plan = planPosInventoryAdjustments(
      [{ variant_id: "var_1", quantity: 1 }],
      [managed("var_1", { manage_inventory: false })]
    )
    expect(plan.adjustments).toEqual([])
    expect(plan.skipped).toEqual([
      { variant_id: "var_1", reason: "not_managed" },
    ])
  })

  it("skips variants missing an inventory item or a location level", () => {
    const plan = planPosInventoryAdjustments(
      [
        { variant_id: "var_no_item", quantity: 1 },
        { variant_id: "var_no_loc", quantity: 1 },
      ],
      [
        managed("var_no_item", { inventory_item_id: null }),
        managed("var_no_loc", { location_id: null }),
      ]
    )
    expect(plan.adjustments).toEqual([])
    expect(plan.skipped).toEqual([
      { variant_id: "var_no_item", reason: "no_inventory_item" },
      { variant_id: "var_no_loc", reason: "no_location_level" },
    ])
  })

  it("skips variants with no resolved context at all", () => {
    const plan = planPosInventoryAdjustments(
      [{ variant_id: "var_ghost", quantity: 1 }],
      []
    )
    expect(plan.skipped).toEqual([
      { variant_id: "var_ghost", reason: "unknown_variant" },
    ])
  })

  it("mixes adjustments and skips across a multi-line ring-up", () => {
    const plan = planPosInventoryAdjustments(
      [
        { variant_id: "var_ok", quantity: 2 },
        { variant_id: "var_untracked", quantity: 1 },
        { variant_id: undefined, quantity: 1 },
      ],
      [managed("var_ok"), managed("var_untracked", { manage_inventory: false })]
    )
    expect(plan.adjustments).toEqual([
      expect.objectContaining({ variant_id: "var_ok", quantity: 2 }),
    ])
    expect(plan.skipped).toEqual([
      { variant_id: "var_untracked", reason: "not_managed" },
    ])
  })

  it("returns an empty plan for an empty item list", () => {
    expect(planPosInventoryAdjustments([], [managed("var_1")])).toEqual({
      adjustments: [],
      skipped: [],
    })
  })
})

import {
  classifyPhytoRestrictions,
  type PhytoItemInput,
} from "../node-fulfillment"

const live = (id: string, opts: Partial<PhytoItemInput> = {}): PhytoItemInput => ({
  line_item_id: id,
  title: opts.title ?? "Fig",
  is_live_plant: opts.is_live_plant ?? true,
  requires_phyto_cert: opts.requires_phyto_cert ?? false,
})

describe("node-fulfillment: classifyPhytoRestrictions", () => {
  it("flags every live plant into a fully-restricted state", () => {
    const out = classifyPhytoRestrictions("CA", [live("li_1"), live("li_2")])
    expect(out).toHaveLength(2)
    expect(out[0].reason).toMatch(/CA/)
  })

  it("flags only requires_phyto_cert items into a citrus-restricted state", () => {
    const out = classifyPhytoRestrictions("TX", [
      live("li_citrus", { requires_phyto_cert: true }),
      live("li_plain", { requires_phyto_cert: false }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].item_id).toBe("li_citrus")
  })

  it("returns nothing for an unrestricted state", () => {
    expect(classifyPhytoRestrictions("NY", [live("li_1")])).toEqual([])
  })

  it("returns nothing when there is no destination state", () => {
    expect(classifyPhytoRestrictions(null, [live("li_1")])).toEqual([])
  })

  it("skips non-live items", () => {
    const out = classifyPhytoRestrictions("CA", [
      live("li_dry", { is_live_plant: false, requires_phyto_cert: false }),
    ])
    expect(out).toEqual([])
  })
})

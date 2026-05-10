import { describe, expect, it } from "vitest"
import { selectPresentation } from "@/lib/listing/presentation"

describe("selectPresentation", () => {
  it("/shop entries default to retail", () => {
    expect(selectPresentation({ routeKind: "shop" })).toBe("retail")
  })

  it("/products entries default to marketplace", () => {
    expect(selectPresentation({ routeKind: "products" })).toBe("marketplace")
  })

  it("a vendor seller-handle forces marketplace regardless of route", () => {
    expect(
      selectPresentation({ routeKind: "shop", sellerHandle: "alice-farm" })
    ).toBe("marketplace")
  })

  it("a coalition storefront context forces marketplace", () => {
    expect(
      selectPresentation({
        routeKind: "shop",
        storefrontContext: {
          organization_id: "org_alpha",
          storefront_id: "sf_alpha",
        },
      })
    ).toBe("marketplace")
  })

  it("a coalition member without storefront context still gets marketplace", () => {
    expect(
      selectPresentation({ routeKind: "shop", isCoalitionMember: true })
    ).toBe("marketplace")
  })

  it("embed routes always render marketplace presentation", () => {
    expect(selectPresentation({ routeKind: "embed" })).toBe("marketplace")
  })

  it("falls back to retail when no signals point either way", () => {
    expect(selectPresentation({})).toBe("retail")
  })
})

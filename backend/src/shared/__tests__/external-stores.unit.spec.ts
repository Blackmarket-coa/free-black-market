import { normalizeStorefrontLinks } from "../external-stores"

describe("normalizeStorefrontLinks", () => {
  it("maps known platform keys to labelled stores", () => {
    const out = normalizeStorefrontLinks({
      etsy: "https://etsy.com/shop/foo",
      shopify: "https://foo.myshopify.com",
    })
    expect(out).toEqual([
      { platform: "etsy", name: "Etsy", url: "https://etsy.com/shop/foo" },
      { platform: "shopify", name: "Shopify", url: "https://foo.myshopify.com" },
    ])
  })

  it("drops non-http(s) and empty values", () => {
    const out = normalizeStorefrontLinks({
      etsy: "not-a-url",
      amazon: "",
      ebay: null,
      shopify: "ftp://nope",
    })
    expect(out).toEqual([])
  })

  it("includes `other` entries with their custom name", () => {
    const out = normalizeStorefrontLinks({
      other: [
        { name: "Mayhem Marketplace", url: "https://mayhem.example/shop" },
        { name: "", url: "https://noname.example" },
        { name: "skip", url: "javascript:alert(1)" },
      ],
    })
    expect(out).toEqual([
      {
        platform: "other",
        name: "Mayhem Marketplace",
        url: "https://mayhem.example/shop",
      },
      { platform: "other", name: "Other", url: "https://noname.example" },
    ])
  })

  it("falls back to website_url when no website link is present", () => {
    const out = normalizeStorefrontLinks({}, "https://farm.example")
    expect(out).toEqual([
      { platform: "website", name: "Website", url: "https://farm.example" },
    ])
  })

  it("does not duplicate the website when both sources agree", () => {
    const out = normalizeStorefrontLinks(
      { website: "https://farm.example" },
      "https://farm.example"
    )
    expect(out.filter((s) => s.platform === "website")).toHaveLength(1)
  })

  it("handles null/garbage input", () => {
    expect(normalizeStorefrontLinks(null)).toEqual([])
    expect(normalizeStorefrontLinks(undefined, 123)).toEqual([])
  })
})

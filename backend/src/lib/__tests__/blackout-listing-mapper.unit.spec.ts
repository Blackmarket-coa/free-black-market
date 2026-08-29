import { toBlackoutListing } from "../blackout-listing-mapper"

describe("toBlackoutListing", () => {
  it("maps a CreatorListing row onto the camelCase §5 Listing shape", () => {
    const out = toBlackoutListing({
      id: "lst_1",
      seller_id: "sel_1",
      slug: "cat-stickers",
      status: "published",
      title: "Cat Sticker Pack",
      description: "Cute cats",
      category: "emoji-sticker",
      price_cents: 199,
      currency: "USD",
      entitlement_kind: "emoji_pack",
      available_skus: ["s1", "s2"],
      media_urls: ["https://cdn/x.png"],
      tags: ["cats"],
      feature_keys: ["features.stickers.cats"],
    })

    expect(out).toMatchObject({
      id: "lst_1",
      category: "emoji-sticker",
      title: "Cat Sticker Pack",
      priceCents: 199,
      currency: "USD",
      sellerId: "sel_1",
      entitlementKind: "emoji_pack",
      availableSkus: ["s1", "s2"],
      mediaUrls: ["https://cdn/x.png"],
      tags: ["cats"],
      featureKeys: ["features.stickers.cats"],
      slug: "cat-stickers",
      status: "published",
      pluginSlug: null,
      pluginVersion: null,
    })
  })

  it("exposes plugin registry identity once the publish bridge sets it (W3)", () => {
    const out = toBlackoutListing({
      id: "lst_3",
      seller_id: "sel_3",
      slug: "vendor-widget",
      title: "Featured Vendor Widget",
      plugin_slug: "featured-vendor-widget",
      plugin_version: "1.2.0",
    })
    expect(out.pluginSlug).toBe("featured-vendor-widget")
    expect(out.pluginVersion).toBe("1.2.0")
  })

  it("falls back to signed_bundle_url for media and defaults currency/arrays", () => {
    const out = toBlackoutListing({
      id: "lst_2",
      seller_id: "sel_2",
      title: "Bundle",
      signed_bundle_url: "https://cdn/bundle.zip",
    })
    expect(out.mediaUrls).toEqual(["https://cdn/bundle.zip"])
    expect(out.currency).toBe("USD")
    expect(out.priceCents).toBeNull()
    expect(out.availableSkus).toEqual([])
    expect(out.tags).toEqual([])
    expect(out.featureKeys).toEqual([])
  })
})

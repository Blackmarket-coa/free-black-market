import { strandedFor, loadSellerListings } from "../playbook-preflight"
import type { SellerListings } from "../playbook-preflight"

const loaded = (listings: SellerListings["listings"]): SellerListings => ({
  listings,
  checked: true,
})

const makeContainer = (graph: () => Promise<{ data: any[] }>) => ({
  resolve: () => ({ graph }),
}) as never

describe("playbook switch preflight", () => {
  describe("strandedFor", () => {
    it("flags listings the target playbook does not allow", () => {
      // Kitchen allows physical / event / recurring / wholesale / bookable.
      const result = strandedFor(
        loaded([
          { id: "p1", title: "Sourdough", listing_type_id: "physical_product" },
          { id: "p2", title: "Recipe zine", listing_type_id: "digital" },
          { id: "p3", title: "One-off cake stand", listing_type_id: "unique_inventory" },
        ]),
        "kitchen"
      )

      expect(result.checked).toBe(true)
      expect(result.stranded_listing_count).toBe(2)
      expect(result.stranded_listings.map((l) => l.id)).toEqual(["p2", "p3"])
    })

    it("returns zero when everything fits", () => {
      const result = strandedFor(
        loaded([
          { id: "p1", title: "Sourdough", listing_type_id: "physical_product" },
        ]),
        "kitchen"
      )
      expect(result.stranded_listing_count).toBe(0)
      expect(result.checked).toBe(true)
    })

    it("treats an unlinked listing-type as physical_product", () => {
      // Same fallback the write path uses in `resolveListingTypeId`.
      const result = strandedFor(
        loaded([
          { id: "p1", title: "Untyped", listing_type_id: "physical_product" },
        ]),
        "stall"
      )
      expect(result.stranded_listing_count).toBe(0)
    })

    it("reports not-checked rather than zero when the read failed", () => {
      // The important property: a count of zero from a failed check reads as
      // "you're fine". An understated meter is worse than no meter, so the
      // caller must be able to tell the difference.
      const result = strandedFor({ listings: [], checked: false }, "kitchen")
      expect(result.checked).toBe(false)
      expect(result.stranded_listing_count).toBe(0)
    })

    it("caps the named sample but not the count", () => {
      const many = Array.from({ length: 25 }, (_, i) => ({
        id: `p${i}`,
        title: `Digital ${i}`,
        listing_type_id: "digital",
      }))
      const result = strandedFor(loaded(many), "kitchen")
      expect(result.stranded_listing_count).toBe(25)
      expect(result.stranded_listings).toHaveLength(10)
    })
  })

  describe("loadSellerListings", () => {
    it("maps products and their linked listing-type", async () => {
      const result = await loadSellerListings(
        makeContainer(async () => ({
          data: [
            {
              products: [
                { id: "p1", title: "Jam", listing_type: { catalog_id: "physical_product" } },
                { id: "p2", title: "Course", listing_type: { catalog_id: "digital" } },
              ],
            },
          ],
        })),
        "sel_1"
      )

      expect(result.checked).toBe(true)
      expect(result.listings).toEqual([
        { id: "p1", title: "Jam", listing_type_id: "physical_product" },
        { id: "p2", title: "Course", listing_type_id: "digital" },
      ])
    })

    it("defaults a product with no linked listing-type to physical_product", async () => {
      const result = await loadSellerListings(
        makeContainer(async () => ({
          data: [{ products: [{ id: "p1", title: "Bare" }] }],
        })),
        "sel_1"
      )
      expect(result.listings[0].listing_type_id).toBe("physical_product")
    })

    it("degrades to not-checked when the query throws", async () => {
      const result = await loadSellerListings(
        makeContainer(async () => {
          throw new Error("link module absent")
        }),
        "sel_1"
      )
      expect(result).toEqual({ listings: [], checked: false })
    })

    it("degrades to not-checked when the seller has no products key", async () => {
      // A shape difference must not read as "this seller has zero listings".
      const result = await loadSellerListings(
        makeContainer(async () => ({ data: [{}] })),
        "sel_1"
      )
      expect(result.checked).toBe(false)
    })
  })
})

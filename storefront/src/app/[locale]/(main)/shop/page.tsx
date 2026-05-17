import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Shop",
  description:
    "Public retail catalog. Same listings as the vendor marketplace, presented in retail mode for general visitors.",
}

/**
 * Retail entry landing per the unified presentation design in
 * AGGRESSIVE_OPERATIONS_GUIDE.md §1.1. Coalition members browsing in a
 * coalition storefront context get the marketplace presentation
 * automatically; everyone else lands here for the retail catalog.
 *
 * The retail-side product list is intentionally minimal today: the same
 * underlying `listProducts()` data source as `/products` powers the
 * marketplace catalog and will be added here as the retail browse
 * experience matures (deferred from this workstream).
 */
export default async function ShopLandingPage() {
  return (
    <main className="container py-8 space-y-4">
      <h1 className="heading-md uppercase">Shop</h1>
      <p className="text-secondary max-w-prose">
        This is the public retail catalog. The same listings powering the
        vendor marketplace are presented here in retail mode. Coalition
        members signed in to their coalition&apos;s storefront see the
        vendor-forward marketplace view automatically.
      </p>
      <p className="text-secondary text-sm">
        Browse the catalog by <Link className="underline" href="/categories">category</Link>
        {" "}or by <Link className="underline" href="/vendors">vendor</Link>.
      </p>
    </main>
  )
}

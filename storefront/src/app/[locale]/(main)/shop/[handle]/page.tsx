import { ProductDetailsPage } from "@/components/sections"
import { listProducts } from "@/lib/data/products"
import { generateProductMetadata } from "@/lib/helpers/seo"
import { selectPresentation } from "@/lib/listing/presentation"
import { getStorefrontContext } from "@/lib/data/cookies"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

/**
 * Retail entry for a single product. Same data source as
 * `/products/[handle]`; presentation defaults to `retail` per the
 * unified retail/marketplace design in
 * AGGRESSIVE_OPERATIONS_GUIDE.md §1.1. Switches to `marketplace` when
 * the buyer is in a coalition's storefront context.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; locale: string }>
}): Promise<Metadata> {
  const { handle, locale } = await params

  const prod = await listProducts({
    countryCode: locale,
    queryParams: { handle: [handle], limit: 1 },
    forceCache: true,
  }).then(({ response }) => response.products[0])

  return generateProductMetadata(prod)
}

export default async function ShopProductPage({
  params,
}: {
  params: Promise<{ handle: string; locale: string }>
}) {
  const { handle, locale } = await params

  const prod = await listProducts({
    countryCode: locale,
    queryParams: { handle: [handle], limit: 1 },
    forceCache: true,
  }).then(({ response }) => response.products[0])

  if (!prod) {
    return notFound()
  }

  const storefrontContext = await getStorefrontContext()
  const presentation = selectPresentation({
    routeKind: "shop",
    storefrontContext,
    sellerHandle: null,
  })

  return (
    <main className="container">
      <ProductDetailsPage handle={handle} locale={locale} presentation={presentation} />
    </main>
  )
}

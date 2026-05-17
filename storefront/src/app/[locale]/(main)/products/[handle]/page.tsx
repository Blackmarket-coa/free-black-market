import { ProductDetailsPage } from "@/components/sections"
import { listProducts } from "@/lib/data/products"
import { generateProductMetadata } from "@/lib/helpers/seo"
import { selectPresentation } from "@/lib/listing/presentation"
import { getStorefrontContext } from "@/lib/data/cookies"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

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

export default async function ProductPage({
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
    routeKind: "products",
    storefrontContext,
    sellerHandle: prod.seller?.handle ?? null,
  })

  return (
    <main className="container">
      <ProductDetailsPage handle={handle} locale={locale} presentation={presentation} />
    </main>
  )
}

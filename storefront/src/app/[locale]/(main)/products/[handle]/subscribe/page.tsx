import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { LoginForm } from "@/components/molecules"
import { SubscribeForm } from "@/components/sections/Subscriptions"
import { retrieveCustomer } from "@/lib/data/customer"
import { listProducts } from "@/lib/data/products"
import { phase1ModuleFlags } from "@/lib/feature-flags"
import { getProductPrice } from "@/lib/helpers/get-product-price"
import { graceDaysOf, subscribableInterval } from "@/lib/subscriptions/auto-renew"

export const metadata: Metadata = {
  title: "Subscribe",
  description: "Start a subscription.",
}

/**
 * The subscribe step for a product marked subscribable
 * (NEXT_PUBLIC_FF_CONSUMER_SUBSCRIPTIONS_V1). Not found with the flag off or
 * for any product that is not offered this way.
 */
export default async function SubscribePage({
  params,
}: {
  params: Promise<{ handle: string; locale: string }>
}) {
  if (!phase1ModuleFlags.consumerSubscriptions) return notFound()

  const { handle, locale } = await params
  const product = await listProducts({
    countryCode: locale,
    queryParams: { handle: [handle], limit: 1 },
  }).then(({ response }) => response.products[0])

  const interval = subscribableInterval(product)
  const variant = product?.variants?.[0]
  if (!product || !interval || !variant?.id) return notFound()

  const customer = await retrieveCustomer()
  if (!customer) return <LoginForm />

  const { variantPrice } = getProductPrice({ product, variantId: variant.id })
  if (!variantPrice) return notFound()

  return (
    <main className="container max-w-2xl mt-6 space-y-6">
      <h1 className="heading-md uppercase">Subscribe</h1>
      <SubscribeForm
        productTitle={product.title ?? "Subscription"}
        price={variantPrice.calculated_price}
        interval={interval}
        graceDays={graceDaysOf(product)}
        variantId={variant.id}
        countryCode={locale}
      />
    </main>
  )
}

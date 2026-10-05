import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { AccountLoadingState, LoginForm, UserNavigation } from "@/components/molecules"
import { SubscriptionsList } from "@/components/sections/Subscriptions"
import { retrieveCustomerContext } from "@/lib/data/customer"
import { listProducts } from "@/lib/data/products"
import { listSubscriptions } from "@/lib/data/subscriptions"
import { phase1ModuleFlags } from "@/lib/feature-flags"
import { getProductPrice } from "@/lib/helpers/get-product-price"

export const metadata: Metadata = {
  title: "Your Subscriptions",
  description: "Manage your subscriptions and automatic renewal.",
}

/**
 * The customer's subscriptions: status, next charge, automatic renewal on/off,
 * cancel (NEXT_PUBLIC_FF_CONSUMER_SUBSCRIPTIONS_V1; not found with it off).
 */
export default async function UserSubscriptionsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  if (!phase1ModuleFlags.consumerSubscriptions) return notFound()

  const { customer, isAuthenticated } = await retrieveCustomerContext()
  if (!customer) {
    if (!isAuthenticated) return <LoginForm />
    return <AccountLoadingState title="Subscriptions" />
  }

  const { locale } = await params
  const subscriptions = await listSubscriptions()

  const productIds = [
    ...new Set(
      subscriptions
        .map((s) => s.product_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ]
  const products: Record<string, { title: string; price: string | null }> = {}
  if (productIds.length) {
    // `id` is a valid /store/products filter the SDK param type omits.
    const queryParams = { id: productIds, limit: productIds.length } as Parameters<
      typeof listProducts
    >[0]["queryParams"]
    const { response } = await listProducts({ countryCode: locale, queryParams }).catch(() => ({
      response: { products: [] },
    }))
    for (const product of response.products) {
      const variantId = product.variants?.[0]?.id
      const price = variantId
        ? getProductPrice({ product, variantId }).variantPrice?.calculated_price ?? null
        : null
      products[product.id] = { title: product.title ?? "Subscription", price }
    }
  }

  return (
    <main className="container">
      <div className="grid grid-cols-1 md:grid-cols-4 mt-6 gap-5 md:gap-8">
        <UserNavigation />
        <div className="md:col-span-3 space-y-8">
          <h1 className="heading-md uppercase">Subscriptions</h1>
          <SubscriptionsList subscriptions={subscriptions} products={products} />
        </div>
      </div>
    </main>
  )
}

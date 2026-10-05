import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { phase1ModuleFlags } from "@/lib/feature-flags"
import { intervalNoun, subscribableInterval } from "@/lib/subscriptions/auto-renew"

/**
 * Product-page entry to the subscribe step, for a product marked subscribable
 * (metadata `subscription_until_canceled` + a known `subscription_interval`).
 * Renders nothing with NEXT_PUBLIC_FF_CONSUMER_SUBSCRIPTIONS_V1 off, and
 * nothing for any other product, so the ordinary product page is unchanged.
 */
export const SubscribeCta = ({
  product,
  flagOn = phase1ModuleFlags.consumerSubscriptions,
}: {
  product: { handle?: string | null; metadata?: Record<string, unknown> | null }
  flagOn?: boolean
}) => {
  if (!flagOn || !product?.handle) return null
  const interval = subscribableInterval(product)
  if (!interval) return null

  return (
    <section className="my-4" data-listing-slot="subscribe">
      <LocalizedClientLink
        href={`/products/${product.handle}/subscribe`}
        className="inline-block rounded-md bg-action px-[16px] py-[8px] text-md button-text text-action-on-primary hover:bg-action-hover"
      >
        Subscribe
      </LocalizedClientLink>
      <p className="mt-2 text-sm text-secondary">
        Billed every {intervalNoun(interval)}. Automatic renewal only if you choose it.
      </p>
    </section>
  )
}

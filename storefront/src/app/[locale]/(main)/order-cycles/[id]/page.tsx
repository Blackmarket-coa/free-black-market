import type { Metadata } from "next"
import { notFound } from "next/navigation"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { getOrderCycle } from "@/lib/data/order-cycles"
import AddCycleItem from "./add-cycle-item"

export const metadata: Metadata = {
  title: "Order Cycle",
  description: "What is available in this ordering window, and when it closes.",
}

type PageProps = {
  params: Promise<{ id: string; locale: string }>
}

/**
 * One cycle, and what can be ordered from it.
 *
 * Two things this page deliberately does not claim. It does not show a currency
 * symbol: `effective_price` arrives unlabeled, and while the nested
 * `variant.prices[]` rows do carry `currency_code`, neither store route is
 * region-scoped — the route picks `prices[0]` and says so in its own comment —
 * so choosing one of those codes to label the number with would be a guess
 * dressed as a fact. And it does not render a price at all when the API gives
 * none, rather than printing a zero that would read as free.
 */
export default async function OrderCycleDetailPage({ params }: PageProps) {
  const { id, locale } = await params

  const detail = await getOrderCycle(id)
  if (!detail) return notFound()

  const { order_cycle: cycle, products, seller_count } = detail

  return (
    <main className="container py-10">
      <nav className="mb-6 text-sm">
        <LocalizedClientLink href="/order-cycles" className="underline">
          ← All order cycles
        </LocalizedClientLink>
      </nav>

      <header className="mb-8 max-w-2xl">
        <div className="mb-1 text-xs uppercase text-ui-fg-subtle">
          {cycle.status}
          {seller_count ? ` · ${seller_count} producer${seller_count === 1 ? "" : "s"}` : ""}
        </div>
        <h1 className="text-2xl font-semibold">{cycle.name}</h1>
        {cycle.description ? (
          <p className="mt-2 text-sm text-ui-fg-subtle">{cycle.description}</p>
        ) : null}

        <dl className="mt-4 grid gap-1 text-sm text-ui-fg-subtle">
          <div>
            Ordering closes{" "}
            <time dateTime={cycle.closes_at}>
              {new Date(cycle.closes_at).toLocaleString()}
            </time>
          </div>
          {cycle.dispatch_at ? (
            <div>
              Dispatch{" "}
              <time dateTime={cycle.dispatch_at}>
                {new Date(cycle.dispatch_at).toLocaleDateString()}
              </time>
            </div>
          ) : null}
          {cycle.pickup_location ? <div>Collect from {cycle.pickup_location}</div> : null}
        </dl>

        {cycle.pickup_instructions ? (
          <p className="mt-3 rounded-md border p-3 text-sm">{cycle.pickup_instructions}</p>
        ) : null}
      </header>

      {!cycle.is_open ? (
        <p className="mb-6 rounded-md border p-4 text-sm">
          This cycle is <strong>{cycle.status}</strong>, so nothing can be ordered
          from it yet. The list below is what it expects to carry.
        </p>
      ) : null}

      {products.length === 0 ? (
        <div className="rounded-md border p-6 text-sm text-ui-fg-subtle">
          Nothing has been listed in this cycle yet.
        </div>
      ) : (
        <ul className="grid gap-3" data-testid="order-cycle-products">
          {products.map((product) => {
            // A cycle row can outlive its variant; the API still returns the
            // row, with no variant object on it.
            const title =
              product.variant?.product?.title ??
              product.variant?.title ??
              "Item no longer listed"
            const soldOut =
              product.available_quantity !== null && product.available_quantity <= 0

            return (
              <li key={product.id} className="rounded-md border p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="font-medium">{title}</h2>
                    {product.variant?.title && product.variant?.product?.title ? (
                      <p className="text-xs text-ui-fg-subtle">{product.variant.title}</p>
                    ) : null}

                    <p className="mt-1 text-sm text-ui-fg-subtle">
                      {product.effective_price !== null
                        ? `${product.effective_price}${product.has_override_price ? " (cycle price)" : ""}`
                        : "Price not set for this cycle"}
                    </p>

                    <p className="mt-1 text-xs text-ui-fg-subtle">
                      {product.available_quantity === null
                        ? "No limit set"
                        : soldOut
                          ? "None left"
                          : `${product.available_quantity} left`}
                    </p>
                  </div>

                  {cycle.is_open && product.variant?.id && !soldOut ? (
                    <AddCycleItem
                      orderCycleId={cycle.id}
                      variantId={product.variant_id}
                      locale={locale}
                      maxQuantity={product.available_quantity}
                    />
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}

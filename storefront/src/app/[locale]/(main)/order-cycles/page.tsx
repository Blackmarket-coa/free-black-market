import type { Metadata } from "next"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { listOrderCycles } from "@/lib/data/order-cycles"

export const metadata: Metadata = {
  title: "Order Cycles",
  description:
    "Ordering windows local producers open together — order while the cycle is open, collect when it lands.",
}

/**
 * Open order cycles.
 *
 * The module and its `/store/order-cycles` routes shipped without a storefront,
 * so a cycle was something only a coordinator could see. `count` from that API
 * is the length of the page rather than the total, so this deliberately shows
 * no total and no pager.
 */
export default async function OrderCyclesPage({
  searchParams,
}: {
  searchParams?: Promise<{ upcoming?: string }>
}) {
  const params = (await searchParams) ?? {}
  const includeUpcoming = params.upcoming === "true"

  const cycles = await listOrderCycles(
    includeUpcoming ? { include_upcoming: "true", limit: 50 } : { limit: 50 }
  )

  return (
    <main className="container py-10">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-semibold">Order cycles</h1>
        <p className="mt-2 text-sm text-ui-fg-subtle">
          Producers open an ordering window together, then pack and dispatch it
          in one run. Order while a cycle is open; what you order is collected
          on its dispatch date.
        </p>
      </header>

      <div className="mb-6 text-sm">
        {includeUpcoming ? (
          <LocalizedClientLink href="/order-cycles" className="underline">
            Show only what is open now
          </LocalizedClientLink>
        ) : (
          <LocalizedClientLink href="/order-cycles?upcoming=true" className="underline">
            Include cycles opening soon
          </LocalizedClientLink>
        )}
      </div>

      {cycles.length === 0 ? (
        <div className="rounded-md border p-6 text-sm text-ui-fg-subtle">
          No cycles are open right now.
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" data-testid="order-cycle-list">
          {cycles.map((cycle) => (
            <li key={cycle.id} className="rounded-md border p-4">
              <div className="mb-1 text-xs uppercase text-ui-fg-subtle">
                {cycle.status}
                {cycle.pickup_location ? ` · ${cycle.pickup_location}` : ""}
              </div>
              <h2 className="mb-1 text-lg font-medium">{cycle.name}</h2>
              {cycle.description ? (
                <p className="mb-3 line-clamp-2 text-sm text-ui-fg-subtle">
                  {cycle.description}
                </p>
              ) : null}

              <dl className="mb-4 grid gap-1 text-xs text-ui-fg-subtle">
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
                <div>
                  {cycle.product_count} item{cycle.product_count === 1 ? "" : "s"} ·{" "}
                  {cycle.seller_count} producer{cycle.seller_count === 1 ? "" : "s"}
                </div>
              </dl>

              <LocalizedClientLink
                href={`/order-cycles/${cycle.id}`}
                className="text-sm font-medium underline"
              >
                See what is in it
              </LocalizedClientLink>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

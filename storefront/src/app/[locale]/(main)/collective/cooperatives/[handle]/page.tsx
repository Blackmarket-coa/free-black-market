import type { Metadata } from "next"
import { notFound } from "next/navigation"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { getCoalitionListings, getCoalitionNeeds } from "@/lib/data/collective"

export const metadata: Metadata = {
  title: "Coalition",
  description:
    "A local coalition: hosted products, open needs, and bounties. Products live in FBM; the coalition displays and contextualizes them.",
}

export default async function CoalitionPage({
  params,
}: {
  params: Promise<{ handle: string }>
}) {
  const { handle } = await params

  let listingsRes
  let needsRes
  try {
    ;[listingsRes, needsRes] = await Promise.all([
      getCoalitionListings(handle),
      getCoalitionNeeds(handle),
    ])
  } catch {
    notFound()
  }

  const coop = listingsRes.cooperative
  const listings = listingsRes.listings ?? []
  const needs = needsRes.needs ?? []

  return (
    <main className="container py-10">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-green-700">
          Coalition
        </p>
        <h1 className="text-3xl font-semibold">{coop.name}</h1>
        {coop.description ? (
          <p className="mt-2 max-w-2xl text-ui-fg-subtle">{coop.description}</p>
        ) : null}
      </header>

      {/* Hosted products */}
      <section className="mb-10">
        <h2 className="mb-4 text-xl font-semibold">Hosted products</h2>
        {listings.length === 0 ? (
          <div className="rounded-md border p-6 text-sm text-ui-fg-subtle">
            This coalition isn&apos;t hosting any products yet.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {listings.map((l) => (
              <div key={l.id} className="rounded-xl border p-4">
                <p className="font-medium">{l.name}</p>
                {l.unified_price != null ? (
                  <p className="mt-1 text-sm text-ui-fg-subtle">
                    {(l.currency_code || "usd").toUpperCase()}{" "}
                    {Number(l.unified_price).toLocaleString()}
                  </p>
                ) : null}
                {l.product_id ? (
                  <LocalizedClientLink
                    href={`/products/${l.product_id}`}
                    className="mt-3 inline-block text-sm font-medium text-green-700 underline"
                  >
                    View in marketplace
                  </LocalizedClientLink>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Needs board */}
      <section>
        <h2 className="mb-4 text-xl font-semibold">Coalition needs</h2>
        {needs.length === 0 ? (
          <div className="rounded-md border p-6 text-sm text-ui-fg-subtle">
            No open needs right now.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {needs.map((n) => (
              <LocalizedClientLink
                key={n.id}
                href={`/collective/demand-pools/${n.id}`}
                className="rounded-xl border p-4 transition-colors hover:border-green-400 hover:bg-green-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{n.title}</p>
                  {n.total_bounty_amount > 0 ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                      ${Math.round(n.total_bounty_amount).toLocaleString()} bounty
                    </span>
                  ) : null}
                </div>
                {n.category ? (
                  <p className="mt-1 text-xs uppercase tracking-wide text-ui-fg-muted">
                    {n.category}
                  </p>
                ) : null}
                <p className="mt-2 line-clamp-2 text-sm text-ui-fg-subtle">
                  {n.description}
                </p>
              </LocalizedClientLink>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

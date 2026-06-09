import type { Metadata } from "next"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { getOpportunity } from "@/lib/data/discovery"

export const metadata: Metadata = {
  title: "Opportunity",
}

const dollars = (cents?: number | null) =>
  cents == null ? "—" : `$${(cents / 100).toLocaleString()}`

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ subject: string }>
}) {
  const { subject } = await params
  const data = await getOpportunity(subject)

  if (!data) {
    return (
      <main className="container py-10">
        <h1 className="text-2xl font-semibold capitalize">{subject}</h1>
        <p className="mt-2 text-ui-fg-subtle">
          No opportunity data yet for this subject.
        </p>
        <LocalizedClientLink
          href="/opportunities"
          className="mt-4 inline-block text-green-700 hover:underline"
        >
          ← All opportunities
        </LocalizedClientLink>
      </main>
    )
  }

  const guides = data.startup_requirements || []
  const trend = data.price_trend || {}

  return (
    <main className="container py-10">
      <LocalizedClientLink
        href="/opportunities"
        className="text-sm text-green-700 hover:underline"
      >
        ← All opportunities
      </LocalizedClientLink>
      <header className="mt-2 mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-semibold capitalize">
          {data.subject_key}
        </h1>
        <span className="rounded-full bg-green-100 px-3 py-1 text-lg font-bold text-green-800">
          {Number(data.opportunity_score).toFixed(1)}
        </span>
      </header>

      <section className="mb-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border p-4">
          <p className="text-xs uppercase text-ui-fg-subtle">Demand</p>
          <p className="text-lg font-semibold">{data.bands?.demand ?? "—"}</p>
          <p className="text-xs text-ui-fg-subtle">
            {data.market_demand?.openDemandPosts ?? 0} open needs ·{" "}
            {data.market_demand?.wishlistCount ?? 0} wishlists
          </p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="text-xs uppercase text-ui-fg-subtle">Competition</p>
          <p className="text-lg font-semibold">
            {data.bands?.competition ?? "—"}
          </p>
          <p className="text-xs text-ui-fg-subtle">
            {data.competition?.activeSellers ?? 0} sellers ·{" "}
            {data.competition?.activeListings ?? 0} listings
          </p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="text-xs uppercase text-ui-fg-subtle">Price trend</p>
          <p className="text-lg font-semibold capitalize">
            {trend.direction ?? "—"}
          </p>
          <p className="text-xs text-ui-fg-subtle">
            {trend.pctChange != null
              ? `${trend.pctChange > 0 ? "+" : ""}${trend.pctChange}%`
              : ""}
          </p>
        </div>
      </section>

      {guides.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">Startup requirements</h2>
          {guides.map((g: any) => (
            <div key={g.slug} className="mb-4 rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <LocalizedClientLink
                  href={`/start-business/${g.slug}`}
                  className="font-semibold hover:text-green-700"
                >
                  {g.title}
                </LocalizedClientLink>
                <span className="text-sm text-ui-fg-subtle">
                  est. {dollars(g.estimated_startup_cost_cents)}
                </span>
              </div>
              {g.required_equipment?.length ? (
                <ul className="mt-2 list-inside list-disc text-sm text-ui-fg-subtle">
                  {g.required_equipment.slice(0, 5).map((e: string, i: number) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </section>
      )}

      <section className="grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-3 text-xl font-semibold">Related products</h2>
          {data.related_products?.length ? (
            <ul className="flex flex-col gap-1">
              {data.related_products.map((p: any) => (
                <li key={p.id}>
                  <LocalizedClientLink
                    href={`/products/${p.handle}`}
                    className="text-sm hover:text-green-700"
                  >
                    {p.title}
                  </LocalizedClientLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ui-fg-subtle">None yet.</p>
          )}
        </div>
        <div>
          <h2 className="mb-3 text-xl font-semibold">Related coalitions</h2>
          {data.related_coalitions?.length ? (
            <ul className="flex flex-col gap-1">
              {data.related_coalitions.map((c: any) => (
                <li key={c.id} className="text-sm">
                  {c.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ui-fg-subtle">None yet.</p>
          )}
        </div>
      </section>
    </main>
  )
}

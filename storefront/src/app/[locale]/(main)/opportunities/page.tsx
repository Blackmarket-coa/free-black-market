import type { Metadata } from "next"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { listOpportunities, type OpportunityRow } from "@/lib/data/discovery"

export const metadata: Metadata = {
  title: "Opportunities",
  description:
    "Discover what to produce: local-production opportunities ranked by demand, competition, and startup cost.",
}

const band = (v: number) => (v >= 0.66 ? "High" : v >= 0.33 ? "Medium" : "Low")

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>
}) {
  const { region } = await searchParams
  let opportunities: OpportunityRow[] = []
  try {
    opportunities = await listOpportunities({ region: region || "US", limit: 50 })
  } catch {
    opportunities = []
  }

  return (
    <main className="container py-10">
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-green-700">
          Opportunity Engine
        </p>
        <h1 className="text-3xl font-semibold">Local-production opportunities</h1>
        <p className="mt-2 max-w-2xl text-ui-fg-subtle">
          Where demand is high, competition is low, and startup cost is
          manageable. Scored 0–10 from live marketplace signals.
        </p>
      </header>

      {opportunities.length === 0 ? (
        <div className="rounded-md border p-6 text-sm text-ui-fg-subtle">
          No scored opportunities yet — they populate as demand builds.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {opportunities.map((o) => (
            <LocalizedClientLink
              key={o.id}
              href={`/opportunities/${encodeURIComponent(o.subject_key)}`}
              className="flex flex-col rounded-xl border p-4 hover:border-green-600"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold capitalize">
                  {o.subject_label || o.subject_key}
                </span>
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-sm font-bold text-green-800">
                  {o.opportunity_score.toFixed(1)}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-ui-fg-subtle">
                <div>
                  <dt>Demand</dt>
                  <dd className="font-medium text-ui-fg-base">
                    {band(o.demand)}
                  </dd>
                </div>
                <div>
                  <dt>Competition</dt>
                  <dd className="font-medium text-ui-fg-base">
                    {band(o.competition)}
                  </dd>
                </div>
                <div>
                  <dt>Startup</dt>
                  <dd className="font-medium text-ui-fg-base">
                    {band(o.startup_cost)}
                  </dd>
                </div>
              </dl>
            </LocalizedClientLink>
          ))}
        </div>
      )}
    </main>
  )
}

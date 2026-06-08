import type { Metadata } from "next"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { listStartupGuides, type StartupGuideSummary } from "@/lib/data/discovery"

export const metadata: Metadata = {
  title: "Start a Business",
  description:
    "Step-by-step startup guides — seedlings, compost, soap, market gardening.",
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString()}`

export default async function StartBusinessPage() {
  let guides: StartupGuideSummary[] = []
  try {
    guides = await listStartupGuides()
  } catch {
    guides = []
  }

  return (
    <main className="container py-10">
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-green-700">
          Business Launch System
        </p>
        <h1 className="text-3xl font-semibold">Start a business</h1>
        <p className="mt-2 max-w-2xl text-ui-fg-subtle">
          Proven micro-business playbooks with estimated costs, equipment, and a
          path straight into the Launch Center.
        </p>
      </header>

      {guides.length === 0 ? (
        <div className="rounded-md border p-6 text-sm text-ui-fg-subtle">
          No startup guides available yet.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {guides.map((g) => (
            <LocalizedClientLink
              key={g.slug}
              href={`/start-business/${g.slug}`}
              className="flex flex-col rounded-xl border p-4 hover:border-green-600"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{g.title}</span>
                <span className="text-xs text-ui-fg-subtle">{g.difficulty}</span>
              </div>
              <span className="mt-2 line-clamp-2 text-sm text-ui-fg-subtle">
                {g.summary}
              </span>
              <span className="mt-3 text-sm font-medium text-green-700">
                est. {dollars(g.estimated_startup_cost_cents)} to start
              </span>
            </LocalizedClientLink>
          ))}
        </div>
      )}
    </main>
  )
}

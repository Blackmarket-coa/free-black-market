import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { listDemandPools, type DemandPool } from "@/lib/data/collective"

/**
 * Homepage bounty/needs board. Surfaces open collective demand pools (the FBM
 * "what to make / promote" signal) without exposing vendor-only routes.
 * Renders nothing if there are no open pools or the backend is unavailable.
 */
export async function HomeOpportunityBoard() {
  let pools: DemandPool[] = []
  try {
    pools = await listDemandPools({ sort_by: "attractiveness", limit: 6 })
  } catch {
    return null
  }

  if (!pools.length) {
    return null
  }

  return (
    <section className="px-4 lg:px-8 w-full">
      <div className="rounded-2xl border p-6 md:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-green-700">
              Opportunities &amp; bounties
            </p>
            <h2 className="text-2xl md:text-3xl font-semibold">
              What the community needs right now
            </h2>
          </div>
          <LocalizedClientLink
            href="/collective/demand-pools"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            View all
          </LocalizedClientLink>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pools.map((pool) => {
            const progress = Math.min(
              100,
              Math.round(
                (Number(pool.committed_quantity) /
                  Number(pool.target_quantity || 1)) *
                  100
              )
            )
            return (
              <LocalizedClientLink
                key={pool.id}
                href={`/collective/demand-pools/${pool.id}`}
                className="rounded-xl border p-4 transition-colors hover:border-green-400 hover:bg-green-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{pool.title}</p>
                  {pool.category ? (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {pool.category}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-gray-600">
                  {pool.description}
                </p>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-green-600"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-ui-fg-subtle">
                  {progress}% committed
                </p>
              </LocalizedClientLink>
            )
          })}
        </div>
      </div>
    </section>
  )
}

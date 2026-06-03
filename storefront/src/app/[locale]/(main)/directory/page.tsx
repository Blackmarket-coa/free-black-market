import type { Metadata } from "next"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { listDirectory, type DirectoryProducer } from "@/lib/data/directory"

export const metadata: Metadata = {
  title: "Producer Directory",
  description:
    "Search producers and the stores they sell through — on FBM and across Etsy, Shopify, farmers markets, and more.",
}

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; region?: string; platform?: string }>
}) {
  const { q, region, platform } = await searchParams

  let producers: DirectoryProducer[] = []
  try {
    producers = await listDirectory({ q, region, platform, limit: 60 })
  } catch {
    producers = []
  }

  return (
    <main className="container py-10">
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-green-700">
          Commerce Hub
        </p>
        <h1 className="text-3xl font-semibold">Producer directory</h1>
        <p className="mt-2 max-w-2xl text-ui-fg-subtle">
          Find producers and everywhere they sell — on FBM and across external
          stores.
        </p>
      </header>

      {/* Filters (GET form, no client JS needed) */}
      <form
        method="get"
        className="mb-8 flex flex-wrap items-end gap-3 rounded-xl border p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ui-fg-subtle" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Name, region…"
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ui-fg-subtle" htmlFor="region">
            Region
          </label>
          <input
            id="region"
            name="region"
            defaultValue={region ?? ""}
            placeholder="SC"
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            className="text-xs font-medium text-ui-fg-subtle"
            htmlFor="platform"
          >
            Sells on
          </label>
          <select
            id="platform"
            name="platform"
            defaultValue={platform ?? ""}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Any platform</option>
            <option value="etsy">Etsy</option>
            <option value="shopify">Shopify</option>
            <option value="amazon">Amazon</option>
            <option value="ebay">eBay</option>
            <option value="farmers_market">Farmers Market</option>
            <option value="website">Website</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800"
        >
          Filter
        </button>
      </form>

      {producers.length === 0 ? (
        <div className="rounded-md border p-6 text-sm text-ui-fg-subtle">
          No producers match these filters.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {producers.map((p) => (
            <div key={p.id} className="flex flex-col rounded-xl border p-4">
              <div className="flex items-center justify-between gap-2">
                <LocalizedClientLink
                  href={`/producers/${p.handle}`}
                  className="font-semibold hover:text-green-700"
                >
                  {p.name}
                </LocalizedClientLink>
                {p.verified ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                    Verified
                  </span>
                ) : null}
              </div>
              {p.region ? (
                <p className="mt-1 text-xs uppercase tracking-wide text-ui-fg-muted">
                  {p.region}
                </p>
              ) : null}
              {p.description ? (
                <p className="mt-2 line-clamp-2 text-sm text-ui-fg-subtle">
                  {p.description}
                </p>
              ) : null}

              {p.external_stores.length > 0 ? (
                <div className="mt-3 border-t pt-3">
                  <p className="mb-1 text-xs text-ui-fg-subtle">Also sells on:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {p.external_stores.map((s, i) => (
                      <a
                        key={`${s.platform}-${i}`}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded border px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-50"
                      >
                        {s.name}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

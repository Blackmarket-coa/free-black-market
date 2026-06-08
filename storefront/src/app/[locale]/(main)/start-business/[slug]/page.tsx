import type { Metadata } from "next"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { getStartupGuide } from "@/lib/data/discovery"

export const metadata: Metadata = {
  title: "Startup Guide",
}

const dollars = (cents?: number) =>
  cents == null ? "—" : `$${(cents / 100).toLocaleString()}`

export default async function StartupGuideDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const data = await getStartupGuide(slug)
  const guide = data?.guide

  if (!guide) {
    return (
      <main className="container py-10">
        <h1 className="text-2xl font-semibold">Guide not found</h1>
        <LocalizedClientLink
          href="/start-business"
          className="mt-4 inline-block text-green-700 hover:underline"
        >
          ← Start a business
        </LocalizedClientLink>
      </main>
    )
  }

  return (
    <main className="container max-w-3xl py-10">
      <LocalizedClientLink
        href="/start-business"
        className="text-sm text-green-700 hover:underline"
      >
        ← Start a business
      </LocalizedClientLink>
      <header className="mt-2 mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">{guide.title}</h1>
          <p className="mt-2 text-ui-fg-subtle">{guide.summary}</p>
        </div>
        <span className="whitespace-nowrap rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-800">
          est. {dollars(guide.estimated_startup_cost_cents)}
        </span>
      </header>

      <div className="mb-8 flex gap-3">
        <LocalizedClientLink
          href={`/opportunities/${guide.related_opportunity_key}`}
          className="rounded-lg border px-4 py-2 text-sm font-semibold hover:border-green-600"
        >
          View market opportunity →
        </LocalizedClientLink>
        <LocalizedClientLink
          href="/sell"
          className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800"
        >
          Launch this business
        </LocalizedClientLink>
      </div>

      <section className="mb-6 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-xl font-semibold">Required equipment</h2>
          <ul className="list-inside list-disc text-ui-fg-subtle">
            {(guide.required_equipment || []).map((e: string, i: number) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 text-xl font-semibold">Production tips</h2>
          <ul className="list-inside list-disc text-ui-fg-subtle">
            {(guide.production_suggestions || []).map((s: string, i: number) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </section>

      {data.related_coalitions?.length ? (
        <section>
          <h2 className="mb-2 text-xl font-semibold">Related coalitions</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {data.related_coalitions.map((c: any) => (
              <li key={c.id}>{c.name}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}

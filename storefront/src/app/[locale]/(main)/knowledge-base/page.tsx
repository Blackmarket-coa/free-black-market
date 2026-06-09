import type { Metadata } from "next"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { listKnowledgeBase, type KbArticleSummary } from "@/lib/data/discovery"

export const metadata: Metadata = {
  title: "Knowledge Base",
  description:
    "DIY guides, container gardening, and make-vs-buy substitution guides.",
}

const TYPES = [
  { value: "", label: "All" },
  { value: "DIY", label: "DIY" },
  { value: "CONTAINER_GARDENING", label: "Container Gardening" },
  { value: "SUBSTITUTION", label: "Substitution" },
]

export default async function KnowledgeBasePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; q?: string }>
}) {
  const { type, q } = await searchParams
  let articles: KbArticleSummary[] = []
  try {
    articles = await listKnowledgeBase({ type, q })
  } catch {
    articles = []
  }

  return (
    <main className="container py-10">
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-green-700">
          Make It Yourself
        </p>
        <h1 className="text-3xl font-semibold">Knowledge base</h1>
        <p className="mt-2 max-w-2xl text-ui-fg-subtle">
          DIY recipes, container-gardening guides, and make-vs-buy comparisons.
        </p>
      </header>

      <form method="get" className="mb-8 flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ui-fg-subtle" htmlFor="type">
            Type
          </label>
          <select
            id="type"
            name="type"
            defaultValue={type ?? ""}
            className="rounded-md border px-3 py-2 text-sm"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ui-fg-subtle" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ""}
            placeholder="compost, detergent…"
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800"
        >
          Filter
        </button>
      </form>

      {articles.length === 0 ? (
        <div className="rounded-md border p-6 text-sm text-ui-fg-subtle">
          No guides match these filters.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((a) => (
            <LocalizedClientLink
              key={a.slug}
              href={`/knowledge-base/${a.slug}`}
              className="flex flex-col rounded-xl border p-4 hover:border-green-600"
            >
              <span className="text-xs uppercase tracking-wide text-ui-fg-muted">
                {a.type.replace("_", " ").toLowerCase()}
                {a.difficulty ? ` · ${a.difficulty}` : ""}
              </span>
              <span className="mt-1 font-semibold">{a.title}</span>
              <span className="mt-2 line-clamp-2 text-sm text-ui-fg-subtle">
                {a.summary}
              </span>
            </LocalizedClientLink>
          ))}
        </div>
      )}
    </main>
  )
}

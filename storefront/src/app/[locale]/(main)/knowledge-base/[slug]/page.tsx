import type { Metadata } from "next"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { getKbArticle } from "@/lib/data/discovery"

export const metadata: Metadata = {
  title: "Guide",
}

export default async function KbArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const article = await getKbArticle(slug)

  if (!article) {
    return (
      <main className="container py-10">
        <h1 className="text-2xl font-semibold">Guide not found</h1>
        <LocalizedClientLink
          href="/knowledge-base"
          className="mt-4 inline-block text-green-700 hover:underline"
        >
          ← Knowledge base
        </LocalizedClientLink>
      </main>
    )
  }

  const materials: string[] = Array.isArray(article.materials)
    ? article.materials
    : []
  const steps: string[] = Array.isArray(article.steps) ? article.steps : []

  return (
    <main className="container max-w-3xl py-10">
      <LocalizedClientLink
        href="/knowledge-base"
        className="text-sm text-green-700 hover:underline"
      >
        ← Knowledge base
      </LocalizedClientLink>
      <header className="mt-2 mb-6">
        <p className="text-xs uppercase tracking-wide text-ui-fg-muted">
          {String(article.type).replace("_", " ").toLowerCase()}
          {article.difficulty ? ` · ${article.difficulty}` : ""}
          {article.contributed_by_community ? " · community" : ""}
        </p>
        <h1 className="text-3xl font-semibold">{article.title}</h1>
        <p className="mt-2 text-ui-fg-subtle">{article.summary}</p>
      </header>

      {article.body ? (
        <p className="mb-6 text-ui-fg-base">{article.body}</p>
      ) : null}

      {materials.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xl font-semibold">Materials</h2>
          <ul className="list-inside list-disc text-ui-fg-subtle">
            {materials.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </section>
      )}

      {steps.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xl font-semibold">Steps</h2>
          <ol className="list-inside list-decimal space-y-1 text-ui-fg-base">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      )}
    </main>
  )
}

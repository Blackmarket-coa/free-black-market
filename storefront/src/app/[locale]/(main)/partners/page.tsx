import type { Metadata } from "next"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { listPartners, type Partner, type PartnerDirectory } from "@/lib/data/partners"

export const metadata: Metadata = {
  title: "Lenders & Partners",
  description:
    "CDFIs, credit unions, microlenders, crowdfunders, and free legal and business help for vendors. FBM links out and never stands in between.",
}

const KIND_LABELS: Record<string, string> = {
  cdfi: "CDFI (community development lender)",
  credit_union: "Credit union",
  community_bank: "Community bank",
  microlender: "Microlender",
  crowdfunder: "Crowdfunder",
  legal: "Legal help",
  back_office: "Business & back-office help",
  fiscal_sponsor: "Fiscal sponsor",
}

const SERVES_LABELS: Record<string, string> = {
  sole_proprietor: "Sole proprietors",
  cooperative: "Cooperatives",
  nonprofit: "Nonprofits",
  farm: "Farms",
}

const label = (map: Record<string, string>, key: string) => map[key] ?? key

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; state?: string; serves?: string }>
}) {
  const { kind, state, serves } = await searchParams

  let directory: PartnerDirectory = { partners: [], count: 0, kinds: [], serves: [] }
  let failed = false
  try {
    directory = await listPartners({ kind, state, serves })
  } catch {
    failed = true
  }

  const kinds = directory.kinds.length ? directory.kinds : (Object.keys(KIND_LABELS) as Partner["kind"][])
  const audiences = directory.serves.length ? directory.serves : (Object.keys(SERVES_LABELS) as Partner["serves"])

  return (
    <main className="container py-10">
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-green-700">
          Community Resources
        </p>
        <h1 className="text-3xl font-semibold">Lenders &amp; partners</h1>
        <p className="mt-2 max-w-2xl text-ui-fg-subtle">
          Where vendors go for capital, legal help and business support that FBM does not
          provide itself. Every entry is a link to the partner&apos;s own page: FBM does not
          lend, does not hand your application to anyone, and is not paid for a referral.
        </p>
      </header>

      {/* Filters (GET form, no client JS needed) */}
      <form
        method="get"
        className="mb-8 flex flex-wrap items-end gap-3 rounded-xl border p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ui-fg-subtle" htmlFor="kind">
            Type
          </label>
          <select
            id="kind"
            name="kind"
            defaultValue={kind ?? ""}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Any type</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {label(KIND_LABELS, k)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ui-fg-subtle" htmlFor="serves">
            For
          </label>
          <select
            id="serves"
            name="serves"
            defaultValue={serves ?? ""}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Anyone</option>
            {audiences.map((s) => (
              <option key={s} value={s}>
                {label(SERVES_LABELS, s)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ui-fg-subtle" htmlFor="state">
            State
          </label>
          <input
            id="state"
            name="state"
            defaultValue={state ?? ""}
            placeholder="SC"
            maxLength={2}
            className="w-20 rounded-md border px-3 py-2 text-sm uppercase"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800"
        >
          Filter
        </button>
      </form>

      {failed ? (
        <div className="rounded-md border p-6 text-sm text-ui-fg-subtle">
          The directory could not be loaded right now. Please try again shortly.
        </div>
      ) : directory.partners.length === 0 ? (
        <div className="rounded-md border p-6 text-sm text-ui-fg-subtle">
          No partners match these filters.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {directory.partners.map((p) => (
            <article key={p.key} className="flex flex-col rounded-xl border p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{p.name}</h2>
                <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                  {label(KIND_LABELS, p.kind)}
                </span>
              </div>
              <p className="mt-1 text-xs uppercase tracking-wide text-ui-fg-muted">
                {p.states === "national" ? "National" : p.states.join(", ")} ·{" "}
                {p.serves.map((s) => label(SERVES_LABELS, s)).join(", ")}
              </p>
              <p className="mt-2 text-sm text-ui-fg-subtle">{p.tagline}</p>
              <p className="mt-2 text-sm">{p.products}</p>
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block text-sm font-medium text-blue-700 underline"
              >
                Visit {p.name} ↗
              </a>
            </article>
          ))}
        </div>
      )}

      <p className="mt-10 text-xs text-ui-fg-subtle">
        Looking for readiness help before you apply? The{" "}
        <LocalizedClientLink href="/quests" className="underline">
          vendor quests
        </LocalizedClientLink>{" "}
        assemble the evidence a lender asks for from your own FBM record.
      </p>
    </main>
  )
}

import Link from "next/link"

import {
  LEGAL_EFFECTIVE_DATE,
  LEGAL_REVIEW_STATUS,
} from "@/lib/constants/legal"

/**
 * Shared shell for Terms, Privacy and Refunds.
 *
 * Content is passed as data rather than JSX so the prose lives in plain string
 * constants: apostrophes and quotes in legal text would otherwise have to be
 * hand-escaped for `react/no-unescaped-entities` in every paragraph, and one
 * missed escape is a build failure in a page nobody edits often.
 */

export type LegalBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "note"; title: string; text: string }

export type LegalSection = {
  id: string
  heading: string
  blocks: LegalBlock[]
}

const Block = ({ block }: { block: LegalBlock }) => {
  if (block.kind === "p") {
    return <p className="text-sm leading-6 text-gray-700 mb-3">{block.text}</p>
  }
  if (block.kind === "list") {
    return (
      <ul className="list-disc pl-5 mb-3 space-y-1.5">
        {block.items.map((item, i) => (
          <li key={i} className="text-sm leading-6 text-gray-700">
            {item}
          </li>
        ))}
      </ul>
    )
  }
  return (
    <div className="rounded-xl border bg-neutral-50 p-4 mb-3">
      <p className="font-semibold text-sm mb-1">{block.title}</p>
      <p className="text-sm leading-6 text-gray-700">{block.text}</p>
    </div>
  )
}

export const LegalPage = ({
  title,
  summary,
  sections,
}: {
  title: string
  summary: string
  sections: LegalSection[]
}) => (
  <div className="bg-white min-h-screen">
    <section className="bg-slate-950 text-white py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <p className="uppercase tracking-wide text-slate-300 text-sm font-semibold">
          Legal
        </p>
        <h1 className="text-3xl md:text-4xl font-bold mt-2 mb-3">{title}</h1>
        <p className="text-slate-200 max-w-3xl">{summary}</p>
        <p className="text-slate-400 text-sm mt-4">
          {`Effective ${LEGAL_EFFECTIVE_DATE}`}
        </p>
      </div>
    </section>

    {LEGAL_REVIEW_STATUS ? (
      <div className="bg-amber-50 border-y border-amber-300">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-sm text-amber-900">
            <span className="font-semibold">{"Not yet legally reviewed. "}</span>
            {LEGAL_REVIEW_STATUS}
          </p>
        </div>
      </div>
    ) : null}

    <nav className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {sections.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className="text-sm underline text-gray-600">
              {s.heading}
            </a>
          </li>
        ))}
      </ul>
    </nav>

    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="mb-10 scroll-mt-20">
          <h2 className="text-xl md:text-2xl font-semibold mb-4">
            {section.heading}
          </h2>
          {section.blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </section>
      ))}

      <div className="rounded-2xl border p-6 flex flex-wrap gap-3">
        <Link href="/legal/terms" className="text-sm underline">
          Terms of Service
        </Link>
        <Link href="/legal/privacy" className="text-sm underline">
          Privacy Policy
        </Link>
        <Link href="/legal/refunds" className="text-sm underline">
          Refunds and Returns
        </Link>
        <Link href="/buyer-protection" className="text-sm underline">
          Buyer Protection
        </Link>
      </div>
    </div>
  </div>
)

import type { Metadata } from "next"
import Link from "next/link"

import { TrustBadge, VerificationBadge } from "@/components/molecules/TrustIndicators/TrustIndicators"
import { getVerificationCriteria } from "@/lib/data/verification"

export const metadata: Metadata = {
  title: "How Verification Works | Free Black Market",
  description:
    "What a verified maker on Free Black Market has actually proven — the levels, the checks behind each one, and what every badge means.",
}

/**
 * The rules behind the badges.
 *
 * The homepage has always said "verified makers". Until this page there was
 * nowhere to find out what that meant, which made it an assertion rather than a
 * signal. Everything here is served from the same `BADGE_CONFIG` and threshold
 * table the reviewer grants against, so the published meaning and the granted
 * meaning cannot come apart.
 */
export default async function VerificationPage() {
  const criteria = await getVerificationCriteria()

  return (
    <div className="bg-white min-h-screen">
      <section className="bg-slate-950 text-white py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="uppercase tracking-wide text-slate-300 text-sm font-semibold">
            Verification
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mt-2 mb-4">
            What &ldquo;verified&rdquo; actually means here
          </h1>
          <p className="text-lg text-slate-200 max-w-3xl">
            Plenty of marketplaces call their sellers verified without saying
            what was checked. These are our levels, the checks behind each one,
            and what every badge on a seller&apos;s page is claiming. If a badge
            appears on a profile, a reviewer granted it against this table.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="text-2xl md:text-3xl font-semibold mb-2">
          The five levels
        </h2>
        <p className="text-gray-600 mb-6 max-w-3xl">
          A seller&apos;s level is earned by passing checks, and it moves as
          checks are passed or lapse. It is not a rating of how good a seller is
          — it is a statement of how much we have confirmed.
        </p>
        <div className="space-y-4">
          {criteria.levels.map((level) => (
            <div key={level.level} className="rounded-xl border p-5">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <VerificationBadge level={level.level} />
                <span className="text-sm text-gray-500">
                  trust score {level.min_trust_score}+
                </span>
              </div>
              <p className="text-sm text-gray-700">{level.summary}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <h2 className="text-2xl md:text-3xl font-semibold mb-2">
          What we check
        </h2>
        <p className="text-gray-600 mb-6 max-w-3xl">
          Each check is reviewed by a person against documentation the seller
          supplies. Passing one contributes to the trust score that sets the
          level above.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {criteria.checks.map((check) => (
            <div key={check.check_type} className="rounded-xl border p-5">
              <p className="font-semibold mb-1">
                {check.check_type.replace(/_/g, " ").toLowerCase()}
              </p>
              <p className="text-sm text-gray-600">{check.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <h2 className="text-2xl md:text-3xl font-semibold mb-2">The badges</h2>
        <p className="text-gray-600 mb-6 max-w-3xl">
          Badges sit alongside the level and describe something specific about a
          seller. Badges asserting an external certification are only granted
          once we have the issuing document or certificate number on file.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {criteria.badges.map((badge) => (
            <div key={badge.badge_type} className="rounded-xl border p-5">
              <div className="flex items-center gap-2 mb-2">
                <TrustBadge badgeType={badge.badge_type} showTooltip={false} />
              </div>
              <p className="text-sm text-gray-600">{badge.description}</p>
              {badge.learnMoreUrl && (
                <a
                  href={badge.learnMoreUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-green-700 underline mt-2 inline-block"
                >
                  About this certification
                </a>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <div className="rounded-2xl border bg-neutral-50 p-6 md:p-8">
          <h2 className="text-xl font-semibold mb-3">
            What verification is not
          </h2>
          <ul className="space-y-2 text-sm text-gray-700">
            <li className="flex gap-2">
              <span className="text-gray-400">•</span>
              <span>
                It is not a guarantee of quality. A Certified seller can still
                send you something you don&apos;t like.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-gray-400">•</span>
              <span>
                It is not permanent. Certifications lapse, and a badge granted
                on documentation that turns out to be wrong is withdrawn.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-gray-400">•</span>
              <span>
                A New Provider is not a warning. Every seller starts there, and
                plenty never need more than that to sell honestly.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-gray-400">•</span>
              <span>
                It cannot be bought. No plan, add-on, or fee tier grants or
                accelerates a level or a badge.
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="rounded-2xl border border-green-200 bg-green-50 p-6 md:p-8 flex flex-wrap items-center gap-3 justify-between">
          <p className="font-medium text-green-900">
            Selling here? Verification is opt-in and free.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/sell"
              className="rounded-lg bg-green-700 px-4 py-2 text-white text-sm font-medium"
            >
              Join as a vendor
            </Link>
            <Link
              href="/transparency"
              className="rounded-lg border border-green-300 px-4 py-2 text-green-900 text-sm font-medium"
            >
              See what we charge
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

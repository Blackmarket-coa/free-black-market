import type { Metadata } from "next"
import Link from "next/link"

import { getKarmaLadder } from "@/lib/data/progression"

export const metadata: Metadata = {
  title: "The KARMA Ladder | Free Black Market",
  description:
    "What each grower tier pays, how much KARMA it takes to get there, how KARMA is earned, and which plans skip you up the ladder.",
}

/**
 * The tier ladder, public.
 *
 * `/character` and `/rewards` render progression well but are both login-gated,
 * so a prospective vendor could not see the benefit ladder before signing up —
 * which is the one moment a tier system is supposed to be doing work. Numbers
 * come from `/store/karma-ladder`, which reads the same `GROWER_TIERS` table the
 * payout code pays against.
 */
export default async function KarmaPage() {
  const ladder = await getKarmaLadder()

  const maxKarma = Math.max(...ladder.tiers.map((tier) => tier.karma_required))

  return (
    <div className="bg-white min-h-screen">
      <section className="bg-slate-950 text-white py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="uppercase tracking-wide text-slate-300 text-sm font-semibold">
            Progression
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mt-2 mb-4">
            The KARMA ladder
          </h1>
          <p className="text-lg text-slate-200 max-w-3xl">
            Growers selling through a hub move up a five-rung ladder as they
            trade. Each rung raises the share of a sale they keep and opens up
            more of the network. Here is the whole thing — thresholds, splits,
            and the ways it can be short-circuited.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="text-2xl md:text-3xl font-semibold mb-6">The five tiers</h2>
        <div className="space-y-3">
          {ladder.tiers.map((tier) => (
            <div key={tier.name} className="rounded-xl border p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <div className="flex items-baseline gap-3">
                  <span className="text-xl font-semibold">{tier.name}</span>
                  <span className="text-sm text-gray-500">
                    {tier.karma_required === 0
                      ? "from the start"
                      : `${tier.karma_required.toLocaleString()} KARMA`}
                  </span>
                </div>
                <span className="text-xl font-semibold text-green-700">
                  {tier.split_pct}% split
                </span>
              </div>
              {/*
                Bar is positioned by threshold, so the visual spacing matches
                how much further each rung actually is — the jump to the top
                tier is three times the one before it, and a ladder drawn with
                even rungs would hide that.
              */}
              <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden mb-3">
                <div
                  className="h-full bg-green-600"
                  style={{
                    width: `${maxKarma > 0 ? Math.max(2, (tier.karma_required / maxKarma) * 100) : 2}%`,
                  }}
                />
              </div>
              <p className="text-sm text-gray-600">{tier.unlocks}</p>
              {tier.karma_to_next !== null && (
                <p className="text-sm text-gray-500 mt-2">
                  {tier.karma_to_next.toLocaleString()} more KARMA to the next
                  rung.
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <h2 className="text-2xl md:text-3xl font-semibold mb-2">
          How KARMA is earned
        </h2>
        <p className="text-gray-600 mb-6 max-w-3xl">
          Only by trading and by doing it well. There is nothing to click daily
          and no streak to protect.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ladder.earning.map((rule) => (
            <div key={rule.event} className="rounded-xl border p-4 flex items-baseline justify-between gap-3">
              <span className="text-sm text-gray-700">{rule.description}</span>
              <span className="text-sm font-semibold text-green-700 whitespace-nowrap">
                +{rule.karma}
              </span>
            </div>
          ))}
        </div>
      </section>

      {ladder.plan_floors.length > 0 && (
        <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <div className="rounded-2xl border bg-neutral-50 p-6 md:p-8">
            <h2 className="text-xl font-semibold mb-3">
              Tiers you can buy rather than earn
            </h2>
            <p className="text-sm text-gray-700 mb-4 max-w-3xl">
              Some paid plans start you partway up. We would rather say so than
              let anyone grind toward a rung that was purchasable all along. A
              plan can only ever raise your tier — if you earn a higher one, you
              keep it, including after you stop paying.
            </p>
            <ul className="space-y-2 text-sm text-gray-700">
              {ladder.plan_floors.map((plan) => (
                <li key={plan.code} className="flex gap-2">
                  <span className="text-green-700">•</span>
                  <span>
                    <span className="font-medium">{plan.display_name}</span>{" "}
                    starts you at {plan.grower_tier_floor}.
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="rounded-2xl border border-green-200 bg-green-50 p-6 md:p-8 flex flex-wrap items-center gap-3 justify-between">
          <p className="font-medium text-green-900">
            KARMA itself is only ever earned — and once earned it stays yours.
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

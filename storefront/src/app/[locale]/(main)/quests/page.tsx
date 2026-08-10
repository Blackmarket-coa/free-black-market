import type { Metadata } from "next"
import Link from "next/link"

import { getQuestCatalog } from "@/lib/data/quests"

export const metadata: Metadata = {
  title: "Readiness Quests | Free Black Market",
  description:
    "Turn your trading history into documentation a lender, grant committee, or wholesale buyer will accept — thirteen guided quests, each ending in an exportable packet.",
}

/**
 * The Vendor Quest Engine, published.
 *
 * Thirteen quests ship and are fully wired into the vendor panel, but they sit
 * behind a feature flag and a plan gate, so nobody could see them without
 * already having signed up and paid. This is the platform's most differentiated
 * feature and it was invisible to every prospective vendor.
 *
 * The page states the gating plainly. A catalog that showed thirteen quests
 * without saying they need the Scale plan or an add-on would be the next
 * overclaim in a body of work about not making those.
 */

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(amount / 100)
}

export default async function QuestsPage() {
  const catalog = await getQuestCatalog()

  return (
    <div className="bg-white min-h-screen">
      <section className="bg-slate-950 text-white py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="uppercase tracking-wide text-slate-300 text-sm font-semibold">
            Readiness quests
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mt-2 mb-4">
            Your trading history is documentation
          </h1>
          <p className="text-lg text-slate-200 max-w-3xl">
            The hardest part of getting a loan, a grant, or a first wholesale
            account is proving you already run a real business. You have been
            proving it here every time you sell. These quests assemble that
            record into something the person deciding will actually accept.
          </p>
        </div>
      </section>

      {/* The honest frame, before the catalog. */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-6 md:p-8">
          <h2 className="text-xl font-semibold text-amber-900 mb-3">
            What a quest does and doesn&apos;t do
          </h2>
          <p className="text-sm text-amber-900/90 mb-3">
            We assemble documentation from records you already generated. We do
            not approve anything, and we cannot. The named gatekeeper decides —
            their forms, their criteria, their answer.
          </p>
          <p className="text-sm text-amber-900/90">
            Nothing is invented. Every figure traces to real ledger
            transactions, and anything we can&apos;t evidence from your history
            stays a checklist item for you to complete.
          </p>
        </div>
      </section>

      {catalog.categories.map((category) => (
        <section
          key={category}
          className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-10"
        >
          <h2 className="text-2xl md:text-3xl font-semibold mb-5">{category}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {catalog.quests
              .filter((quest) => quest.category === category)
              .map((quest) => (
                <div key={quest.key} className="rounded-xl border p-5 flex flex-col">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="font-semibold">{quest.title}</h3>
                    {quest.type === "collective" && (
                      <span className="shrink-0 text-xs rounded-full bg-slate-100 px-2 py-0.5">
                        group quest
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mb-3">{quest.outcome}</p>

                  <p className="text-sm text-gray-500 mb-3">
                    Decided by <span className="font-medium">{quest.gatekeeper}</span>
                    {quest.has_packet
                      ? " — ends in a packet you can hand over."
                      : " — unlocks internally rather than producing a packet."}
                  </p>

                  {quest.stages.length > 0 && (
                    <ol className="text-sm text-gray-600 mb-3 flex flex-wrap gap-x-2 gap-y-1">
                      {quest.stages.map((stage, index) => (
                        <li key={stage.key} className="flex items-center gap-2">
                          {index > 0 && <span className="text-gray-300">→</span>}
                          <span>{stage.label}</span>
                        </li>
                      ))}
                    </ol>
                  )}

                  {(quest.requirement_counts.platform ||
                    quest.requirement_counts.assisted) && (
                    <p className="text-sm text-gray-500 mt-auto">
                      {(quest.requirement_counts.platform ?? 0) +
                        (quest.requirement_counts.assisted ?? 0)}{" "}
                      of{" "}
                      {Object.values(quest.requirement_counts).reduce(
                        (total, count) => total + count,
                        0
                      )}{" "}
                      requirements we can evidence from your history.
                    </p>
                  )}

                  {quest.gatekeeper_links.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-3">
                      {quest.gatekeeper_links.map((link) => (
                        <a
                          key={link.url}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-green-700 underline"
                        >
                          {link.label}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </section>
      ))}

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <div className="rounded-2xl border bg-neutral-50 p-6 md:p-8">
          <h2 className="text-xl font-semibold mb-3">How to get access</h2>
          <p className="text-sm text-gray-700 mb-4 max-w-3xl">
            Quests are not part of the free tier. They are also never automatic:
            you choose a quest, dropping one never deletes your records, and no
            quest is ever a condition of selling here.
          </p>
          <ul className="space-y-2 text-sm text-gray-700 mb-4">
            {catalog.access.plans.map((plan) => (
              <li key={plan.code} className="flex gap-2">
                <span className="text-green-700">•</span>
                <span>
                  <span className="font-medium">{plan.display_name}</span> plan —{" "}
                  {formatMoney(plan.price_amount, plan.currency_code)}
                  {plan.interval === "none" ? "" : `/${plan.interval}`}
                </span>
              </li>
            ))}
            {catalog.access.addons.map((addon) => (
              <li key={addon.code} className="flex gap-2">
                <span className="text-green-700">•</span>
                <span>
                  <span className="font-medium">{addon.display_name}</span>{" "}
                  add-on — {formatMoney(addon.price_amount, addon.currency_code)}{" "}
                  for {addon.duration_days} days, no subscription. Buying again
                  extends the window rather than starting a second one.
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-gray-500">
            Quests may not be switched on for your account yet — the engine rolls
            out per node. Ask and we will tell you where it stands.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="rounded-2xl border border-green-200 bg-green-50 p-6 md:p-8 flex flex-wrap items-center gap-3 justify-between">
          <p className="font-medium text-green-900">
            Start trading now; the record builds itself.
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
              What we charge
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

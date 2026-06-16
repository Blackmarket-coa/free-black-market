import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Creators & Vendor Marketing | Free Black Market",
  description:
    "Storefronts, referrals, and audience tools that help makers and creators get discovered and paid — while keeping 97% of every sale.",
}

export default function CreatorsPage() {
  return (
    <div className="bg-white min-h-screen">
      <section className="bg-slate-950 text-white py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="uppercase tracking-wide text-slate-300 text-sm font-semibold">
            Creators &amp; vendor marketing
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mt-2 mb-4">Get discovered. Get paid.</h1>
          <p className="text-lg text-slate-200 max-w-3xl">
            Free Black Market gives makers and creators their own storefront, referral tools,
            and audience features — so you can grow a following and sell directly, while keeping
            97% of every sale.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid gap-5 md:grid-cols-3">
        <article className="rounded-2xl border p-6">
          <h2 className="text-xl font-semibold mb-2">Your own storefront</h2>
          <p className="text-sm text-gray-700">
            A storefront you control — your products, memberships, digital drops, and live
            shows in one place, with vendor-controlled fulfillment and transparent payouts.
          </p>
        </article>
        <article className="rounded-2xl border p-6">
          <h2 className="text-xl font-semibold mb-2">Referrals &amp; audience tools</h2>
          <p className="text-sm text-gray-700">
            Turn your audience into customers with referral links and discovery surfaces that
            help neighbors and followers find your work across the marketplace.
          </p>
        </article>
        <article className="rounded-2xl border p-6">
          <h2 className="text-xl font-semibold mb-2">Keep 97%</h2>
          <p className="text-sm text-gray-700">
            A flat 3% coalition fee — no listing fees, no monthly subscription, and no payment
            processing fees passed to you. Value stays with the people who create it.
          </p>
        </article>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <h2 className="text-2xl md:text-3xl font-bold mb-3">Pick the setup that fits</h2>
        <p className="text-gray-700 mb-6 max-w-3xl">
          When you join, a few quick questions match you to a setup based on what you have — an
          audience, things you make, time, or a space. Creators get memberships, digital goods,
          and a shows calendar out of the box, and you can add more roles any time.
        </p>
        <div className="grid gap-5 md:grid-cols-2">
          <article className="rounded-2xl border p-6">
            <h3 className="text-lg font-semibold mb-2">Memberships &amp; subscriptions</h3>
            <p className="text-sm text-gray-700">
              Offer recurring support and member-only perks, with settlement handled
              transparently so you get paid reliably.
            </p>
          </article>
          <article className="rounded-2xl border p-6">
            <h3 className="text-lg font-semibold mb-2">Digital goods &amp; drops</h3>
            <p className="text-sm text-gray-700">
              Sell downloads and limited releases alongside physical products — one storefront,
              many ways to earn.
            </p>
          </article>
          <article className="rounded-2xl border p-6">
            <h3 className="text-lg font-semibold mb-2">Live shows &amp; events</h3>
            <p className="text-sm text-gray-700">
              Publish events and ticketed shows to bring your community together and turn
              attention into income.
            </p>
          </article>
          <article className="rounded-2xl border p-6">
            <h3 className="text-lg font-semibold mb-2">Built on shared infrastructure</h3>
            <p className="text-sm text-gray-700">
              Creator rewards and payouts settle through the same transparent, community-owned
              ledger that powers the rest of the marketplace.
            </p>
          </article>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="rounded-2xl border bg-green-50 border-green-200 p-6 flex flex-wrap items-center gap-3 justify-between">
          <p className="font-medium text-green-900">Ready to start selling?</p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/sell"
              className="px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-medium"
              data-event="creators_cta_clicked"
            >
              Join as a creator
            </Link>
            <Link
              href="/why-we-exist"
              className="px-4 py-2 rounded-lg border border-green-300 text-green-900 text-sm font-medium"
            >
              Why we exist
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

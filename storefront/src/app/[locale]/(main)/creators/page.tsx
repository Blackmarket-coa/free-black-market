import type { Metadata } from "next"
import Link from "next/link"

import { getFeeSchedule } from "@/lib/data/fee-schedule"
import { processingCopy } from "@/lib/helpers/processing-copy"

// Processing sentences render from /store/fee-schedule (Black Mask F6): today's
// copy exactly while its `processing` field is absent.
export async function generateMetadata(): Promise<Metadata> {
  const { processing, default_fee_percent: feePercent } = await getFeeSchedule()
  return {
    title: "Creators & Vendor Marketing | Free Black Market",
    description: processingCopy("creatorsMetaDescription", processing, feePercent),
  }
}

export default async function CreatorsPage() {
  const { processing, default_fee_percent: feePercent } = await getFeeSchedule()
  return (
    <div className="bg-white min-h-screen">
      <section className="bg-slate-950 text-white py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="uppercase tracking-wide text-slate-300 text-sm font-semibold">
            Creators &amp; vendor marketing
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mt-2 mb-4">Get discovered. Get paid.</h1>
          <p className="text-lg text-slate-200 max-w-3xl">
            {processingCopy("creatorsHero", processing, feePercent)}
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
          <h2 className="text-xl font-semibold mb-2">{processingCopy("creatorsKeepHeading", processing, feePercent)}</h2>
          <p className="text-sm text-gray-700">
            {processingCopy("creatorsKeepBody", processing, feePercent)}
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

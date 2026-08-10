import type { Metadata } from "next"
import Link from "next/link"

import { GITHUB_REPO_URL } from "@/lib/constants/links"

export const metadata: Metadata = {
  title: "Why We Exist | Free Black Market",
  description: "Learn why Free Black Market takes 3%, how community governance works, and the market problems this infrastructure solves.",
}

export default function WhyWeExistPage() {
  return (
    <div className="bg-white min-h-screen">
      <section className="bg-slate-950 text-white py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="uppercase tracking-wide text-slate-300 text-sm font-semibold">Mission and governance</p>
          <h1 className="text-4xl md:text-5xl font-bold mt-2 mb-4">Why We Exist</h1>
          <p className="text-lg text-slate-200 max-w-3xl">We built Free Black Market as a community commerce platform that aligns incentives with local producers and organizers.</p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid gap-5 md:grid-cols-3">
        <article className="rounded-2xl border p-6">
          <h2 className="text-xl font-semibold mb-2">Why 3%</h2>
          <p className="text-sm text-gray-700">A flat coalition fee keeps costs understandable. Vendors keep 97% of each sale — no listing, monthly, or payment processing fees passed to them. Settle through our internal ledger (Coalition Credits) and an internal payment processor, coming soon, to keep even more value inside the community.</p>
        </article>
        <article className="rounded-2xl border p-6">
          <h2 className="text-xl font-semibold mb-2">Why community governance</h2>
          <p className="text-sm text-gray-700">Platform rules should be accountable to the people using the system. Coalitions steer platform-level decisions through petitions and proposals — and because the code is open source, any community that disagrees with the direction has the ultimate exit right: fork it and run it themselves.</p>
        </article>
        <article className="rounded-2xl border p-6">
          <h2 className="text-xl font-semibold mb-2">What problem we solve</h2>
          <p className="text-sm text-gray-700">Most commerce tools optimize for platform extraction — renting your business back to you through fees, ads, and customer lock-in. We optimize for producer earnings, local resilience, and trust, so members own infrastructure instead of paying rent to extractive intermediaries.</p>
        </article>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <h2 className="text-2xl md:text-3xl font-bold mb-3">More than a marketplace: a cooperative economic substrate</h2>
        <p className="text-gray-700 mb-6 max-w-3xl">Our goal is to be the easiest place on the internet for communities to earn together. Beneath the storefront sits shared infrastructure that records every economic event — a marketplace sale, a CSA delivery, a creator reward, a logistics fee, a transfer between members — and settles it transparently.</p>
        <div className="grid gap-5 md:grid-cols-2">
          <article className="rounded-2xl border p-6">
            <h3 className="text-lg font-semibold mb-2">Coalition Credits settlement</h3>
            <p className="text-sm text-gray-700">A shared settlement layer that pays creators and vendors across the ecosystem and settles obligations between coalition members — value stays in the community.</p>
          </article>
          <article className="rounded-2xl border p-6">
            <h3 className="text-lg font-semibold mb-2">Order Cycles &amp; CSA share boxes</h3>
            <p className="text-sm text-gray-700">Time-bounded ordering primitives built for local food: group buys, farm shares, and recurring boxes that connect growers directly to neighbors.</p>
          </article>
          <article className="rounded-2xl border p-6">
            <h3 className="text-lg font-semibold mb-2">Demand pools &amp; bounties</h3>
            <p className="text-sm text-gray-700">Communities pool demand and fund the work they need — from creative projects to local services — with milestone-based, escrowed payouts.</p>
          </article>
          <article className="rounded-2xl border p-6">
            <h3 className="text-lg font-semibold mb-2">Verified vendors &amp; open transparency</h3>
            <p className="text-sm text-gray-700">Vendor verification provides real trust signals, and the open-source codebase makes how the system works — and where money goes — publicly auditable.</p>
          </article>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <h2 className="text-2xl md:text-3xl font-bold mb-3">Who we build for</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div className="rounded-2xl border p-5"><p className="font-semibold mb-1">Shoppers</p><p className="text-gray-700">Buy direct from verified makers at fair prices — no middlemen, no markups.</p></div>
          <div className="rounded-2xl border p-5"><p className="font-semibold mb-1">Producers &amp; agriculture</p><p className="text-gray-700">Growers and food producers reach neighbors through CSA shares and order cycles.</p></div>
          <div className="rounded-2xl border p-5"><p className="font-semibold mb-1">Creators &amp; vendors</p><p className="text-gray-700">Own your storefront, audience, and referrals — and keep 97% of every sale.</p></div>
          <div className="rounded-2xl border p-5"><p className="font-semibold mb-1">Mutual aid &amp; organizers</p><p className="text-gray-700">Run community programs and route giving transparently through a fiscal sponsor.</p></div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="rounded-2xl border bg-green-50 border-green-200 p-6 flex flex-wrap items-center gap-3 justify-between">
          <p className="font-medium text-green-900">Ready to participate?</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/sell" className="px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-medium" data-event="why_we_exist_cta_clicked">Join as a vendor</Link>
            <Link href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" className="px-4 py-2 rounded-lg border border-green-300 text-green-900 text-sm font-medium">Contribute on GitHub</Link>
          </div>
        </div>
      </section>
    </div>
  )
}

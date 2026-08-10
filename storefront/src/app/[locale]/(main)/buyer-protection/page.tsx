import type { Metadata } from "next"
import Link from "next/link"

import { CLAIM_WINDOW_DAYS } from "@/lib/constants/order-claims"

export const metadata: Metadata = {
  title: "Buyer Protection | Free Black Market",
  description:
    "What happens if an order never arrives or isn't what was described — what's covered, how to open a claim, the time limits, and what falls outside.",
}

/**
 * The published buyer-protection policy.
 *
 * Written to match the mechanism that exists rather than the one a marketplace
 * would like to advertise. Three pages previously told buyers their payment was
 * "held until delivery is confirmed"; escrow is real but is wired to collective
 * buys, campaigns, bounties and subcontracts — not ordinary checkout. That copy
 * has been corrected, and this page states what actually protects a buyer.
 */

const COVERED = [
  {
    title: "It never arrived",
    detail:
      "Tracking says delivered but nothing came, or the order never shipped at all. The most common claim, and the one a return request cannot handle — you can't return something you don't have.",
  },
  {
    title: "It isn't what was described",
    detail:
      "Materially different from the listing: wrong item, wrong size or quantity, or a product whose description turns out not to be true.",
  },
  {
    title: "It arrived damaged",
    detail: "Broken, spoiled, or unusable on arrival.",
  },
  {
    title: "Part of the order is missing",
    detail: "Some items came, others didn't, and the seller hasn't resolved it.",
  },
]

const NOT_COVERED = [
  {
    title: "You changed your mind",
    detail:
      "That's a return, not a claim. Many sellers accept returns — check the listing, then request one from your order page.",
  },
  {
    title: "Anything paid for off-platform",
    detail:
      "If you paid a seller directly — bank transfer, cash app, in person — we have no record of the payment and no way to act on it. This is the single biggest reason buyers lose money on any marketplace.",
  },
  {
    title: "Normal variation in handmade and grown goods",
    detail:
      "A jar of preserves or a hand-thrown mug won't be identical to the photo. Genuine misrepresentation is covered; ordinary variation isn't.",
  },
  {
    title: "Delivery delays inside the seller's stated window",
    detail:
      "If the listing says two weeks and it's been nine days, message the seller — a claim would be premature.",
  },
]

export default function BuyerProtectionPage() {
  return (
    <div className="bg-white min-h-screen">
      <section className="bg-slate-950 text-white py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="uppercase tracking-wide text-slate-300 text-sm font-semibold">
            Buyer protection
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mt-2 mb-4">
            If something goes wrong
          </h1>
          <p className="text-lg text-slate-200 max-w-3xl">
            You&apos;re buying from independent makers, growers and small
            businesses, not a warehouse. Most problems are a delay or a mix-up
            the seller can fix faster than we can. When that isn&apos;t enough,
            here is exactly what we&apos;ll do and what the limits are.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="text-2xl md:text-3xl font-semibold mb-6">
          How a claim works
        </h2>
        <ol className="space-y-4">
          {[
            {
              step: "1",
              title: "Message the seller",
              detail:
                "From your order page. Most problems end here, and the seller can usually resolve it faster than a review would. You do not have to wait for a reply before escalating if they've gone quiet.",
            },
            {
              step: "2",
              title: "Open a claim",
              detail: `From the same order page, within ${CLAIM_WINDOW_DAYS} days of the order. Tell us what happened and attach anything that helps — a photo, a tracking screenshot.`,
            },
            {
              step: "3",
              title: "We review it",
              detail:
                "A person reads it, looks at the order and the seller's record, and contacts the seller. We'll come back to you rather than closing it silently.",
            },
            {
              step: "4",
              title: "It gets resolved",
              detail:
                "A refund, a replacement, or an explanation of why we can't act. If we can't resolve it, your card issuer's dispute rights are still available and usually run longer than our window.",
            },
          ].map((item) => (
            <li key={item.step} className="rounded-xl border p-5 flex gap-4">
              <span className="shrink-0 w-8 h-8 rounded-full bg-green-700 text-white flex items-center justify-center font-semibold">
                {item.step}
              </span>
              <div>
                <p className="font-semibold mb-1">{item.title}</p>
                <p className="text-sm text-gray-600">{item.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold mb-4">What&apos;s covered</h2>
            <div className="space-y-3">
              {COVERED.map((item) => (
                <div key={item.title} className="rounded-xl border border-green-200 bg-green-50 p-4">
                  <p className="font-semibold text-green-900 mb-1">{item.title}</p>
                  <p className="text-sm text-green-900/80">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-semibold mb-4">What isn&apos;t</h2>
            <div className="space-y-3">
              {NOT_COVERED.map((item) => (
                <div key={item.title} className="rounded-xl border p-4">
                  <p className="font-semibold mb-1">{item.title}</p>
                  <p className="text-sm text-gray-600">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <div className="rounded-2xl border bg-neutral-50 p-6 md:p-8">
          <h2 className="text-xl font-semibold mb-3">
            Being straight with you about how payment works
          </h2>
          <p className="text-sm text-gray-700 mb-3">
            Some marketplaces say they hold your payment until delivery is
            confirmed. On a standard order here, that is not what happens: the
            seller is paid out on the normal Stripe schedule. Holding every
            small producer&apos;s money for weeks would put a lot of them out of
            business, and we would rather say so than imply an escrow that
            isn&apos;t there.
          </p>
          <p className="text-sm text-gray-700">
            Funds <em>are</em> held in escrow where money is committed before
            anything exists to ship — collective buys, crowdfunding campaigns,
            and creator bounties. Those flows say so at checkout.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="rounded-2xl border border-green-200 bg-green-50 p-6 md:p-8 flex flex-wrap items-center gap-3 justify-between">
          <p className="font-medium text-green-900">
            Got a problem with an order?
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/user/orders"
              className="rounded-lg bg-green-700 px-4 py-2 text-white text-sm font-medium"
            >
              Go to your orders
            </Link>
            <Link
              href="/verification"
              className="rounded-lg border border-green-300 px-4 py-2 text-green-900 text-sm font-medium"
            >
              How sellers are verified
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

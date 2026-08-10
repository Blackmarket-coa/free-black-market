import type { Metadata } from "next"
import Link from "next/link"

import FeeBreakdown from "@/components/sections/FeeBreakdown"
import { WhereYourMoneyGoes } from "@/components/molecules/PriceTransparency/PriceTransparency"
import { getFeeSchedule } from "@/lib/data/fee-schedule"
import { GITHUB_REPO_URL } from "@/lib/constants/links"

export const metadata: Metadata = {
  title: "Fee Transparency | Free Black Market",
  description:
    "Exactly what Free Black Market charges vendors, what it never charges, and how a flat coalition fee compares to Etsy, Shopify, Amazon, Faire, and the delivery apps.",
}

/**
 * The permanent, linkable version of the fee argument.
 *
 * The comparison calculator already existed but was reachable only from
 * `/sell`, behind a vendor-facing funnel — so the one page a sceptical vendor
 * would want to send to a friend did not exist. The rate rendered here comes
 * from `/store/fee-schedule`, which reads the billing catalog that actually
 * charges vendors, so this page cannot quote a number we do not charge.
 */

/** Things we do not charge for. Each is a real absence in the billing catalog. */
const NEVER_CHARGED = [
  {
    label: "Listing fees",
    detail: "Publish as many products as you want. Nothing is charged per listing, per relist, or per photo.",
  },
  {
    label: "Mandatory advertising",
    detail:
      "No offsite-ads programme, and no tier at which promotion becomes compulsory. Etsy's equivalent is 12–15% and cannot be switched off above $10k/year.",
  },
  {
    label: "A monthly subscription to sell",
    detail:
      "The free plan is a real plan, not a trial. Paid plans buy a lower rate and extra tooling; they are never a condition of having a storefront.",
  },
  {
    label: "Payment processing passed through to you",
    detail: "Card processing is absorbed in the coalition fee rather than added on top of it.",
  },
  {
    label: "Fees on shipping or tax",
    detail: "The commission is taken on the item, not on postage you have already paid for or tax you are only collecting.",
  },
  {
    label: "A fee to leave",
    detail:
      "Export your catalogue and your customer list whenever you want. There is no exit fee and no cooling-off period.",
  },
]

/** What the fee funds. Vendors are entitled to know what they are buying. */
const WHAT_THE_FEE_PAYS_FOR = [
  "Hosting, payments infrastructure, and the Stripe Connect payout rail",
  "Storefront, vendor dashboard, and the ordering, fulfilment, and messaging systems behind them",
  "Vendor verification review and dispute handling",
  "The shared ledger that settles value between coalition members",
  "Ongoing development of the open codebase every node runs on",
]

function formatPlanPrice(amount: number, currency: string, interval: string) {
  if (amount === 0) return "Free"
  const price = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(amount / 100)
  return interval === "none" ? price : `${price}/${interval}`
}

export default async function TransparencyPage() {
  const schedule = await getFeeSchedule()
  const { default_fee_percent: feePercent, plans } = schedule
  const producerPercent = Number((100 - feePercent).toFixed(2))

  return (
    <div className="bg-white min-h-screen">
      <section className="bg-slate-950 text-white py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="uppercase tracking-wide text-slate-300 text-sm font-semibold">
            Fee transparency
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mt-2 mb-4">
            We take {feePercent}%. Here is the whole of it.
          </h1>
          <p className="text-lg text-slate-200 max-w-3xl">
            Every marketplace says its fees are fair. Most of them are also
            counting on you not adding them up. So this page shows the
            arithmetic, names what we never charge, and puts our rate next to
            everyone else&apos;s — on the same sale, at the same time.
          </p>
        </div>
      </section>

      {/* The headline split, before any comparison. */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="rounded-2xl border p-6 md:p-8">
          <h2 className="text-2xl md:text-3xl font-semibold mb-2">
            On a $100 sale
          </h2>
          <p className="text-gray-600 mb-6">
            No listing fee to get here, no subscription to stay here, no ad
            spend to be seen here.
          </p>
          <div className="grid sm:grid-cols-3 gap-3 mb-6">
            <div className="rounded-lg border p-4">
              <p className="text-sm text-gray-500">Sale</p>
              <p className="text-2xl font-semibold">$100.00</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-gray-500">Coalition fee ({feePercent}%)</p>
              <p className="text-2xl font-semibold">${feePercent.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-gray-500">You keep</p>
              <p className="text-2xl font-semibold text-green-700">
                ${producerPercent.toFixed(2)}
              </p>
            </div>
          </div>
          <WhereYourMoneyGoes
            producerPercent={producerPercent}
            platformPercent={feePercent}
          />
        </div>
      </section>

      {/* The calculator. Client component; rate injected from the backend. */}
      <FeeBreakdown feePercent={feePercent} />

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <p className="text-xs text-gray-500">
          Competitor figures are drawn from each platform&apos;s published rate
          card and are accurate as of the last review of this page. They are our
          reading of someone else&apos;s pricing, not a live feed — check them
          against the source before making a decision on them. Our own rate is
          read directly from the billing catalog that charges vendors.
        </p>
      </section>

      {/* The plan ladder, straight off the catalog. */}
      {plans.length > 0 && (
        <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h2 className="text-2xl md:text-3xl font-semibold mb-2">
            The full rate ladder
          </h2>
          <p className="text-gray-600 mb-6 max-w-3xl">
            Paid plans buy a lower rate and additional tooling. The rate never
            goes up as you grow — every step down this ladder is optional, and
            the free tier stays exactly where it is.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border rounded-lg">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left font-semibold p-3">Plan</th>
                  <th className="text-left font-semibold p-3">Price</th>
                  <th className="text-left font-semibold p-3">Commission</th>
                  <th className="text-left font-semibold p-3">What it is for</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.code} className="border-t">
                    <td className="p-3 font-medium">
                      {plan.display_name}
                      {plan.is_default && (
                        <span className="ml-2 text-xs rounded-full bg-green-100 text-green-800 px-2 py-0.5">
                          default
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {formatPlanPrice(
                        plan.price_amount,
                        plan.currency_code,
                        plan.interval
                      )}
                    </td>
                    <td className="p-3 font-semibold">
                      {plan.platform_fee_percent}%
                    </td>
                    <td className="p-3 text-gray-600">{plan.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="text-2xl md:text-3xl font-semibold mb-2">
          Fees we will never charge
        </h2>
        <p className="text-gray-600 mb-6 max-w-3xl">
          A take rate is only meaningful alongside the list of things that
          aren&apos;t in it. This is ours.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {NEVER_CHARGED.map((item) => (
            <div key={item.label} className="rounded-xl border p-5">
              <p className="font-semibold mb-1">{item.label}</p>
              <p className="text-sm text-gray-600">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <div className="rounded-2xl border bg-neutral-50 p-6 md:p-8">
          <h2 className="text-2xl font-semibold mb-3">
            What the {feePercent}% pays for
          </h2>
          <ul className="space-y-2 text-sm text-gray-700">
            {WHAT_THE_FEE_PAYS_FOR.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-green-700">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="rounded-2xl border border-green-200 bg-green-50 p-6 md:p-8">
          <h2 className="text-xl font-semibold text-green-900 mb-2">
            Check it yourself
          </h2>
          <p className="text-sm text-green-900/80 mb-4 max-w-2xl">
            The commission is booked as a ledger entry on every order and
            reversed on every refund. The code that does it is public.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/sell"
              className="rounded-lg bg-green-700 px-4 py-2 text-white text-sm font-medium hover:bg-green-800"
            >
              Start selling
            </Link>
            <Link
              href="/why-we-exist"
              className="rounded-lg border border-green-300 px-4 py-2 text-green-900 text-sm font-medium hover:bg-green-100"
            >
              Why we exist
            </Link>
            <Link
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-green-300 px-4 py-2 text-green-900 text-sm font-medium hover:bg-green-100"
              data-event="github_transparency_link_clicked"
            >
              Read the source
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

import type { Metadata } from "next"
import Link from "next/link"
import { featureMatrixBuckets, featureMatrixItemsFor } from "@/data/featureMatrix"
import { getFeeSchedule } from "@/lib/data/fee-schedule"

export const metadata: Metadata = {
  title: "Feature Matrix | Free Black Market",
  description: "Compare currently available and rollout capabilities across goods, services, and community programs.",
}

export default async function FeatureMatrixPage() {
  // The payouts row's processing sentence renders from /store/fee-schedule.
  const { processing, default_fee_percent: feePercent } = await getFeeSchedule()
  const featureMatrixItems = featureMatrixItemsFor(processing, feePercent)
  const availableNowCount = featureMatrixItems.filter((item) => item.status === "Available now").length
  const inRolloutCount = featureMatrixItems.filter((item) => item.status === "In rollout").length

  return (
    <div className="bg-white min-h-screen">
      <section className="bg-slate-900 text-white py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold">Feature Matrix</h1>
          <p className="text-slate-200 mt-3 max-w-3xl">Real capability proof mapped to Goods, Services, and Community Programs.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-300">Available now</p>
              <p className="text-2xl font-semibold">{availableNowCount}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-300">In rollout</p>
              <p className="text-2xl font-semibold">{inRolloutCount}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-300">Navigation</p>
              <p className="text-sm text-slate-100">Header + mobile + footer</p>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12" data-event="feature_matrix_viewed" data-event-on-view="true">
        <div className="rounded-xl border border-slate-200 p-4 mb-6 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-900">Jump to capability bucket</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {featureMatrixBuckets.map((bucket) => (
              <a key={bucket} href={`#bucket-${bucket.toLowerCase().replace(/\s+/g, "-")}`} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-white">
                {bucket}
              </a>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-4">Capability</th>
                <th className="text-left p-4">Status</th>
                <th className="text-left p-4">Category bucket</th>
                <th className="text-left p-4">Proof</th>
              </tr>
            </thead>
            <tbody>
              {featureMatrixItems.map((item) => (
                <tr key={item.capability} className="border-t">
                  <td className="p-4">
                    <p className="font-medium">{item.capability}</p>
                    <p className="text-xs text-slate-600 mt-1">{item.description}</p>
                  </td>
                  <td className="p-4">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${item.status === "Available now" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="p-4">{item.bucket}</td>
                  <td className="p-4">
                    <Link href={item.proofHref} className="text-green-700 underline underline-offset-2 hover:text-green-800">
                      {item.proofLabel}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {featureMatrixBuckets.map((bucket) => (
            <article key={bucket} id={`bucket-${bucket.toLowerCase().replace(/\s+/g, "-")}`} className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">{bucket}</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {featureMatrixItems
                  .filter((item) => item.bucket === bucket)
                  .map((item) => (
                    <li key={item.capability} className="flex items-start justify-between gap-2">
                      <span>{item.capability}</span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${item.status === "Available now" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                        {item.status}
                      </span>
                    </li>
                  ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="mt-6 flex gap-3 flex-wrap">
          <Link href="/sell" className="px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-medium">Go to vendor onboarding</Link>
          <Link href="/what-you-sell" className="px-4 py-2 rounded-lg border text-sm font-medium">See vendor type entry points</Link>
        </div>
      </section>
    </div>
  )
}

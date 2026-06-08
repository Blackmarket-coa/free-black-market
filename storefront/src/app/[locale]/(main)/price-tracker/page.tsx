import type { Metadata } from "next"
import { getPriceTracker, type PriceTrack } from "@/lib/data/discovery"

export const metadata: Metadata = {
  title: "Price Tracker",
  description:
    "Track prices for food, gardening, agriculture, and household goods by region.",
}

const dollars = (cents?: number | null) =>
  cents == null ? "—" : `$${(cents / 100).toFixed(2)}`

const arrow = (d: string) => (d === "rising" ? "▲" : d === "falling" ? "▼" : "—")
const color = (d: string) =>
  d === "rising" ? "text-red-600" : d === "falling" ? "text-green-700" : "text-ui-fg-subtle"

export default async function PriceTrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>
}) {
  const { region } = await searchParams
  let tracks: PriceTrack[] = []
  try {
    tracks = await getPriceTracker({ region: region || "US" })
  } catch {
    tracks = []
  }

  return (
    <main className="container py-10">
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-green-700">
          Economic Intelligence
        </p>
        <h1 className="text-3xl font-semibold">Price tracker</h1>
        <p className="mt-2 max-w-2xl text-ui-fg-subtle">
          Recent price trends for food, gardening, agriculture, and household
          goods in {region || "US"}.
        </p>
      </header>

      {tracks.length === 0 ? (
        <div className="rounded-md border p-6 text-sm text-ui-fg-subtle">
          No price data yet.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {tracks.map((t) => (
            <div key={t.category} className="rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold capitalize">{t.category}</span>
                <span className={`text-sm font-medium ${color(t.trend.direction)}`}>
                  {arrow(t.trend.direction)}{" "}
                  {t.trend.pctChange > 0 ? "+" : ""}
                  {t.trend.pctChange}%
                </span>
              </div>
              <p className="mt-2 text-2xl font-semibold">
                {dollars(t.trend.latestCents)}
              </p>
              <p className="text-xs text-ui-fg-subtle">
                latest · {t.series.length} observations
              </p>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

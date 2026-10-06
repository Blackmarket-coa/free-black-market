import type { Metadata } from "next"
import { getFeeSchedule } from "@/lib/data/fee-schedule"
import SellPageClient from "./SellPageClient"

export const metadata: Metadata = {
  title: "Sell on Free Black Market",
  description:
    "Learn how to open your shop, list products, and grow your business on Free Black Market.",
}

export default async function SellPage() {
  // The ladder prose is rendered from the schedule the backend actually
  // offers, so retiring a plan cannot leave this page selling it.
  const schedule = await getFeeSchedule()
  return (
    <SellPageClient
      feePlans={schedule.plans}
      feePercent={schedule.default_fee_percent}
      processing={schedule.processing}
    />
  )
}

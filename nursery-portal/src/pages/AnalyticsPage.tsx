import { StubPage } from "@/components/ui/StubPage"

export function AnalyticsPage() {
  return (
    <StubPage
      title="Analytics"
      icon="📊"
      summary="Sales and operational analytics, nursery-specific. Built with recharts."
      planned={[
        "Revenue over time (gross / net / fees)",
        "Top species by revenue / units / margin",
        "Propagation success rate by method",
        "Sales by destination state",
        "DOA rate trend + SKU performance table",
      ]}
    />
  )
}

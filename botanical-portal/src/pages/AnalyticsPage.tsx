import { StubPage } from "@bmc/ui"

export function AnalyticsPage() {
  return (
    <StubPage
      title="Analytics"
      icon="📊"
      summary="Pathway-aware production, margin, and sourcing analytics."
      planned={[
        "Units produced by pathway over time",
        "Margin by formula and pathway",
        "BMC-sourced % trend",
        "Yield variance (planned vs actual)",
      ]}
    />
  )
}

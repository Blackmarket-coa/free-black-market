import { StubPage } from "@bmc/ui"

export function BlackoutPage() {
  return (
    <StubPage
      title="Blackout"
      icon="💬"
      summary="Blackout (Matrix) messaging — order alerts and network coordination."
      planned={[
        "Order + fulfillment alert feed",
        "Nursery node coordination rooms",
        "Governance proposals",
        "Direct messages to growers and buyers",
      ]}
    />
  )
}

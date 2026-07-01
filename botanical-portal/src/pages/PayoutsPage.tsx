import { StubPage } from "@bmc/ui"

export function PayoutsPage() {
  return (
    <StubPage
      title="Payouts"
      icon="💸"
      summary="Earnings, KARMA tier, and split history."
      planned={[
        "Current period earnings + cooperative split %",
        "KARMA tier progression (Seedling → Ancestor)",
        "Payout history by month",
        "Hub cut breakdown",
      ]}
    />
  )
}

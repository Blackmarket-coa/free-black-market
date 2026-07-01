import { StubPage } from "@bmc/ui"

export function OrdersPage() {
  return (
    <StubPage
      title="Orders"
      icon="🛒"
      summary="Retail + wholesale orders with per-order compliance checks."
      planned={[
        "Order queue — retail and wholesale",
        "Per-order compliance check (batch #, label, COA, expiry)",
        "Pick / pack / ship with batch traceability",
        "Blackout dispatch notifications",
      ]}
    />
  )
}

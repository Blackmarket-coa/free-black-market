import { StubPage } from "@bmc/ui"

export function WholesalePage() {
  return (
    <StubPage
      title="Wholesale"
      icon="📦"
      summary="B2B channel — buyer accounts, COA workflow, and subscription boxes."
      planned={[
        "Wholesale buyer accounts + lifetime spend",
        "Applications (approve / decline)",
        "COA upload + attach to wholesale-eligible batches",
        "Bulk/tincture COA requirement enforcement",
        "Recurring subscription box orders",
      ]}
    />
  )
}

import { StubPage } from "@bmc/ui"

// Hub only — guarded at the route level in App.tsx.
export function WholesalePage() {
  return (
    <StubPage
      title="Wholesale"
      icon="📦"
      summary="B2B wholesale channel — buyer accounts, plug pipeline, and demand map."
      planned={[
        "Wholesale buyer accounts + lifetime spend",
        "Active applications (approve / decline)",
        "Plug tray pipeline routed to nodes",
        "Species demand map by region",
        "Restoration / DOT contracts",
      ]}
    />
  )
}

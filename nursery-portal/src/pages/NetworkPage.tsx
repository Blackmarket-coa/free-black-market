import { StubPage } from "@/components/ui/StubPage"

// Hub only — guarded at the route level in App.tsx.
export function NetworkPage() {
  return (
    <StubPage
      title="Network"
      icon="🌐"
      summary="Hub operator's network overview — node health, transfers, and payout processing."
      planned={[
        "Node health grid (green / yellow / red)",
        "Network totals (units, gross, grower pool, hub net)",
        "Propagation schedule dispatch to nodes",
        "Inter-node transfers (HRS rail)",
        "Monthly payout processing + 1099 tracking",
        "Node onboarding queue",
      ]}
    />
  )
}

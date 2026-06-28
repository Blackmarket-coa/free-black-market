import { StubPage } from "@/components/ui/StubPage"

export function NurseryNetworkPage() {
  return (
    <StubPage
      title="Nursery Network"
      icon="🌐"
      summary="Source raw plant material from the BMC nursery network."
      planned={[
        "Browse BMC nursery node inventory (live plants, dried botanicals, harvest)",
        "Create ingredient requests routed to grower nodes",
        "Track request status and incoming lots",
        "Portfolio-wide BMC-sourced % across all pathways",
      ]}
    />
  )
}

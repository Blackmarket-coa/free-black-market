import { StubPage } from "@/components/ui/StubPage"

// Collective only — guarded at the route level in App.tsx.
export function CollectiveSplitsPage() {
  return (
    <StubPage
      title="Pool Splits"
      icon="🤝"
      summary="Revenue pooling and split configuration across collective makers."
      planned={[
        "Pool revenue across shared production",
        "Split rules by contribution / pathway",
        "Period settlement preview",
        "Payout distribution to member makers",
      ]}
    />
  )
}

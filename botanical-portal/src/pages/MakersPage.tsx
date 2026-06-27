import { StubPage } from "@/components/ui/StubPage"

// Collective only — guarded at the route level in App.tsx.
export function MakersPage() {
  return (
    <StubPage
      title="Makers"
      icon="👥"
      summary="Collective member makers and their production contributions."
      planned={[
        "Member maker roster",
        "Per-maker pathway + production summary",
        "Contribution bands (self-relative)",
        "Onboarding new makers to the collective",
      ]}
    />
  )
}

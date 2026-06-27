import { StubPage } from "@/components/ui/StubPage"

export function QuestsPage() {
  return (
    <StubPage
      title="Quests"
      icon="🏆"
      summary="Cooperative quests and KARMA milestones for makers."
      planned={[
        "First batch, first formula, first wholesale buyer",
        "Cooperative supply chain (BMC-sourced %) quests",
        "Versatile maker (3+ pathways) badge",
        "Units-produced milestones (100 / 500 / 1000)",
      ]}
    />
  )
}

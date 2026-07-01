import { useState } from "react"
import { PageHeader } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { Tabs } from "@/components/ui/Tabs"
import { EmptyState } from "@bmc/ui"
import { BoostCard } from "@/components/boost/BoostCard"
import { useBoosts } from "@/hooks/useCreatorData"

export function BoostsPage() {
  const { data, isLoading, isError } = useBoosts()
  const [tab, setTab] = useState("active")

  const active = (data ?? []).filter((b) => b.status === "active")
  const past = (data ?? []).filter((b) => b.status !== "active")
  const shown = tab === "active" ? active : past

  return (
    <div className="space-y-5">
      <PageHeader
        title="Governance Boosts"
        subtitle="Hype Trains, Fundraiser Rallies, and bounty boosts — momentum events mirrored to your Blackout Space."
        action={<button className="btn-primary text-sm">New boost</button>}
      />

      <Tabs
        tabs={[
          { key: "active", label: "Active", count: active.length },
          { key: "past", label: "Past", count: past.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      <QueryState isLoading={isLoading} isError={isError}>
        {shown.length === 0 ? (
          <EmptyState
            icon="🚀"
            title={tab === "active" ? "No active boosts" : "No past boosts"}
            message="Start a Hype Train to rally your members around a goal — milestones unlock rewards as the bar fills."
          />
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {shown.map((b) => (
              <BoostCard key={b.id} boost={b} />
            ))}
          </div>
        )}
      </QueryState>
    </div>
  )
}

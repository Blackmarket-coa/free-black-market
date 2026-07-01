import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { EmptyState } from "@bmc/ui"
import { SplitContractCard } from "@/components/splits/SplitContractCard"
import { useSplits } from "@/hooks/useCreatorData"
import { USE_MOCK_DATA, api } from "@bmc/portal-kit"

export function SplitsPage() {
  const { data, isLoading, isError } = useSplits()
  const queryClient = useQueryClient()
  const [activatingId, setActivatingId] = useState<string | null>(null)

  // Activation writes an immutable Matrix state event; on success the card
  // swaps to the on-Blackout proof. Optimistically patches the cache when mock.
  async function onActivate(id: string) {
    setActivatingId(id)
    try {
      if (!USE_MOCK_DATA) {
        await api.post(`/vendor/creator/splits/${id}/activate`)
        await queryClient.invalidateQueries({ queryKey: ["creator", "splits"] })
      } else {
        await new Promise((r) => setTimeout(r, 600))
        queryClient.setQueryData<typeof data>(["creator", "splits"], (prev) =>
          (prev ?? []).map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: "active",
                  activated_at: new Date().toISOString(),
                  matrix_event_id: `$split${Math.random().toString(36).slice(2, 10)}:theblackout.app`,
                }
              : c
          )
        )
      }
    } finally {
      setActivatingId(null)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Smart Splits"
        subtitle="Revenue-split contracts. Activation records an immutable proof on your Blackout Space."
        action={<button className="btn-primary text-sm">New contract</button>}
      />

      <QueryState isLoading={isLoading} isError={isError}>
        {(data ?? []).length === 0 ? (
          <EmptyState
            icon="🤝"
            title="No split contracts"
            message="Create a split to share revenue with collaborators. Once activated it's permanently recorded on Blackout."
          />
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {(data ?? []).map((c) => (
              <SplitContractCard
                key={c.id}
                contract={c}
                onActivate={onActivate}
                activating={activatingId === c.id}
              />
            ))}
          </div>
        )}
      </QueryState>
    </div>
  )
}

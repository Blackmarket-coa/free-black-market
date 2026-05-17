import { useQuery } from "@tanstack/react-query"
import { Container, Heading, Text } from "@medusajs/ui"
import { sdk } from "@lib/client"

type LedgerSummary = {
  accounts: {
    total_accounts: number
    by_type: Record<string, { count: number; total_balance: number }>
    total_balance: number
  }
  investments: {
    total_pools: number
    total_invested: number
    total_distributed: number
  }
  settlements: {
    total_batches: number
    completed_batches: number
    total_settled_volume: number
  }
  recent_entries: Array<{
    id: string
    entry_type?: string
    amount?: number
    description?: string | null
    created_at?: string
  }>
}

export const CoalitionCreditsPage = () => {
  const { data, isLoading, error } = useQuery<LedgerSummary>({
    queryKey: ["coalition-credits-summary"],
    queryFn: () => sdk.client.fetch<LedgerSummary>("/admin/hawala/summary"),
  })

  return (
    <Container>
      <Heading>Coalition Credits</Heading>
      <Text size="small" className="text-ui-fg-subtle">
        Cross-coalition Coalition Credits volume on the
        <code className="mx-1">hawala-ledger</code>
        substrate. Backs the Blackout-side balance widget through the
        entitlements service.
      </Text>

      {isLoading && <Text className="mt-4">Loading…</Text>}
      {error && (
        <Text className="mt-4 text-ui-fg-error">
          Failed to load summary: {(error as Error).message}
        </Text>
      )}

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="border rounded p-3">
          <Text size="xsmall" className="text-ui-fg-subtle">Total accounts</Text>
          <Text size="large">{data?.accounts?.total_accounts ?? 0}</Text>
        </div>
        <div className="border rounded p-3">
          <Text size="xsmall" className="text-ui-fg-subtle">Total balance</Text>
          <Text size="large">
            {(data?.accounts?.total_balance ?? 0).toLocaleString()}
          </Text>
        </div>
        <div className="border rounded p-3">
          <Text size="xsmall" className="text-ui-fg-subtle">Settlement batches</Text>
          <Text size="large">
            {data?.settlements?.completed_batches ?? 0}
            <span className="text-ui-fg-subtle">
              {" "}/ {data?.settlements?.total_batches ?? 0}
            </span>
          </Text>
        </div>
      </div>

      <Heading level="h2" className="mt-6">By account type</Heading>
      <div className="mt-2 space-y-2">
        {data?.accounts?.by_type &&
          Object.entries(data.accounts.by_type).map(([type, summary]) => (
            <div key={type} className="border rounded p-3 flex justify-between">
              <Text>{type}</Text>
              <Text>
                {summary.count} accounts · {summary.total_balance.toLocaleString()} total balance
              </Text>
            </div>
          ))}
      </div>

      <Heading level="h2" className="mt-6">Investment pools</Heading>
      <div className="mt-2 grid grid-cols-3 gap-3">
        <div className="border rounded p-3">
          <Text size="xsmall" className="text-ui-fg-subtle">Pools</Text>
          <Text size="large">{data?.investments?.total_pools ?? 0}</Text>
        </div>
        <div className="border rounded p-3">
          <Text size="xsmall" className="text-ui-fg-subtle">Invested</Text>
          <Text size="large">
            {(data?.investments?.total_invested ?? 0).toLocaleString()}
          </Text>
        </div>
        <div className="border rounded p-3">
          <Text size="xsmall" className="text-ui-fg-subtle">Distributed</Text>
          <Text size="large">
            {(data?.investments?.total_distributed ?? 0).toLocaleString()}
          </Text>
        </div>
      </div>

      <Heading level="h2" className="mt-6">Recent ledger entries</Heading>
      <div className="mt-2 space-y-2">
        {data?.recent_entries?.length ? (
          data.recent_entries.map((entry) => (
            <div key={entry.id} className="border rounded p-3 flex justify-between">
              <Text>
                {entry.entry_type ?? "ENTRY"}
                {entry.description && (
                  <span className="text-ui-fg-subtle ml-2">{entry.description}</span>
                )}
              </Text>
              <Text>
                {(entry.amount ?? 0).toLocaleString()}
                {entry.created_at && (
                  <span className="ml-2 text-ui-fg-subtle">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                )}
              </Text>
            </div>
          ))
        ) : (
          <Text className="text-ui-fg-subtle">No ledger entries yet.</Text>
        )}
      </div>
    </Container>
  )
}

export const Component = CoalitionCreditsPage
export default CoalitionCreditsPage

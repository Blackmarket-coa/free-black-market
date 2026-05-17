import { useQuery } from "@tanstack/react-query"
import { Container, Heading, Text } from "@medusajs/ui"
import { sdk } from "@lib/client"

type FunnelResponse = {
  total: number
  by_status: Record<string, number>
  by_level: Record<string, number>
  median_time_to_verify_ms: number | null
}

export const VendorVerificationPage = () => {
  const { data, isLoading, error } = useQuery<FunnelResponse>({
    queryKey: ["vendor-verification-funnel"],
    queryFn: () => sdk.client.fetch<FunnelResponse>("/admin/vendor-verification/funnel"),
  })

  return (
    <Container>
      <Heading>Vendor Verification</Heading>
      <Text size="small" className="text-ui-fg-subtle">
        Verification funnel + signing instrumentation per
        AGGRESSIVE_OPERATIONS_GUIDE.md §5.1.
      </Text>

      {isLoading && <Text className="mt-4">Loading…</Text>}
      {error && (
        <Text className="mt-4 text-ui-fg-error">
          Failed to load funnel: {(error as Error).message}
        </Text>
      )}

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="border rounded p-3">
          <Text size="xsmall" className="text-ui-fg-subtle">Total verifications</Text>
          <Text size="large">{data?.total ?? 0}</Text>
        </div>
        <div className="border rounded p-3">
          <Text size="xsmall" className="text-ui-fg-subtle">Median time to verify</Text>
          <Text size="large">{formatDuration(data?.median_time_to_verify_ms ?? null)}</Text>
        </div>
        <div className="border rounded p-3">
          <Text size="xsmall" className="text-ui-fg-subtle">Status buckets</Text>
          <Text size="large">{Object.keys(data?.by_status ?? {}).length}</Text>
        </div>
      </div>

      <Heading level="h2" className="mt-6">By check status</Heading>
      <div className="mt-2 space-y-2">
        {data?.by_status && Object.keys(data.by_status).length > 0 ? (
          Object.entries(data.by_status).map(([status, count]) => (
            <div key={status} className="border rounded p-3 flex justify-between">
              <Text>{status}</Text>
              <Text>{count}</Text>
            </div>
          ))
        ) : (
          <Text className="text-ui-fg-subtle">No verification checks recorded yet.</Text>
        )}
      </div>

      <Heading level="h2" className="mt-6">By verification level</Heading>
      <div className="mt-2 space-y-2">
        {data?.by_level && Object.keys(data.by_level).length > 0 ? (
          Object.entries(data.by_level).map(([level, count]) => (
            <div key={level} className="border rounded p-3 flex justify-between">
              <Text>{level}</Text>
              <Text>{count}</Text>
            </div>
          ))
        ) : (
          <Text className="text-ui-fg-subtle">No verifications recorded yet.</Text>
        )}
      </div>
    </Container>
  )
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—"
  const hours = Math.floor(ms / (60 * 60 * 1000))
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))
  if (hours > 24) {
    const days = Math.floor(hours / 24)
    
return `${days}d ${hours % 24}h`
  }
  if (hours > 0) return `${hours}h ${minutes}m`
  
return `${minutes}m`
}

export const Component = VendorVerificationPage
export default VendorVerificationPage

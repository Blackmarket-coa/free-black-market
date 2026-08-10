import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge, Button, Container, Heading, Select, Table, Text, Textarea, toast } from "@medusajs/ui"
import { sdk } from "@lib/client"

/**
 * Vendor verification: funnel metrics *and* the review queue.
 *
 * This page was previously read-only — counts and a median time-to-verify with
 * no way to act on any of it. Vendors could submit checks and the service could
 * score them, but nothing here could record a decision, so every seller stayed
 * UNVERIFIED no matter what they filed. The storefront's "verified makers"
 * claim had no operational path behind it.
 *
 * The queue below is that path: decide a check, grant a badge, withdraw one.
 */

type FunnelResponse = {
  total: number
  by_status: Record<string, number>
  by_level: Record<string, number>
  median_time_to_verify_ms: number | null
}

type VerificationCheck = {
  id: string
  check_type: string
  status: string
  notes: string | null
  verified_by: string | null
  score_contribution: number
  created_at: string
}

type VendorBadgeRow = {
  id: string
  badge_type: string
  status: string
  granted_by: string | null
  certifying_body: string | null
}

type QueueRow = {
  id: string
  seller_id: string
  level: string
  trust_score: number
  pending_count: number
  checks: VerificationCheck[]
  created_at: string
}

type QueueResponse = {
  verifications: QueueRow[]
  count: number
}

type DetailResponse = {
  verification: { id: string; seller_id: string; level: string; trust_score: number }
  checks: VerificationCheck[]
  badges: VendorBadgeRow[]
}

type BadgeCatalogEntry = {
  badge_type: string
  name: string
  description: string
  requires_documentation: boolean
}

type BadgesResponse = {
  badges: VendorBadgeRow[]
  catalog: BadgeCatalogEntry[]
}

const DECISIONS = ["PASSED", "FAILED", "WAIVED"] as const

export const VendorVerificationPage = () => {
  const queryClient = useQueryClient()
  const [selectedSeller, setSelectedSeller] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery<FunnelResponse>({
    queryKey: ["vendor-verification-funnel"],
    queryFn: () => sdk.client.fetch<FunnelResponse>("/admin/vendor-verification/funnel"),
  })

  const queue = useQuery<QueueResponse>({
    queryKey: ["vendor-verification-queue"],
    queryFn: () => sdk.client.fetch<QueueResponse>("/admin/vendor-verification"),
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["vendor-verification-funnel"] })
    queryClient.invalidateQueries({ queryKey: ["vendor-verification-queue"] })
    queryClient.invalidateQueries({ queryKey: ["vendor-verification-detail"] })
    queryClient.invalidateQueries({ queryKey: ["vendor-verification-badges"] })
  }

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
          <Text size="xsmall" className="text-ui-fg-subtle">Awaiting review</Text>
          <Text size="large">{queue.data?.count ?? 0}</Text>
        </div>
      </div>

      {/* ---------------- Review queue ---------------- */}
      <Heading level="h2" className="mt-6">Awaiting review</Heading>
      <Text size="small" className="text-ui-fg-subtle">
        Oldest submission first. Deciding a check recalculates the seller&apos;s trust
        score and may move their verification level.
      </Text>

      {queue.isLoading && <Text className="mt-2">Loading queue…</Text>}
      {queue.error && (
        <Text className="mt-2 text-ui-fg-error">
          Failed to load queue: {(queue.error as Error).message}
        </Text>
      )}

      {queue.data && queue.data.verifications.length === 0 && (
        <Text className="mt-2 text-ui-fg-subtle">Nothing is waiting for review.</Text>
      )}

      {queue.data && queue.data.verifications.length > 0 && (
        <Table className="mt-2">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Seller</Table.HeaderCell>
              <Table.HeaderCell>Level</Table.HeaderCell>
              <Table.HeaderCell>Trust score</Table.HeaderCell>
              <Table.HeaderCell>Waiting</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {queue.data.verifications.map((row) => (
              <Table.Row key={row.id}>
                <Table.Cell className="font-mono text-xs">{row.seller_id}</Table.Cell>
                <Table.Cell><Badge size="2xsmall">{row.level}</Badge></Table.Cell>
                <Table.Cell>{row.trust_score}</Table.Cell>
                <Table.Cell>{row.pending_count}</Table.Cell>
                <Table.Cell>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() =>
                      setSelectedSeller(
                        selectedSeller === row.seller_id ? null : row.seller_id
                      )
                    }
                  >
                    {selectedSeller === row.seller_id ? "Close" : "Review"}
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {selectedSeller && (
        <SellerReviewPanel sellerId={selectedSeller} onChanged={invalidateAll} />
      )}

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

/** One seller's checks and badges, with the actions that decide them. */
const SellerReviewPanel = ({
  sellerId,
  onChanged,
}: {
  sellerId: string
  onChanged: () => void
}) => {
  const [notes, setNotes] = useState("")

  const detail = useQuery<DetailResponse>({
    queryKey: ["vendor-verification-detail", sellerId],
    queryFn: () =>
      sdk.client.fetch<DetailResponse>(
        `/admin/vendor-verification/${encodeURIComponent(sellerId)}`
      ),
  })

  const badges = useQuery<BadgesResponse>({
    queryKey: ["vendor-verification-badges", sellerId],
    queryFn: () =>
      sdk.client.fetch<BadgesResponse>(
        `/admin/vendor-verification/${encodeURIComponent(sellerId)}/badges`
      ),
  })

  const decide = useMutation({
    mutationFn: ({ checkId, status }: { checkId: string; status: string }) =>
      sdk.client.fetch(
        `/admin/vendor-verification/checks/${encodeURIComponent(checkId)}`,
        { method: "POST", body: { status, notes: notes || undefined } }
      ),
    onSuccess: () => {
      toast.success("Decision recorded")
      setNotes("")
      onChanged()
    },
    onError: (e: Error) => toast.error(`Could not record decision: ${e.message}`),
  })

  const grant = useMutation({
    mutationFn: (badgeType: string) =>
      sdk.client.fetch(
        `/admin/vendor-verification/${encodeURIComponent(sellerId)}/badges`,
        { method: "POST", body: { badge_type: badgeType } }
      ),
    onSuccess: () => {
      toast.success("Badge granted")
      onChanged()
    },
    // Certification badges are rejected without documentation; surface the
    // backend's reason rather than a generic failure.
    onError: (e: Error) => toast.error(e.message),
  })

  const setBadgeStatus = useMutation({
    mutationFn: ({ badgeId, status }: { badgeId: string; status: string }) =>
      sdk.client.fetch(
        `/admin/vendor-verification/badges/${encodeURIComponent(badgeId)}`,
        { method: "POST", body: { status } }
      ),
    onSuccess: () => {
      toast.success("Badge updated")
      onChanged()
    },
    onError: (e: Error) => toast.error(`Could not update badge: ${e.message}`),
  })

  const busy = decide.isPending || grant.isPending || setBadgeStatus.isPending

  return (
    <div className="mt-4 border rounded p-4">
      <Heading level="h3">Reviewing {sellerId}</Heading>
      {detail.data && (
        <Text size="small" className="text-ui-fg-subtle">
          Level {detail.data.verification.level} · trust score{" "}
          {detail.data.verification.trust_score}
        </Text>
      )}

      <Textarea
        className="mt-3"
        placeholder="Reviewer notes (recorded against the decision)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <Heading level="h3" className="mt-4">Checks</Heading>
      <div className="mt-2 space-y-2">
        {detail.data?.checks.length === 0 && (
          <Text className="text-ui-fg-subtle">No checks submitted.</Text>
        )}
        {detail.data?.checks.map((check) => (
          <div key={check.id} className="border rounded p-3">
            <div className="flex items-center justify-between">
              <div>
                <Text weight="plus">{check.check_type}</Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {check.status}
                  {check.verified_by ? ` · decided by ${check.verified_by}` : ""}
                  {check.score_contribution ? ` · +${check.score_contribution}` : ""}
                </Text>
              </div>
              <div className="flex gap-2">
                {DECISIONS.map((decision) => (
                  <Button
                    key={decision}
                    size="small"
                    variant={decision === "PASSED" ? "primary" : "secondary"}
                    disabled={busy || check.status === decision}
                    onClick={() => decide.mutate({ checkId: check.id, status: decision })}
                  >
                    {decision}
                  </Button>
                ))}
              </div>
            </div>
            {check.notes && (
              <Text size="small" className="mt-2">{check.notes}</Text>
            )}
          </div>
        ))}
      </div>

      <Heading level="h3" className="mt-4">Badges</Heading>
      <div className="mt-2 space-y-2">
        {badges.data?.badges.length === 0 && (
          <Text className="text-ui-fg-subtle">No badges granted.</Text>
        )}
        {badges.data?.badges.map((badge) => (
          <div key={badge.id} className="border rounded p-3 flex items-center justify-between">
            <div>
              <Text weight="plus">{badge.badge_type}</Text>
              <Text size="small" className="text-ui-fg-subtle">
                {badge.status}
                {badge.certifying_body ? ` · ${badge.certifying_body}` : ""}
              </Text>
            </div>
            <div className="flex gap-2">
              {badge.status !== "ACTIVE" && (
                <Button
                  size="small"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setBadgeStatus.mutate({ badgeId: badge.id, status: "ACTIVE" })}
                >
                  Reinstate
                </Button>
              )}
              {badge.status === "ACTIVE" && (
                <>
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setBadgeStatus.mutate({ badgeId: badge.id, status: "SUSPENDED" })}
                  >
                    Suspend
                  </Button>
                  <Button
                    size="small"
                    variant="danger"
                    disabled={busy}
                    onClick={() => setBadgeStatus.mutate({ badgeId: badge.id, status: "REVOKED" })}
                  >
                    Revoke
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {badges.data && badges.data.catalog.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <Select
            disabled={busy}
            onValueChange={(value) => grant.mutate(value)}
          >
            <Select.Trigger className="max-w-sm">
              <Select.Value placeholder="Grant a badge…" />
            </Select.Trigger>
            <Select.Content>
              {badges.data.catalog.map((entry) => (
                <Select.Item key={entry.badge_type} value={entry.badge_type}>
                  {entry.name}
                  {entry.requires_documentation ? " (needs documentation)" : ""}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          <Text size="small" className="text-ui-fg-subtle">
            Certification badges are refused without a document URL or certificate
            number — grant those from the seller record once you have it.
          </Text>
        </div>
      )}
    </div>
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

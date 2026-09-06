import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge, Button, Container, Heading, Select, Table, Text, Textarea, toast } from "@medusajs/ui"
import { sdk } from "@lib/client"

/**
 * Document vault — the verification queue.
 *
 * `PATCH /admin/vault/:id` has been `markVerified`'s only caller since
 * 2026-09-03, and until 2026-09-06 nothing in this panel called it: a vault
 * document could be verified only by hand against the API, so the
 * compliance-tracker quest's document gates and the wellness-insurance
 * packet's credential section stayed empty for every vendor. This screen is
 * the queue `GET /admin/vault` serves — unverified first, oldest first — with
 * the expiring-soon filter that route already supports, so a certificate is
 * worked before it lapses rather than after.
 *
 * Status is the API's `effective_status`, never the stored `verified` flag:
 * a lapsed certificate reads "Expired" here, and the route refuses to verify
 * one, so an admin cannot put a check on a coverage window that is over.
 */

type EffectiveStatus = "unverified" | "verified" | "expired"

type VaultRow = {
  id: string
  seller_id: string
  doc_type: string
  label: string
  file_id: string | null
  issued_at: string | null
  expires_at: string | null
  verified: boolean
  verified_at: string | null
  effective_status: EffectiveStatus
  days_until_expiry: number | null
  created_at: string
  metadata: Record<string, unknown> | null
}

type QueueResponse = { documents: VaultRow[]; count: number; as_of: string }

type Scope = "false" | "true" | "all"

const SCOPES: { value: Scope; label: string }[] = [
  { value: "false", label: "Awaiting verification" },
  { value: "true", label: "Verified" },
  { value: "all", label: "All documents" },
]

const EXPIRY_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Any expiry" },
  { value: "30", label: "Expiring within 30 days" },
  { value: "90", label: "Expiring within 90 days" },
]

const EXPIRY_WARNING_DAYS = 30

const statusBadge = (row: VaultRow): { color: "green" | "orange" | "red" | "grey"; label: string } => {
  if (row.effective_status === "expired") return { color: "red", label: "Expired" }
  if (row.effective_status === "verified") {
    if (row.days_until_expiry !== null && row.days_until_expiry <= EXPIRY_WARNING_DAYS) {
      const when = row.days_until_expiry <= 0 ? "expires today" : `expires in ${row.days_until_expiry}d`

      return { color: "orange", label: `Verified · ${when}` }
    }

    return { color: "green", label: "Verified" }
  }

  return { color: "grey", label: "Unverified" }
}

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "—")

export const VaultPage = () => {
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<Scope>("false")
  const [expiringWithin, setExpiringWithin] = useState("")
  const [note, setNote] = useState("")

  const params = new URLSearchParams({ verified: scope })
  if (expiringWithin) params.set("expiring_within", expiringWithin)

  const queue = useQuery<QueueResponse>({
    queryKey: ["admin-vault", scope, expiringWithin],
    queryFn: () => sdk.client.fetch<QueueResponse>(`/admin/vault?${params.toString()}`),
  })

  const decide = useMutation({
    mutationFn: ({ id, verified }: { id: string; verified: boolean }) =>
      sdk.client.fetch(`/admin/vault/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { verified, note: note || undefined },
      }),
    onSuccess: (_data, vars) => {
      toast.success(vars.verified ? "Document verified" : "Verification withdrawn")
      setNote("")
      queryClient.invalidateQueries({ queryKey: ["admin-vault"] })
    },
    // The route refuses to verify an expired document with a 409 that says
    // why; surface its reason rather than a generic failure.
    onError: (e: Error) => toast.error(e.message),
  })

  const rows = queue.data?.documents ?? []

  return (
    <Container>
      <Heading>Document Vault</Heading>
      <Text size="small" className="text-ui-fg-subtle">
        Vendors&apos; uploaded evidence — leases, licenses, insurance, credentials.
        Verifying records that a person checked the document; it is never set
        automatically, and a verified document stops counting the day it expires.
      </Text>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Show</Text>
          <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
            <Select.Trigger className="w-56">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {SCOPES.map((s) => (
                <Select.Item key={s.value} value={s.value}>
                  {s.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Expiry</Text>
          <Select value={expiringWithin} onValueChange={setExpiringWithin}>
            <Select.Trigger className="w-56">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {EXPIRY_FILTERS.map((f) => (
                <Select.Item key={f.value || "any"} value={f.value}>
                  {f.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <Text size="small" className="text-ui-fg-subtle">
          {queue.data ? `${queue.data.count} document${queue.data.count === 1 ? "" : "s"}` : ""}
        </Text>
      </div>

      <Textarea
        className="mt-4"
        placeholder="Note for the next decision (optional) — what you checked, or why you withdrew"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {queue.isLoading && <Text className="mt-4">Loading…</Text>}
      {queue.error && (
        <Text className="mt-4 text-ui-fg-error">
          Failed to load the vault: {(queue.error as Error).message}
        </Text>
      )}
      {queue.data && rows.length === 0 && (
        <Text className="mt-4 text-ui-fg-subtle">Nothing here.</Text>
      )}

      {rows.length > 0 && (
        <Table className="mt-4">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Seller</Table.HeaderCell>
              <Table.HeaderCell>Document</Table.HeaderCell>
              <Table.HeaderCell>Type</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Expires</Table.HeaderCell>
              <Table.HeaderCell>Submitted</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((row) => {
              const status = statusBadge(row)
              const canVerify = row.effective_status === "unverified" && row.days_until_expiry !== null
                ? row.days_until_expiry >= 0
                : row.effective_status === "unverified"

              return (
                <Table.Row key={row.id}>
                  <Table.Cell className="font-mono text-xs">{row.seller_id}</Table.Cell>
                  <Table.Cell>
                    {row.label}
                    {!row.file_id && (
                      <Text size="xsmall" className="text-ui-fg-subtle">No file attached</Text>
                    )}
                  </Table.Cell>
                  <Table.Cell><Badge size="2xsmall">{row.doc_type}</Badge></Table.Cell>
                  <Table.Cell><Badge size="2xsmall" color={status.color}>{status.label}</Badge></Table.Cell>
                  <Table.Cell>{formatDate(row.expires_at)}</Table.Cell>
                  <Table.Cell>{formatDate(row.created_at)}</Table.Cell>
                  <Table.Cell>
                    {row.verified ? (
                      <Button
                        size="small"
                        variant="secondary"
                        isLoading={decide.isPending && decide.variables?.id === row.id}
                        onClick={() => decide.mutate({ id: row.id, verified: false })}
                      >
                        Withdraw
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="primary"
                        disabled={!canVerify}
                        isLoading={decide.isPending && decide.variables?.id === row.id}
                        onClick={() => decide.mutate({ id: row.id, verified: true })}
                      >
                        {canVerify ? "Verify" : "Expired — re-issue"}
                      </Button>
                    )}
                  </Table.Cell>
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table>
      )}
    </Container>
  )
}

export const Component = VaultPage
export default VaultPage

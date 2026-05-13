import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button, Container, Heading, Input, Table, Text } from "@medusajs/ui"
import { sdk } from "@lib/client"

type AuditResponse = {
  execution_run_id: string
  summary: {
    total: number
    credited: number
    failed: number
    computed: number
  }
  payouts: Array<{
    id: string
    payout_status: string
    payout_amount?: string | number
    supporter_id?: string
    market_id?: string
    settlement_id?: string
  }>
}

const toCsv = (rows: AuditResponse["payouts"]) => {
  const header = ["id", "payout_status", "payout_amount", "supporter_id", "market_id", "settlement_id"]
  const lines = rows.map((row) =>
    [
      row.id,
      row.payout_status,
      row.payout_amount ?? "",
      row.supporter_id ?? "",
      row.market_id ?? "",
      row.settlement_id ?? "",
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(",")
  )
  
return [header.join(","), ...lines].join("\n")
}

export const VendorHypePayoutAuditPage = () => {
  const [runIdInput, setRunIdInput] = useState("")
  const [runId, setRunId] = useState("")

  const { data, isFetching, error } = useQuery({
    queryKey: ["vendor-hype-payout-audit", runId],
    queryFn: () =>
      sdk.client.fetch<AuditResponse>(`/admin/vendor-hype/payouts/audit?execution_run_id=${encodeURIComponent(runId)}`),
    enabled: Boolean(runId),
  })

  const csv = useMemo(() => (data ? toCsv(data.payouts) : ""), [data])

  const onExport = () => {
    if (!csv || !data) return
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `vendor-hype-payout-audit-${data.execution_run_id}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  return (
    <Container>
      <div className="flex items-center justify-between gap-4">
        <div>
          <Heading>Vendor Hype Payout Audit</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Search payout processing runs and export payout rows for operations review.
          </Text>
        </div>
      </div>

      <div className="mt-4 flex items-end gap-2">
        <div className="w-[360px]">
          <Text size="small" className="mb-1 text-ui-fg-subtle">Execution run ID</Text>
          <Input
            placeholder="payout_run_..."
            value={runIdInput}
            onChange={(e) => setRunIdInput(e.target.value)}
          />
        </div>
        <Button
          onClick={() => setRunId(runIdInput.trim())}
          disabled={!runIdInput.trim() || isFetching}
        >
          Search
        </Button>
        <Button variant="secondary" onClick={onExport} disabled={!data || data.payouts.length === 0}>
          Export CSV
        </Button>
      </div>

      {error && (
        <Text className="mt-4 text-ui-fg-error" size="small">
          Failed to load payout audit data for the provided execution run id.
        </Text>
      )}

      {data && (
        <>
          <div className="mt-4 grid grid-cols-4 gap-2">
            <div className="rounded border p-3">Total: {data.summary.total}</div>
            <div className="rounded border p-3">Credited: {data.summary.credited}</div>
            <div className="rounded border p-3">Failed: {data.summary.failed}</div>
            <div className="rounded border p-3">Computed: {data.summary.computed}</div>
          </div>

          <div className="mt-4">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Payout</Table.HeaderCell>
                  <Table.HeaderCell>Status</Table.HeaderCell>
                  <Table.HeaderCell>Amount</Table.HeaderCell>
                  <Table.HeaderCell>Supporter</Table.HeaderCell>
                  <Table.HeaderCell>Settlement</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {data.payouts.map((row) => (
                  <Table.Row key={row.id}>
                    <Table.Cell>{row.id}</Table.Cell>
                    <Table.Cell>{row.payout_status}</Table.Cell>
                    <Table.Cell>{row.payout_amount ?? "-"}</Table.Cell>
                    <Table.Cell>{row.supporter_id ?? "-"}</Table.Cell>
                    <Table.Cell>{row.settlement_id ?? "-"}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        </>
      )}
    </Container>
  )
}

export const Component = VendorHypePayoutAuditPage

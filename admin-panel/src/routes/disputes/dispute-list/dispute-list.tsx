import { Badge, Button, Container, Heading, Select, Table, Text } from "@medusajs/ui"
import { useNavigate, useSearchParams } from "react-router-dom"

import { useDisputes } from "@hooks/api/disputes"
import {
  FILTER_OPTIONS,
  REASON_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  daysWaiting,
  formatMinor,
  isLive,
  listQuery,
  parseFilter,
} from "@routes/disputes/dispute-rules"

/**
 * Disputes: the queue a buyer's claim lands in.
 *
 * `/buyer-protection` tells buyers their claim goes into a review queue with
 * the order and the seller's record, and that every decision is recorded
 * with a written reason. Claims filed from the storefront
 * (`POST /store/order-claims`) and from the order page
 * (`POST /store/orders/:id/dispute`) become order disputes; this is where
 * they are read and decided (`GET /admin/disputes`).
 *
 * By default it shows what is waiting for a decision, open and under review,
 * oldest first: the claim that has waited longest is the one most likely to
 * have lost the buyer. The filter shows one status, including decided ones.
 */
export const DisputeList = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = parseFilter(searchParams.get("status"))
  const { disputes, isLoading, error } = useDisputes(listQuery(filter))
  const rows = disputes ?? []
  const now = new Date()

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
        <div>
          <Heading>Disputes</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Buyer claims against a seller&apos;s order. Oldest first. Open one to read it, see the order and both
            parties, and decide it.
          </Text>
        </div>
        <div className="w-60">
          <Select
            value={filter}
            onValueChange={(value) => {
              const next = parseFilter(value)
              setSearchParams(next === "queue" ? {} : { status: next })
            }}
          >
            <Select.Trigger aria-label="Show disputes">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {FILTER_OPTIONS.map((o) => (
                <Select.Item key={o.value} value={o.value}>
                  {o.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
      </div>

      {isLoading && <Text className="px-6 py-4">Loading…</Text>}
      {error && (
        <Text className="text-ui-fg-error px-6 py-4">Failed to load disputes: {(error as Error).message}</Text>
      )}
      {!isLoading && !error && rows.length === 0 && (
        <Text className="text-ui-fg-subtle px-6 py-4">
          {filter === "queue" ? "Nothing is waiting for a decision." : `No disputes are ${STATUS_LABELS[filter].toLowerCase()}.`}
        </Text>
      )}

      {rows.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Opened</Table.HeaderCell>
              <Table.HeaderCell>Waiting</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Reason</Table.HeaderCell>
              <Table.HeaderCell>Order</Table.HeaderCell>
              <Table.HeaderCell>Seller</Table.HeaderCell>
              <Table.HeaderCell>Claimed</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((d) => {
              // A decided case is not waiting for anything.
              const days = isLive(d.status) ? daysWaiting(d.created_at, now) : null

              return (
                <Table.Row key={d.id}>
                  <Table.Cell>{new Date(d.created_at).toLocaleDateString()}</Table.Cell>
                  <Table.Cell>{days === null ? "—" : `${days} day${days === 1 ? "" : "s"}`}</Table.Cell>
                  <Table.Cell>
                    <Badge size="2xsmall" color={STATUS_COLORS[d.status]}>
                      {STATUS_LABELS[d.status]}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{REASON_LABELS[d.reason] ?? d.reason}</Table.Cell>
                  <Table.Cell className="font-mono text-xs">{d.order_id}</Table.Cell>
                  <Table.Cell className="font-mono text-xs">{d.seller_id}</Table.Cell>
                  <Table.Cell>{formatMinor(d.claim_amount, d.currency_code)}</Table.Cell>
                  <Table.Cell>
                    <Button size="small" variant="secondary" onClick={() => navigate(`/disputes/${d.id}`)}>
                      Open
                    </Button>
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

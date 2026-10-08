import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge, Button, Container, Heading, Input, Table, Text, toast } from "@medusajs/ui"
import { sdk } from "@lib/client"
import { isFetchError } from "@lib/is-fetch-error"
import { assignmentDraft, formatCents, REASON_LABELS, type DisputeFeeReason } from "./assignment"

/**
 * Chargeback fees — the queue of Stripe dispute fees the automatic rule puts
 * on no seller (backend SD-44 (a): `GET /admin/hawala/dispute-fees`).
 *
 * The rule is that the vendor whose order was disputed owes the fee. On a
 * shared (Mercur) cart one card charge pays several sellers' orders, and a
 * PARTIAL chargeback does not say which order the cardholder disputed, so the
 * ledger puts it on no one and it waits here. A person who has read the
 * dispute in Stripe divides the unassigned fee between the cart's orders —
 * each share is then owed by that order's seller, taken from their next
 * sales and shown on their finances page as a chargeback fee — and may leave
 * part or all of it with BMC. The amounts must add up to the cent; the
 * server checks again. An assignment cannot be undone from this screen.
 */

type OrderRow = {
  order_id: string
  seller_id: string | null
  seller_name: string | null
  order_amount: number | null
  settled: boolean
  assigned_cents: number
}

type FeeRow = {
  stripe_charge_id: string
  payment_collection_id: string
  charge_amount_cents: number
  disputed_cents: number
  fee_cents: number
  assigned_cents: number
  absorbed_cents: number
  unassigned_cents: number
  reason: DisputeFeeReason | null
  orders: OrderRow[]
}

type QueueResponse = { dispute_fees: FeeRow[]; count: number }

const dollars = (major: number | null) => (major === null ? "—" : formatCents(Math.round(major * 100)))

const AssignPanel = ({ fee, onDone }: { fee: FeeRow; onDone: () => void }) => {
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [absorbs, setAbsorbs] = useState("")
  const unsettled = useMemo(() => new Set(fee.orders.filter((o) => !o.settled).map((o) => o.order_id)), [fee])
  const draft = assignmentDraft(fee.unassigned_cents, amounts, absorbs, unsettled)

  const submit = useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/admin/hawala/dispute-fees/${encodeURIComponent(fee.stripe_charge_id)}/assign`, {
        method: "POST",
        body: draft.body ?? {},
      }),
    onSuccess: () => {
      toast.success("Chargeback fee assigned")
      onDone()
    },
    // The server's reason (it does not add up, nothing is left, …) says what to fix.
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="mt-4 rounded-lg border p-4">
      <Heading level="h2">Assign {formatCents(fee.unassigned_cents)}</Heading>
      <Text size="small" className="text-ui-fg-subtle">
        Charge <span className="font-mono">{fee.stripe_charge_id}</span>: {formatCents(fee.fee_cents)} fee on a{" "}
        {formatCents(fee.charge_amount_cents)} charge; the largest chargeback covered {formatCents(fee.disputed_cents)}.
        {fee.reason ? ` ${REASON_LABELS[fee.reason]}.` : ""}
      </Text>
      <Text size="small" className="text-ui-fg-subtle mt-1">
        A share you put on an order is owed by that order&apos;s seller: taken from their next sales before any payout
        and shown to them as a chargeback fee. This cannot be undone here.
      </Text>

      <Table className="mt-3">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Order</Table.HeaderCell>
            <Table.HeaderCell>Seller</Table.HeaderCell>
            <Table.HeaderCell>Order amount</Table.HeaderCell>
            <Table.HeaderCell>Already owes</Table.HeaderCell>
            <Table.HeaderCell>Assign ($)</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {fee.orders.map((o) => (
            <Table.Row key={o.order_id}>
              <Table.Cell className="font-mono text-xs">{o.order_id}</Table.Cell>
              <Table.Cell>{o.seller_name ?? o.seller_id ?? "—"}</Table.Cell>
              <Table.Cell>{dollars(o.order_amount)}</Table.Cell>
              <Table.Cell>{formatCents(o.assigned_cents)}</Table.Cell>
              <Table.Cell>
                {o.settled ? (
                  <Input
                    size="small"
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label={`Amount for ${o.order_id}`}
                    value={amounts[o.order_id] ?? ""}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [o.order_id]: e.target.value }))}
                  />
                ) : (
                  <Text size="xsmall" className="text-ui-fg-subtle">Not in the ledger yet</Text>
                )}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>

      <div className="mt-3 flex items-end gap-3">
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">BMC absorbs ($)</Text>
          <Input
            size="small"
            inputMode="decimal"
            placeholder="0.00"
            aria-label="Amount BMC absorbs"
            value={absorbs}
            onChange={(e) => setAbsorbs(e.target.value)}
          />
        </div>
        <Text size="small">
          {formatCents(draft.totalCents)} of {formatCents(fee.unassigned_cents)}
        </Text>
        <Button size="small" disabled={!draft.body} isLoading={submit.isPending} onClick={() => submit.mutate()}>
          Assign
        </Button>
      </div>
      {draft.problems.length > 0 && (
        <Text size="small" className="mt-2 text-ui-fg-subtle">{draft.problems.join(" · ")}</Text>
      )}
    </div>
  )
}

const DisputeFeesPage = () => {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)

  const queue = useQuery<QueueResponse>({
    queryKey: ["admin-dispute-fees"],
    queryFn: () => sdk.client.fetch<QueueResponse>("/admin/hawala/dispute-fees"),
    retry: false,
  })

  const rows = queue.data?.dispute_fees ?? []
  const current = rows.find((r) => r.stripe_charge_id === selected) ?? null
  const ledgerOff = isFetchError(queue.error) && queue.error.status === 404

  return (
    <Container>
      <Heading>Chargeback fees</Heading>
      <Text size="small" className="text-ui-fg-subtle">
        Stripe&apos;s dispute fees that no seller owes yet, because a chargeback on a shared cart did not say whose order
        it was about. Decide who owes each one, or leave it with BMC.
      </Text>

      {queue.isLoading && <Text className="mt-4">Loading…</Text>}
      {ledgerOff && (
        <Text className="mt-4 text-ui-fg-subtle">
          The card ledger is off (FF_CARD_ORDER_LEDGER_V1), so chargeback fees are not tracked yet.
        </Text>
      )}
      {queue.error && !ledgerOff && (
        <Text className="mt-4 text-ui-fg-error">Failed to load: {(queue.error as Error).message}</Text>
      )}
      {queue.data && rows.length === 0 && (
        <Text className="mt-4 text-ui-fg-subtle">Nothing to assign.</Text>
      )}

      {rows.length > 0 && (
        <Table className="mt-4">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Charge</Table.HeaderCell>
              <Table.HeaderCell>Fee</Table.HeaderCell>
              <Table.HeaderCell>Unassigned</Table.HeaderCell>
              <Table.HeaderCell>Why</Table.HeaderCell>
              <Table.HeaderCell>Orders</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((r) => (
              <Table.Row key={r.stripe_charge_id}>
                <Table.Cell className="font-mono text-xs">{r.stripe_charge_id}</Table.Cell>
                <Table.Cell>{formatCents(r.fee_cents)}</Table.Cell>
                <Table.Cell>{formatCents(r.unassigned_cents)}</Table.Cell>
                <Table.Cell>
                  {r.reason ? <Badge size="2xsmall">{r.reason.replace(/_/g, " ")}</Badge> : null}
                </Table.Cell>
                <Table.Cell>{r.orders.length}</Table.Cell>
                <Table.Cell>
                  <Button
                    size="small"
                    variant={selected === r.stripe_charge_id ? "primary" : "secondary"}
                    onClick={() => setSelected(r.stripe_charge_id)}
                  >
                    Assign
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {current && (
        <AssignPanel
          key={current.stripe_charge_id}
          fee={current}
          onDone={() => {
            setSelected(null)
            queryClient.invalidateQueries({ queryKey: ["admin-dispute-fees"] })
          }}
        />
      )}
    </Container>
  )
}

export const Component = DisputeFeesPage
export default DisputeFeesPage

import type { ReactNode } from "react"
import { useState } from "react"

import { ArrowLeft } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Input, Label, Text, Textarea, toast, usePrompt } from "@medusajs/ui"
import { Link, useNavigate, useParams } from "react-router-dom"

import type { AdminDispute, AdminDisputeEvent, DisputeStatus } from "@custom-types/dispute"
import { useCustomer } from "@hooks/api/customers"
import { useDispute, useUpdateDispute } from "@hooks/api/disputes"
import { useOrder } from "@hooks/api/orders"
import { useSeller } from "@hooks/api/sellers"
import {
  CONTACTED_SELLER_LABELS,
  REASON_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  adminActionsFor,
  buyerSubmission,
  daysWaiting,
  describeEvent,
  escrowTransitionFor,
  formatMajor,
  formatMinor,
  isLive,
  resolutionDraft,
} from "@routes/disputes/dispute-rules"

/**
 * One dispute: the buyer's account, the order and both parties, the seller's
 * answer, the decision, and the full event log (`GET /admin/disputes/:id`).
 *
 * Deciding goes through `PATCH /admin/disputes/:id`, which records the
 * outcome and the award and moves no money. Most orders are not escrowed:
 * for those a refund decided here still has to be made through the order's
 * payment, and the screen says so rather than letting "refund" read as done.
 */

type OrderSummary = {
  id: string
  display_id?: number
  email?: string | null
  total?: number
  currency_code?: string
  created_at?: string
  status?: string
}

const ORDER_FIELDS = "id,display_id,email,total,currency_code,created_at,status"

const linkClass = "text-ui-fg-interactive hover:text-ui-fg-interactive-hover"

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[160px_1fr] gap-x-4 py-1">
    <Text size="small" className="text-ui-fg-subtle">
      {label}
    </Text>
    <div className="text-ui-fg-base txt-small min-w-0 break-words">{children}</div>
  </div>
)

/** What the buyer sent with the claim besides the description (`buyerSubmission`). */
const Submitted = ({ metadata }: { metadata: AdminDispute["metadata"] }) => {
  const submitted = buyerSubmission(metadata)

  return (
    <>
      <Field label="Contacted the seller first">{CONTACTED_SELLER_LABELS[submitted.contactedSeller]}</Field>
      <Field label="Evidence">
        {submitted.evidence.length === 0 ? (
          "None attached"
        ) : (
          <ul className="flex flex-col gap-1">
            {submitted.evidence.map((href, i) => (
              <li key={`${i}-${href}`}>
                <a href={href} target="_blank" rel="noopener noreferrer" className={`${linkClass} break-all`}>
                  {href}
                </a>
              </li>
            ))}
          </ul>
        )}
        {submitted.evidenceNotShown > 0 && (
          <Text size="xsmall" className="text-ui-fg-subtle mt-1">
            {submitted.evidenceNotShown} more not shown: not a web address
          </Text>
        )}
      </Field>
      <Field label="Filed through">{submitted.source ?? "Not recorded"}</Field>
    </>
  )
}

const Parties = ({ dispute }: { dispute: AdminDispute }) => {
  const orderQuery = useOrder(dispute.order_id, { fields: ORDER_FIELDS }, { retry: false })
  const order = orderQuery.order as OrderSummary | undefined
  const { customer, isError: customerError } = useCustomer(dispute.customer_id, undefined, { retry: false })
  const sellerQuery = useSeller(dispute.seller_id)
  const seller = sellerQuery.data?.seller

  return (
    <Container className="px-6 py-4">
      <Heading level="h2">Order and parties</Heading>
      <div className="mt-2">
        <Field label="Order">
          <Link to={`/orders/${dispute.order_id}`} className={linkClass}>
            {order?.display_id ? `#${order.display_id}` : dispute.order_id}
          </Link>
          {order?.created_at && <> · placed {new Date(order.created_at).toLocaleDateString()}</>}
          {typeof order?.total === "number" && (
            <> · total {formatMajor(order.total, order.currency_code ?? dispute.currency_code)}</>
          )}
          {orderQuery.isError && <> · the order record could not be loaded</>}
        </Field>
        <Field label="Buyer">
          <Link to={`/customers/${dispute.customer_id}`} className={linkClass}>
            {customer?.email ?? order?.email ?? dispute.customer_id}
          </Link>
          {customer && (customer.first_name || customer.last_name) && (
            <> · {[customer.first_name, customer.last_name].filter(Boolean).join(" ")}</>
          )}
          {customerError && !order?.email && <> · the customer record could not be loaded</>}
        </Field>
        <Field label="Seller">
          <Link to={`/sellers/${dispute.seller_id}`} className={linkClass}>
            {seller?.name ?? dispute.seller_id}
          </Link>
          {seller?.email && <> · {seller.email}</>}
          {sellerQuery.isError && <> · the seller record could not be loaded</>}
        </Field>
      </div>
    </Container>
  )
}

const DecisionPanel = ({ dispute }: { dispute: AdminDispute }) => {
  const prompt = usePrompt()
  const update = useUpdateDispute(dispute.id)
  const decisions = adminActionsFor(dispute.status).filter((s) => s !== "under_review")
  const canTakeUp = adminActionsFor(dispute.status).includes("under_review")
  const [choice, setChoice] = useState<DisputeStatus | null>(null)
  const [award, setAward] = useState("")
  const [note, setNote] = useState("")

  const draft = choice ? resolutionDraft(dispute, choice, { award, note }) : null
  const claim = formatMinor(dispute.claim_amount, dispute.currency_code)

  const takeUp = async () => {
    const d = resolutionDraft(dispute, "under_review")
    if (!d.body) return
    try {
      await update.mutateAsync(d.body)
      toast.success("Taken under review")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const decide = async () => {
    if (!choice || !draft?.body) return
    const confirmed = await prompt({
      title: `Record: ${STATUS_LABELS[choice]}`,
      description:
        "This closes the dispute and cannot be undone here. It records the decision and moves no money. " +
        "The buyer and the seller are not notified by this screen.",
      confirmText: "Record decision",
      cancelText: "Cancel",
      variant: "confirmation",
    })
    if (!confirmed) return
    try {
      await update.mutateAsync(draft.body)
      toast.success("Decision recorded")
    } catch (e) {
      // The server's reason (already decided, award over the claim, …) says what to fix.
      toast.error((e as Error).message)
    }
  }

  const choiceLabel: Record<string, string> = {
    resolved_refund: "Refund the buyer",
    resolved_release: "Release to the seller",
    withdrawn: "Record a withdrawal",
  }

  return (
    <Container className="px-6 py-4">
      <Heading level="h2">Decide</Heading>
      {canTakeUp && (
        <div className="mt-2 flex items-center gap-3">
          <Button size="small" variant="secondary" isLoading={update.isPending} onClick={takeUp}>
            Take it under review
          </Button>
          <Text size="small" className="text-ui-fg-subtle">
            Marks it as yours. The seller can still reply while it is under review.
          </Text>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {decisions.map((s) => (
          <Button
            key={s}
            size="small"
            variant={choice === s ? "primary" : "secondary"}
            onClick={() => setChoice(s)}
          >
            {choiceLabel[s] ?? STATUS_LABELS[s]}
          </Button>
        ))}
      </div>

      {choice && (
        <div className="mt-4 flex flex-col gap-3">
          {choice === "resolved_refund" && (
            <div>
              <Label htmlFor="dispute-award" size="small">
                Award ({dispute.currency_code.toUpperCase()})
              </Label>
              <Input
                id="dispute-award"
                size="small"
                inputMode="decimal"
                placeholder={`Blank awards the full claim (${claim})`}
                value={award}
                onChange={(e) => setAward(e.target.value)}
              />
            </div>
          )}
          {choice === "withdrawn" && (
            <Text size="small" className="text-ui-fg-subtle">
              For a buyer who has asked to drop the claim. Say in the note how they asked.
            </Text>
          )}
          <div>
            <Label htmlFor="dispute-note" size="small">
              Decision note (recorded on the dispute; not sent to anyone)
            </Label>
            <Textarea id="dispute-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} />
          </div>
          {draft && draft.problems.length > 0 && (
            <Text size="small" className="text-ui-fg-subtle">
              {draft.problems.join(" · ")}
            </Text>
          )}
          <div>
            <Button size="small" disabled={!draft?.body} isLoading={update.isPending} onClick={decide}>
              Record decision
            </Button>
          </div>
        </div>
      )}
    </Container>
  )
}

const DecidedPanel = ({ dispute }: { dispute: AdminDispute }) => {
  const escrow = escrowTransitionFor(dispute.status, dispute.escrow_agreement_id)

  return (
    <Container className="px-6 py-4">
      <Heading level="h2">Decision</Heading>
      <div className="mt-2">
        <Field label="Outcome">{STATUS_LABELS[dispute.status]}</Field>
        {dispute.status === "resolved_refund" && (
          <Field label="Awarded">{formatMinor(dispute.award_amount, dispute.currency_code)}</Field>
        )}
        <Field label="Decided">
          {dispute.resolved_at ? new Date(dispute.resolved_at).toLocaleString() : "—"}
          {dispute.resolved_by && <> · by {dispute.resolved_by}</>}
        </Field>
        <Field label="Note">
          <span className="whitespace-pre-wrap">{dispute.resolution_note || "None was written."}</span>
        </Field>
      </div>
      {dispute.status === "resolved_refund" && !escrow && (
        <Text size="small" className="text-ui-fg-subtle mt-2">
          No money has moved. No escrow agreement is recorded for this order; if it was paid normally, refund
          through the order&apos;s payment.
        </Text>
      )}
      {escrow && (
        <Text size="small" className="text-ui-fg-subtle mt-2">
          Escrow agreement <span className="font-mono">{dispute.escrow_agreement_id}</span>: this decision implies{" "}
          <span className="font-mono">{escrow}</span>. This screen did not move the escrowed funds.
        </Text>
      )}
    </Container>
  )
}

const EventLog = ({ events, currencyCode }: { events: AdminDisputeEvent[]; currencyCode: string }) => (
  <Container className="px-6 py-4">
    <Heading level="h2">Event log</Heading>
    {events.length === 0 ? (
      <Text size="small" className="text-ui-fg-subtle mt-2">
        No events recorded.
      </Text>
    ) : (
      <ol className="mt-2 flex flex-col gap-3">
        {events.map((e) => (
          <li key={e.id} className="border-ui-border-base border-l-2 pl-3">
            <Text size="small" weight="plus">
              {describeEvent(e, currencyCode)}
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              {new Date(e.created_at).toLocaleString()}
              {e.actor_id && <> · {e.actor_id}</>}
            </Text>
            {e.message && (
              <Text size="small" className="mt-1 whitespace-pre-wrap">
                {e.message}
              </Text>
            )}
          </li>
        ))}
      </ol>
    )}
  </Container>
)

export const DisputeDetail = () => {
  const { id = "" } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { dispute, events, isLoading, error } = useDispute(id)

  const back = (
    <div>
      <Button variant="transparent" size="small" onClick={() => navigate("/disputes")}>
        <ArrowLeft />
        Back to disputes
      </Button>
    </div>
  )

  if (isLoading) {
    return (
      <Container className="px-6 py-4">
        <Text className="text-ui-fg-subtle">Loading dispute…</Text>
      </Container>
    )
  }

  if (error || !dispute) {
    return (
      <div className="flex flex-col gap-y-3">
        {back}
        <Container className="px-6 py-4">
          <Text className="text-ui-fg-error">
            Failed to load the dispute{error ? `: ${(error as Error).message}` : ""}
          </Text>
        </Container>
      </div>
    )
  }

  const days = daysWaiting(dispute.created_at)

  return (
    <div className="flex flex-col gap-y-3">
      {back}
      <Container className="px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Heading>Dispute</Heading>
          <Badge size="2xsmall" color={STATUS_COLORS[dispute.status]}>
            {STATUS_LABELS[dispute.status]}
          </Badge>
        </div>
        <Text size="small" className="text-ui-fg-subtle font-mono">
          {dispute.id}
        </Text>
        <div className="mt-3">
          <Field label="Reason">{REASON_LABELS[dispute.reason] ?? dispute.reason}</Field>
          <Field label="Opened">
            {new Date(dispute.created_at).toLocaleString()}
            {isLive(dispute.status) && days !== null && <> · waiting {days} day{days === 1 ? "" : "s"}</>}
          </Field>
          <Field label="Claimed">{formatMinor(dispute.claim_amount, dispute.currency_code)}</Field>
          <Field label="Escrow">
            {dispute.escrow_agreement_id ? (
              <span className="font-mono">{dispute.escrow_agreement_id}</span>
            ) : (
              "No escrow agreement recorded"
            )}
          </Field>
          <Field label="Buyer's account">
            <span className="whitespace-pre-wrap">{dispute.description}</span>
          </Field>
          <Submitted metadata={dispute.metadata} />
        </div>
      </Container>

      <Parties dispute={dispute} />

      <Container className="px-6 py-4">
        <Heading level="h2">Seller&apos;s response</Heading>
        {dispute.seller_response ? (
          <>
            <Text size="small" className="mt-2 whitespace-pre-wrap">
              {dispute.seller_response}
            </Text>
            {dispute.seller_responded_at && (
              <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                {new Date(dispute.seller_responded_at).toLocaleString()}
              </Text>
            )}
          </>
        ) : (
          <Text size="small" className="text-ui-fg-subtle mt-2">
            The seller has not responded. Ask them for their side before deciding: their contact is above.
          </Text>
        )}
      </Container>

      {isLive(dispute.status) ? <DecisionPanel dispute={dispute} /> : <DecidedPanel dispute={dispute} />}

      <EventLog events={events ?? []} currencyCode={dispute.currency_code} />
    </div>
  )
}

"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/atoms/Button/Button"
import ErrorMessage from "@/components/molecules/ErrorMessage/ErrorMessage"
import {
  approveAutoRenew,
  cancelSubscription,
  disableAutoRenew,
} from "@/lib/data/subscriptions"
import {
  AUTO_RENEW_CHECKBOX_LABEL,
  autoRenewState,
  canCancel,
  chargeSummary,
  reapprovalDisclosure,
  statusLabel,
  type StoreSubscription,
} from "@/lib/subscriptions/auto-renew"

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" }) : null

type RowViewProps = {
  subscription: StoreSubscription
  title: string
  /** Formatted current price per interval, when known. */
  price: string | null
  approveTicked: boolean
  busy: boolean
  error: string | null
  now?: Date
  onToggleApprove: (ticked: boolean) => void
  onDisable: () => void
  onApprove: () => void
  onCancel: () => void
}

/**
 * One subscription, hook-free: status, next charge, automatic renewal on/off
 * with its toggle, cancel. Turning renewal back on shows the current
 * disclosure again with an unticked checkbox; the button stays disabled until
 * the customer ticks it.
 */
export const SubscriptionRowView = ({
  subscription: sub,
  title,
  price,
  approveTicked,
  busy,
  error,
  now,
  onToggleApprove,
  onDisable,
  onApprove,
  onCancel,
}: RowViewProps) => {
  const renew = autoRenewState(sub, now)
  const summary = chargeSummary(sub, formatDate, now)
  const paidThrough = formatDate(sub.expiration_date)

  return (
    <li className="border rounded-sm p-4 space-y-2" data-testid="subscription-row">
      <div className="flex flex-row justify-between gap-2">
        <h3 className="label-lg">{title}</h3>
        <span className="label-md" data-testid="subscription-status">
          {statusLabel(sub.status)}
        </span>
      </div>

      {sub.status === "past_due" && sub.grace_ends_at && (
        <p className="text-sm">Grace period until {formatDate(sub.grace_ends_at)}.</p>
      )}
      {sub.status === "read_only" && (
        <p className="text-sm">Read-only: full access has ended.</p>
      )}

      <p className="text-sm" data-testid="subscription-next-charge">
        {summary.charge}
      </p>

      <p className="text-sm" data-testid="subscription-auto-renew">
        {summary.autoRenew}
      </p>

      {renew.kind === "on" && (
        <Button variant="tonal" disabled={busy} onClick={onDisable}>
          Turn off automatic renewal
        </Button>
      )}

      {renew.kind === "off_can_approve" && price && paidThrough && (
        <div className="space-y-2">
          <label className="flex items-start gap-3" htmlFor={`approve-${sub.id}`}>
            <input
              id={`approve-${sub.id}`}
              type="checkbox"
              className="mt-1"
              checked={approveTicked}
              onChange={(e) => onToggleApprove(e.target.checked)}
              data-testid="reapprove-checkbox"
            />
            <span>
              <span className="label-md block">{AUTO_RENEW_CHECKBOX_LABEL}</span>
              <span className="text-sm text-secondary block" data-testid="reapprove-disclosure">
                {reapprovalDisclosure({ price, interval: sub.interval, paidThrough })}
              </span>
            </span>
          </label>
          <Button variant="tonal" disabled={busy || !approveTicked} onClick={onApprove}>
            Turn on automatic renewal
          </Button>
        </div>
      )}

      {canCancel(sub) && (
        <Button variant="text" disabled={busy} onClick={onCancel}>
          Cancel subscription
        </Button>
      )}
      <ErrorMessage error={error} data-testid="subscription-error-message" />
    </li>
  )
}

const SubscriptionRow = ({
  subscription,
  title,
  price,
}: {
  subscription: StoreSubscription
  title: string
  price: string | null
}) => {
  const router = useRouter()
  const [approveTicked, setApproveTicked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await action()
      if (!res.ok) setError(res.error)
      else {
        setApproveTicked(false)
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <SubscriptionRowView
      subscription={subscription}
      title={title}
      price={price}
      approveTicked={approveTicked}
      busy={busy}
      error={error}
      onToggleApprove={setApproveTicked}
      onDisable={() => run(() => disableAutoRenew(subscription.id))}
      onApprove={() => run(() => approveAutoRenew(subscription.id))}
      onCancel={() => run(() => cancelSubscription(subscription.id))}
    />
  )
}

export const SubscriptionsList = ({
  subscriptions,
  products,
}: {
  subscriptions: StoreSubscription[]
  products: Record<string, { title: string; price: string | null }>
}) => {
  if (!subscriptions.length) {
    return (
      <div className="text-center">
        <h3 className="heading-lg text-primary uppercase">No subscriptions</h3>
        <p className="text-lg text-secondary mt-2">
          Subscriptions you start will appear here.
        </p>
      </div>
    )
  }
  return (
    <ul className="space-y-4">
      {subscriptions.map((sub) => {
        const product = sub.product_id ? products[sub.product_id] : undefined
        return (
          <SubscriptionRow
            key={sub.id}
            subscription={sub}
            title={product?.title ?? "Subscription"}
            price={product?.price ?? null}
          />
        )
      })}
    </ul>
  )
}

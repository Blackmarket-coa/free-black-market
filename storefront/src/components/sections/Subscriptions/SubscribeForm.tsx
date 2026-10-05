"use client"

import { useState } from "react"
import { Button } from "@/components/atoms/Button/Button"
import ErrorMessage from "@/components/molecules/ErrorMessage/ErrorMessage"
import { startSubscriptionCheckout } from "@/lib/data/subscriptions"
import {
  AUTO_RENEW_CHECKBOX_LABEL,
  CANCEL_ANYTIME_TERMS,
  autoRenewDisclosure,
  gracePolicyTerms,
  intervalNoun,
  oneTimeTerms,
  subscribeSubmission,
  type SubscriptionCheckout,
  type SubscriptionInterval,
} from "@/lib/subscriptions/auto-renew"

type ViewProps = {
  productTitle: string
  price: string
  interval: SubscriptionInterval
  /** The product's own grace length; null when it sets none. */
  graceDays: number | null
  autoRenewTicked: boolean
  submitting: boolean
  error: string | null
  onToggle: (ticked: boolean) => void
  onSubmit: (checkout: SubscriptionCheckout) => void
}

/**
 * The subscribe step, hook-free: price, interval, the auto-renewal disclosure
 * with its checkbox (unticked unless the customer ticks it), the cancel-anytime
 * terms and the grace / read-only policy. The checkbox alone decides whether
 * the submission carries an auto-renew approval.
 */
export const SubscribeFormView = ({
  productTitle,
  price,
  interval,
  graceDays,
  autoRenewTicked,
  submitting,
  error,
  onToggle,
  onSubmit,
}: ViewProps) => {
  const noun = intervalNoun(interval)
  return (
    <div className="border rounded-sm p-4 space-y-4" data-testid="subscribe-form">
      <div>
        <h2 className="heading-sm">{productTitle}</h2>
        <p className="text-lg" data-testid="subscribe-price">
          {price} per {noun}
        </p>
      </div>

      <label className="flex items-start gap-3" htmlFor="auto-renew-approval">
        <input
          id="auto-renew-approval"
          type="checkbox"
          className="mt-1"
          checked={autoRenewTicked}
          onChange={(e) => onToggle(e.target.checked)}
          data-testid="auto-renew-checkbox"
        />
        <span>
          <span className="label-md block">{AUTO_RENEW_CHECKBOX_LABEL}</span>
          <span className="text-sm text-secondary block" data-testid="auto-renew-disclosure">
            {autoRenewDisclosure({ price, interval })}
          </span>
        </span>
      </label>

      {!autoRenewTicked && (
        <p className="text-sm" data-testid="one-time-terms">
          {oneTimeTerms({ price, interval })}
        </p>
      )}

      <p className="text-sm text-secondary">{CANCEL_ANYTIME_TERMS}</p>
      <p className="text-sm text-secondary" data-testid="grace-policy-terms">
        {gracePolicyTerms(graceDays)}
      </p>

      <Button
        className="w-full"
        loading={submitting}
        disabled={submitting}
        onClick={() => onSubmit(subscribeSubmission({ interval, autoRenewTicked }))}
      >
        {autoRenewTicked ? `Subscribe — renews every ${noun}` : `Pay for one ${noun}`}
      </Button>
      <ErrorMessage error={error} data-testid="subscribe-error-message" />
    </div>
  )
}

export const SubscribeForm = ({
  productTitle,
  price,
  interval,
  graceDays,
  variantId,
  countryCode,
}: {
  productTitle: string
  price: string
  interval: SubscriptionInterval
  graceDays: number | null
  variantId: string
  countryCode: string
}) => {
  const [autoRenewTicked, setAutoRenewTicked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (checkout: SubscriptionCheckout) => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await startSubscriptionCheckout({ variantId, countryCode, checkout })
      if (res && !res.ok) setError(res.error)
    } catch (err) {
      const message = (err as { message?: string })?.message
      if (message !== "NEXT_REDIRECT") {
        setError(message || "The subscription could not be started.")
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SubscribeFormView
      productTitle={productTitle}
      price={price}
      interval={interval}
      graceDays={graceDays}
      autoRenewTicked={autoRenewTicked}
      submitting={submitting}
      error={error}
      onToggle={setAutoRenewTicked}
      onSubmit={onSubmit}
    />
  )
}

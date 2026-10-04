"use client"

import { useMemo, useState, useTransition } from "react"
import { loadStripe, type Stripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { Button } from "@/components/atoms"
import { createDirectDonationCheckout, type DirectDonationIntent } from "@/lib/data/donations"
import type { PartnerOrg } from "@/lib/data/partners"
import { partnerOrgBadge } from "@/lib/helpers/partner-org-badge"
import { DIRECT_DONATION_DISCLOSURE } from "@/lib/helpers/direct-donation"

/**
 * Direct-charge donation to one partner org (docs/POSTURE_A_COMPLIANCE.md rule 10).
 *
 * Step 1 asks the API for a PaymentIntent, which it creates ON the org's own
 * Stripe account. Step 2 confirms that intent with Stripe.js loaded for the
 * same `stripe_account_id` — the client secret belongs to the connected
 * account, so Stripe.js must be too. BMC takes 0; the org pays the processing
 * fee; the disclosure says exactly that and nothing about tax status (the
 * badge beside the org name carries the IRS-file wording, L11).
 *
 * Rendered only when the storefront's `phase1ModuleFlags.nonprofitParity` is
 * on; the API answers 404 to the request otherwise.
 */

const STRIPE_KEY = process.env.NEXT_PUBLIC_STRIPE_KEY
const PRESETS_CENTS = [1000, 2500, 5000, 10000]

type Props = {
  orgs: PartnerOrg[]
}

export default function DirectDonationForm({ orgs }: Props) {
  const [orgKey, setOrgKey] = useState(orgs[0]?.key ?? "")
  const [amountCents, setAmountCents] = useState(2500)
  const [intent, setIntent] = useState<DirectDonationIntent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const org = useMemo(() => orgs.find((o) => o.key === orgKey) ?? null, [orgs, orgKey])
  const badge = org ? partnerOrgBadge(org) : null

  if (orgs.length === 0) {
    return <p className="text-sm text-ui-fg-subtle">No partner organisation is accepting direct donations yet.</p>
  }

  if (intent) {
    return <ConfirmStep intent={intent} onReset={() => setIntent(null)} />
  }

  return (
    <form
      className="space-y-3 rounded border p-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
          try {
            const result = await createDirectDonationCheckout({ donations: [{ org_key: orgKey, amount_cents: amountCents }] })
            setIntent(result.donations[0] ?? null)
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not start the donation.")
          }
        })
      }}
    >
      <label className="block text-sm">
        <span className="mb-1 block">Organisation</span>
        <select value={orgKey} onChange={(e) => setOrgKey(e.target.value)} className="w-full border rounded px-3 py-2">
          {orgs.map((o) => (
            <option value={o.key} key={o.key}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      {badge ? <p className="text-xs text-ui-fg-subtle">{badge.label}</p> : null}

      <fieldset className="text-sm">
        <legend className="mb-1 block">Amount</legend>
        <div className="flex flex-wrap gap-2">
          {PRESETS_CENTS.map((cents) => (
            <button
              type="button"
              key={cents}
              onClick={() => setAmountCents(cents)}
              className={`border rounded px-3 py-1 ${amountCents === cents ? "bg-gray-100 font-medium" : ""}`}
              aria-pressed={amountCents === cents}
            >
              ${(cents / 100).toFixed(0)}
            </button>
          ))}
          <input
            type="number"
            min={1}
            step={1}
            value={Math.round(amountCents / 100)}
            onChange={(e) => setAmountCents(Math.max(100, Math.round(Number(e.target.value || 0)) * 100))}
            className="w-24 border rounded px-3 py-1"
            aria-label="Custom amount in dollars"
          />
        </div>
      </fieldset>

      <p className="text-xs text-gray-600" data-testid="direct-donation-disclosure">
        {DIRECT_DONATION_DISCLOSURE}
      </p>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <Button type="submit" size="small" loading={isPending} disabled={!orgKey || amountCents < 100}>
        Continue to payment
      </Button>
    </form>
  )
}

function ConfirmStep({ intent, onReset }: { intent: DirectDonationIntent; onReset: () => void }) {
  // Stripe.js for the CONNECTED account: the client secret was minted there.
  const stripePromise = useMemo<Promise<Stripe | null> | null>(
    () => (STRIPE_KEY ? loadStripe(STRIPE_KEY, { stripeAccount: intent.stripe_account_id }) : null),
    [intent.stripe_account_id]
  )

  if (!STRIPE_KEY || !stripePromise || !intent.client_secret) {
    return (
      <div className="space-y-2 rounded border p-4 text-sm">
        <p>
          A donation of ${(intent.gross_cents / 100).toFixed(2)} to <span className="font-medium">{intent.org_name}</span> was
          prepared on the organisation&apos;s own Stripe account, but card entry is not configured on this storefront.
        </p>
        <p className="text-xs text-gray-600">{DIRECT_DONATION_DISCLOSURE}</p>
        <Button size="small" variant="text" onClick={onReset}>
          Back
        </Button>
      </div>
    )
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret: intent.client_secret }}>
      <PaymentStep intent={intent} onReset={onReset} />
    </Elements>
  )
}

function PaymentStep({ intent, onReset }: { intent: DirectDonationIntent; onReset: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (done) {
    return (
      <div className="space-y-2 rounded border p-4 text-sm" data-testid="direct-donation-done">
        <p>
          Thank you. ${(intent.gross_cents / 100).toFixed(2)} went to <span className="font-medium">{intent.org_name}</span> on its own
          Stripe account.
        </p>
        <p className="text-xs text-gray-600">{DIRECT_DONATION_DISCLOSURE}</p>
      </div>
    )
  }

  return (
    <form
      className="space-y-3 rounded border p-4"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!stripe || !elements) return
        setSubmitting(true)
        setError(null)
        const result = await stripe.confirmPayment({
          elements,
          redirect: "if_required",
          confirmParams: { return_url: typeof window !== "undefined" ? window.location.href : "" },
        })
        setSubmitting(false)
        if (result.error) {
          setError(result.error.message ?? "The payment could not be confirmed.")
          return
        }
        setDone(true)
      }}
    >
      <p className="text-sm">
        ${(intent.gross_cents / 100).toFixed(2)} to <span className="font-medium">{intent.org_name}</span>
      </p>
      <PaymentElement />
      <p className="text-xs text-gray-600">{DIRECT_DONATION_DISCLOSURE}</p>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="small" loading={submitting} disabled={!stripe || !elements}>
          Donate ${(intent.gross_cents / 100).toFixed(2)}
        </Button>
        <Button type="button" size="small" variant="text" onClick={onReset} disabled={submitting}>
          Back
        </Button>
      </div>
    </form>
  )
}

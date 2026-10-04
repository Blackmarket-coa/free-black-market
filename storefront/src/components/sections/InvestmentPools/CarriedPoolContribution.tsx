"use client"

import { useMemo, useState } from "react"
import { loadStripe, type Stripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import {
  contributeToCarriedPool,
  HawalaRequestError,
  type CarriedPoolContributionIntent,
  type PoolCarrier,
} from "@/lib/hooks/useHawalaWallet"

/**
 * A contribution to a nonprofit-CARRIED investment pool, paid to the carrier
 * through FBM (docs/BMC_SURVIVAL_PROGRAMS.md Decision 7; legal checkpoint L26
 * gates go-live — the flags stay unset until counsel clears it).
 *
 * The same two steps as `DirectDonationForm`: step 1 asks the API for a
 * PaymentIntent, which it creates ON the carrier's own Stripe account; step 2
 * confirms that intent with Stripe.js loaded for the same `stripe_account_id`.
 * Free Black Market never holds the funds and takes no fee; the carrier bears
 * card processing. The pool's total is NOT updated optimistically: it moves
 * when the carrier's processor confirms the payment and the Connect webhook
 * records it, so the success copy says exactly that.
 *
 * Return language is rendered from the pool record — the fields
 * `GET /store/hawala/pools` actually returns (`roi_type`, `roi_rate`,
 * `revenue_share_percentage`) — and prefixed "as stated on the pool record":
 * the terms are set on the pool by its producer or an admin, never stated by
 * the carrier, and a figure the listing does not carry is said to be missing,
 * never shown as 0. No promise beyond what the record states (L3, L26).
 *
 * Before the API answers, the copy names no one: the pool projection carries
 * only the carrier's org KEY (a slug), so the pre-payment disclosure is
 * neutral; from the API's answer on, it names the carrier
 * (`carrier_org_name`, and the server-built `disclosure`).
 *
 * Rendered only when `phase1ModuleFlags.nonprofitParity` and
 * `phase1ModuleFlags.investmentPools` are both on; the API answers 404
 * otherwise.
 */

const STRIPE_KEY = process.env.NEXT_PUBLIC_STRIPE_KEY

export type CarriedPoolSummary = {
  id: string
  name: string
  minimum_investment: number
  roi_type: string
  /** The store payload's `roi_rate` (the pool's `roi_rate` or `fixed_roi_rate`): an annual percentage, 0–100. */
  roi_rate?: number | null
  revenue_share_percentage?: number | null
  carrier: PoolCarrier
}

type Props = {
  pool: CarriedPoolSummary
  onClose: () => void
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
}

function statedFigure(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * The pool record's own return terms, never embellished, from exactly the
 * fields the store listing returns. A figure the listing does not carry is
 * said to be missing — never rendered as 0, which would be a statement about
 * terms nobody made.
 */
export function statedPoolReturn(pool: Pick<CarriedPoolSummary, "roi_type" | "roi_rate" | "revenue_share_percentage">): string {
  switch (pool.roi_type) {
    case "FIXED_RATE": {
      const rate = statedFigure(pool.roi_rate)
      return rate === null ? "a fixed annual rate (no rate is stated on the pool record)" : `${rate}% annual rate`
    }
    case "REVENUE_SHARE": {
      const share = statedFigure(pool.revenue_share_percentage)
      return share === null ? "a share of revenue (no percentage is stated on the pool record)" : `${share}% of revenue shared`
    }
    case "PRODUCT_CREDIT":
      return "product credit (the credit multiplier is not shown in this listing)"
    case "HYBRID":
      return "a combination of terms (not itemised in this listing)"
    default:
      return pool.roi_type
  }
}

/** The one sentence a contributor sees before the API has named the carrier. */
export function carriedPoolDisclosure(): string {
  return "You are paying this pool's carrier directly. Free Black Market never holds these funds and takes no fee; the carrier bears card processing."
}

export default function CarriedPoolContribution({ pool, onClose }: Props) {
  const [amount, setAmount] = useState("")
  const [intent, setIntent] = useState<CarriedPoolContributionIntent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (intent) {
    return <ConfirmStep intent={intent} pool={pool} onClose={onClose} onBack={() => setIntent(null)} />
  }

  const parsed = parseFloat(amount)
  const amountValid = Number.isFinite(parsed) && parsed >= pool.minimum_investment && parsed >= 0.5

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <form
        className="bg-white rounded-lg max-w-md w-full p-6 space-y-4"
        data-testid="carried-pool-contribution"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!amountValid) {
            setError(`Minimum contribution is ${formatCurrency(pool.minimum_investment)}`)
            return
          }
          setSubmitting(true)
          setError(null)
          try {
            const result = await contributeToCarriedPool(pool.id, Math.round(parsed * 100))
            setIntent(result)
          } catch (err) {
            if (err instanceof HawalaRequestError) {
              setError(err.type === "not_allowed" ? "This pool's carrier cannot accept contributions right now." : err.message)
            } else {
              setError(err instanceof Error ? err.message : "Could not start the contribution.")
            }
          } finally {
            setSubmitting(false)
          }
        }}
      >
        <h3 className="text-lg font-semibold">Contribute to {pool.name}</h3>

        <p className="text-sm text-gray-600">{carriedPoolDisclosure()}</p>
        <p className="text-xs text-gray-500">
          Return, as stated on the pool record: {statedPoolReturn(pool)}. Free Black Market makes no promise beyond what the
          pool record states.
        </p>
        {pool.carrier.verified_as_of ? (
          <p className="text-xs text-gray-500">
            Carrier verification: {pool.carrier.verification_status}, IRS file as of{" "}
            {new Date(pool.carrier.verified_as_of).toLocaleDateString()}.
          </p>
        ) : null}

        <label className="block text-sm font-medium text-gray-700">
          Contribution amount
          <input
            type="number"
            min={pool.minimum_investment}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Min: ${formatCurrency(pool.minimum_investment)}`}
            className="mt-1 w-full border rounded-lg px-3 py-2 font-normal"
            aria-label="Contribution amount in dollars"
          />
        </label>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50" disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !amount}
            className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-300"
          >
            {submitting ? "Starting..." : "Continue to payment"}
          </button>
        </div>
      </form>
    </div>
  )
}

function ConfirmStep({ intent, pool, onClose, onBack }: { intent: CarriedPoolContributionIntent; pool: CarriedPoolSummary; onClose: () => void; onBack: () => void }) {
  // Stripe.js for the CONNECTED account: the client secret was minted there.
  const stripePromise = useMemo<Promise<Stripe | null> | null>(
    () => (STRIPE_KEY ? loadStripe(STRIPE_KEY, { stripeAccount: intent.stripe_account_id }) : null),
    [intent.stripe_account_id]
  )

  if (!STRIPE_KEY || !stripePromise || !intent.client_secret) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-3 text-sm">
          <p>
            A contribution of ${(intent.gross_cents / 100).toFixed(2)} to <span className="font-medium">{pool.name}</span> was
            prepared on {intent.carrier_org_name}&apos;s own Stripe account, but card entry is not configured on this storefront.
          </p>
          <p className="text-xs text-gray-600">{intent.disclosure}</p>
          <div className="flex gap-3">
            <button type="button" onClick={onBack} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">
              Back
            </button>
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret: intent.client_secret }}>
      <PaymentStep intent={intent} pool={pool} onClose={onClose} onBack={onBack} />
    </Elements>
  )
}

function PaymentStep({ intent, pool, onClose, onBack }: { intent: CarriedPoolContributionIntent; pool: CarriedPoolSummary; onClose: () => void; onBack: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // "paid": the processor reports the payment succeeded. "submitted": no
  // error, but not succeeded yet (e.g. `processing` for a delayed method) —
  // the copy must not say the money went anywhere.
  const [outcome, setOutcome] = useState<"paid" | "submitted" | null>(null)
  const amount = `$${(intent.gross_cents / 100).toFixed(2)}`

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      {outcome ? (
        <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-3 text-sm" data-testid="carried-pool-contribution-done">
          {outcome === "paid" ? (
            <p>
              Thank you. {amount} was paid to <span className="font-medium">{intent.carrier_org_name}</span> on its own Stripe
              account, for {pool.name}.
            </p>
          ) : (
            <p>
              Thank you. Your payment of {amount} to <span className="font-medium">{intent.carrier_org_name}</span> for {pool.name} was
              submitted and is pending with the processor; it has not completed yet.
            </p>
          )}
          <p className="text-xs text-gray-600">
            Recorded when the carrier&apos;s processor confirms it. The pool&apos;s total updates then, not before.
          </p>
          <p className="text-xs text-gray-600">{intent.disclosure}</p>
          <button type="button" onClick={onClose} className="w-full px-4 py-2 border rounded-lg hover:bg-gray-50">
            Close
          </button>
        </div>
      ) : (
        <form
          className="bg-white rounded-lg max-w-md w-full p-6 space-y-3"
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
            setOutcome(result.paymentIntent.status === "succeeded" ? "paid" : "submitted")
          }}
        >
          <p className="text-sm">
            {amount} to <span className="font-medium">{intent.carrier_org_name}</span> for {pool.name}
          </p>
          <PaymentElement />
          <p className="text-xs text-gray-600">{intent.disclosure}</p>
          <p className="text-xs text-gray-500">Return, as stated on the pool record: {statedPoolReturn(pool)}.</p>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <div className="flex gap-3">
            <button type="button" onClick={onBack} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50" disabled={submitting}>
              Back
            </button>
            <button
              type="submit"
              disabled={!stripe || !elements || submitting}
              className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-300"
            >
              {submitting ? "Confirming..." : `Contribute ${amount}`}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

import { Button } from "@/components/atoms"
import {
  CLAIM_REASON_LABELS,
  CLAIM_WINDOW_DAYS,
  fileOrderClaim,
  type OrderClaimReason,
} from "@/lib/data/order-claims"

const REASONS = Object.keys(CLAIM_REASON_LABELS) as OrderClaimReason[]

const MIN_DESCRIPTION = 20

/**
 * The buyer-facing claim form.
 *
 * Deliberately short. Someone filing this has already had a bad experience, and
 * every extra required field is another reason to give up and charge back
 * instead — which costs the seller more and tells us nothing.
 */
export const OrderClaimSection = ({ orderId }: { orderId: string }) => {
  const router = useRouter()
  const [reason, setReason] = useState<OrderClaimReason>("not_received")
  const [description, setDescription] = useState("")
  const [contactedSeller, setContactedSeller] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const tooShort = description.trim().length < MIN_DESCRIPTION

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (tooShort || submitting) return

    setSubmitting(true)
    setError(null)

    const result = await fileOrderClaim({
      order_id: orderId,
      reason,
      description: description.trim(),
      contacted_seller: contactedSeller,
    })

    if (result.ok) {
      router.push(`/user/orders/${orderId}/request-success`)
      return
    }

    // Surface the backend's reason — outside the window, or an existing open
    // claim — because each tells the buyer something different to do next.
    setError(result.message)
    setSubmitting(false)
  }

  return (
    <form onSubmit={onSubmit} className="border rounded-sm p-4 space-y-5">
      <div>
        <h2 className="heading-sm uppercase mb-1">Report a problem</h2>
        <p className="label-md text-secondary">
          For orders placed in the last {CLAIM_WINDOW_DAYS} days. If you
          haven&apos;t yet, messaging the seller is usually faster — but you
          don&apos;t have to wait for them.{" "}
          <Link href="/buyer-protection" className="underline">
            What&apos;s covered
          </Link>
          .
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="label-md font-medium mb-1">What went wrong?</legend>
        {REASONS.map((value) => (
          <label key={value} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="reason"
              value={value}
              checked={reason === value}
              onChange={() => setReason(value)}
            />
            <span className="label-md">{CLAIM_REASON_LABELS[value]}</span>
          </label>
        ))}
      </fieldset>

      <div>
        <label htmlFor="claim-description" className="label-md font-medium block mb-1">
          What happened?
        </label>
        <textarea
          id="claim-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          className="w-full border rounded-sm p-2 label-md"
          placeholder="A sentence or two is enough. Dates and tracking details help."
          aria-describedby="claim-description-help"
        />
        <p id="claim-description-help" className="label-sm text-secondary mt-1">
          {tooShort
            ? `${MIN_DESCRIPTION - description.trim().length} more characters needed.`
            : "Thanks — that's enough to review."}
        </p>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={contactedSeller}
          onChange={(e) => setContactedSeller(e.target.checked)}
        />
        <span className="label-md">I&apos;ve already contacted the seller</span>
      </label>

      {error && (
        <p role="alert" className="label-md text-negative">
          {error}
        </p>
      )}

      <Button type="submit" disabled={tooShort || submitting}>
        {submitting ? "Filing…" : "File claim"}
      </Button>
    </form>
  )
}

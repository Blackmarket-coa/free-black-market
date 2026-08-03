import { useEffect, useRef, useState } from "react"
import { Button, Text, toast } from "@medusajs/ui"

import { useBillingSetupIntent } from "../../../hooks/api/vendor-billing"
import { mountCardSetup, type CardMount } from "../../../lib/stripe-setup"

type Props = {
  onSaved: () => void
  onCancel: () => void
}

/**
 * Card capture against a SetupIntent.
 *
 * The flow is: ask the backend for a SetupIntent (which returns the client
 * secret and the publishable key), mount a Stripe Elements card field, and
 * confirm. Card data lives in the Stripe iframe the whole time — this
 * component never sees a card number.
 *
 * Every failure mode resolves to a message, never a thrown error: a card form
 * that white-screens on a slow CDN is worse than one that says "try again".
 */
export const PaymentMethodForm = ({ onSaved, onCancel }: Props) => {
  const cardRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<CardMount | null>(null)
  const [status, setStatus] = useState<
    "loading" | "ready" | "unavailable" | "submitting"
  >("loading")
  const [cardError, setCardError] = useState<string | null>(null)

  const { mutateAsync: createSetupIntent } = useBillingSetupIntent()

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const intent = await createSetupIntent()
        if (cancelled) return

        if (!intent.client_secret || !intent.publishable_key || !cardRef.current) {
          setStatus("unavailable")
          return
        }

        const mount = await mountCardSetup({
          publishableKey: intent.publishable_key,
          clientSecret: intent.client_secret,
          container: cardRef.current,
        })
        if (cancelled) {
          mount?.destroy()
          return
        }
        if (!mount) {
          setStatus("unavailable")
          return
        }

        mount.onError(setCardError)
        mountRef.current = mount
        setStatus("ready")
      } catch {
        if (!cancelled) setStatus("unavailable")
      }
    })()

    return () => {
      cancelled = true
      mountRef.current?.destroy()
      mountRef.current = null
    }
    // createSetupIntent identity is stable from react-query; run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async () => {
    if (!mountRef.current) return
    setStatus("submitting")
    setCardError(null)

    const result = await mountRef.current.confirm()
    if (result.ok) {
      toast.success("Payment method saved")
      onSaved()
      return
    }
    setCardError(result.error)
    setStatus("ready")
  }

  if (status === "unavailable") {
    return (
      <div className="flex flex-col gap-y-3">
        <Text size="small" className="text-ui-fg-subtle">
          Card entry is not available right now. Self-serve payment may not be
          enabled on this marketplace yet — the team can arrange billing with
          you directly.
        </Text>
        <div>
          <Button variant="secondary" size="small" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-4">
      <div
        ref={cardRef}
        className="border-ui-border-base rounded-md border p-3"
        aria-label="Card details"
      />
      {cardError ? (
        <Text size="small" className="text-ui-fg-error">
          {cardError}
        </Text>
      ) : null}
      <div className="flex items-center gap-x-2">
        <Button
          size="small"
          onClick={handleSubmit}
          isLoading={status === "submitting"}
          disabled={status !== "ready"}
        >
          Save card
        </Button>
        <Button
          variant="secondary"
          size="small"
          onClick={onCancel}
          disabled={status === "submitting"}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

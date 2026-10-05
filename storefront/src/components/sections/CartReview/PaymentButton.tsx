"use client"

import ErrorMessage from "@/components/molecules/ErrorMessage/ErrorMessage"
import { isManual, isStripe } from "../../../lib/constants"
import { placeOrder, placeTicketOrder } from "@/lib/data/cart"
import { HttpTypes } from "@medusajs/types"
import { useElements, useStripe } from "@stripe/react-stripe-js"
import React, { useEffect, useState } from "react"
import { Button } from "@/components/atoms"
import { orderErrorFormatter } from "@/lib/helpers/order-error-formatter"
import { toast } from "@/lib/helpers/toast"
import { phase1ModuleFlags } from "@/lib/feature-flags"
import { completeSubscriptionCheckout } from "@/lib/data/subscriptions"
import {
  intervalNoun,
  subscriptionCheckoutOf,
} from "@/lib/subscriptions/auto-renew"

type PaymentButtonProps = {
  cart: HttpTypes.StoreCart
  "data-testid": string
}

// Ticket line items carry seat metadata (stamped by the ticket purchase
// panel). A cart completes via the ticket-aware endpoint ONLY when it is
// entirely tickets — a mixed cart routed through /complete-tickets would send
// the non-ticket (and other-seller) items through the stock completion flow,
// bypassing the marketplace split. Mixed carts are blocked at checkout.
const cartTicketMode = (
  cart?: HttpTypes.StoreCart | null
): "none" | "all-tickets" | "mixed" => {
  const items = cart?.items ?? []
  const ticketCount = items.filter((item) => !!item.metadata?.show_date).length
  if (ticketCount === 0) return "none"
  return ticketCount === items.length ? "all-tickets" : "mixed"
}

/**
 * A subscription cart (NEXT_PUBLIC_FF_CONSUMER_SUBSCRIPTIONS_V1 only) completes
 * through POST /store/subscriptions, carrying the customer's auto-renew answer.
 * Returns true when it handled the cart; with the flag off it never does, so
 * every other cart completes exactly as before.
 */
const completeIfSubscription = async (
  cart: HttpTypes.StoreCart,
  setErrorMessage: (message: string | null) => void
): Promise<boolean> => {
  const checkout = subscriptionCheckoutOf(cart, phase1ModuleFlags.consumerSubscriptions)
  if (!checkout) return false
  const res = await completeSubscriptionCheckout(cart.id, checkout)
  if (!res.ok) setErrorMessage(res.error)
  return true
}

/** The customer's recorded auto-renew answer, restated beside the final button. */
const SubscriptionCheckoutNote = ({ cart }: { cart: HttpTypes.StoreCart }) => {
  const checkout = subscriptionCheckoutOf(cart, phase1ModuleFlags.consumerSubscriptions)
  if (!checkout) return null
  const noun = intervalNoun(checkout.interval)
  return (
    <p className="mb-2 text-sm text-secondary" data-testid="subscription-checkout-note">
      {checkout.auto_renew_approved
        ? `Automatic renewal is on: this subscription renews every ${noun} until you cancel.`
        : `Automatic renewal is off: you are paying for one ${noun} and nothing charges you again.`}
    </p>
  )
}

const PaymentButton: React.FC<PaymentButtonProps> = (props) => (
  <>
    <SubscriptionCheckoutNote cart={props.cart} />
    <PaymentButtonForProvider {...props} />
  </>
)

const PaymentButtonForProvider: React.FC<PaymentButtonProps> = ({
  cart,
  "data-testid": dataTestId,
}) => {
  const notReady =
    !cart ||
    !cart.shipping_address ||
    !cart.billing_address ||
    !cart.email ||
    (cart.shipping_methods?.length ?? 0) < 1

  const paymentSession = cart.payment_collection?.payment_sessions?.[0]

  switch (true) {
    case isStripe(paymentSession?.provider_id):
      return (
        <StripePaymentButton
          notReady={notReady}
          cart={cart}
          data-testid={dataTestId}
        />
      )
    case isManual(paymentSession?.provider_id):
      return (
        <ManualTestPaymentButton
          notReady={notReady}
          cart={cart}
          data-testid={dataTestId}
        />
      )
    default:
      return (
        <Button disabled className="w-full">
          Select a payment method
        </Button>
      )
  }
}

const StripePaymentButton = ({
  cart,
  notReady,
  "data-testid": dataTestId,
}: {
  cart: HttpTypes.StoreCart
  notReady: boolean
  "data-testid"?: string
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [disabled, setDisabled] = useState(true)

  const onPaymentCompleted = async () => {
    try {
      if (await completeIfSubscription(cart, setErrorMessage)) return
      const ticketMode = cartTicketMode(cart)
      if (ticketMode === "mixed") {
        setErrorMessage(
          "Tickets must be checked out on their own. Please purchase the tickets in your cart separately from other items."
        )
        return
      }
      const res =
        ticketMode === "all-tickets" ? await placeTicketOrder() : await placeOrder()
      if (!res.ok && res.error) {
        setErrorMessage(orderErrorFormatter(res.error))
      }
    } catch (error: any) {
      if (error?.message !== "NEXT_REDIRECT") {
        setErrorMessage(
          orderErrorFormatter({
            ...error,
            message: error?.message?.replace("Error setting up the request: ", ""),
          })
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  const stripe = useStripe()
  const elements = useElements()
  const card = elements?.getElement("card")

  const session = cart.payment_collection?.payment_sessions?.find(
    (s) => s.status === "pending"
  )

  useEffect(() => {
    //@ts-ignore
    setDisabled(!card?._complete)
  }, [card, stripe, elements, cart])

  const handlePayment = async () => {
    setSubmitting(true)

    if (!stripe || !elements || !card || !cart) {
      setSubmitting(false)
      return
    }

    await stripe
      .confirmCardPayment(session?.data.client_secret as string, {
        payment_method: {
          card: card,
          billing_details: {
            name:
              cart.billing_address?.first_name +
              " " +
              cart.billing_address?.last_name,
            address: {
              city: cart.billing_address?.city ?? undefined,
              country: cart.billing_address?.country_code ?? undefined,
              line1: cart.billing_address?.address_1 ?? undefined,
              line2: cart.billing_address?.address_2 ?? undefined,
              postal_code: cart.billing_address?.postal_code ?? undefined,
              state: cart.billing_address?.province ?? undefined,
            },
            email: cart.email,
            phone: cart.billing_address?.phone ?? undefined,
          },
        },
      })
      .then(({ error, paymentIntent }) => {
        if (error) {
          const pi = error.payment_intent

          if (
            (pi && pi.status === "requires_capture") ||
            (pi && pi.status === "succeeded")
          ) {
            onPaymentCompleted()
          }

          setErrorMessage(error.message || null)
          return
        }

        if (
          (paymentIntent && paymentIntent.status === "requires_capture") ||
          paymentIntent.status === "succeeded"
        ) {
          return onPaymentCompleted()
        }

        return
      })
      .catch((err) => {
        // A rejected Stripe promise (network failure, malformed client_secret,
        // an aborted 3DS challenge) must surface an error, not vanish.
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Payment could not be completed. Please try again."
        )
      })
      .finally(() => {
        // Reset the spinner on every non-success exit — reject, card decline,
        // and unexpected/requires_action statuses all previously left the
        // button stuck loading. The success path's onPaymentCompleted() also
        // resets, so this is idempotent.
        setSubmitting(false)
      })
  }

  return (
    <>
      <Button
        disabled={disabled || notReady}
        onClick={handlePayment}
        loading={submitting}
        className="w-full"
      >
        Place order
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="stripe-payment-error-message"
      />
    </>
  )
}

const ManualTestPaymentButton = ({
  notReady,
  cart,
}: {
  notReady: boolean
  cart: HttpTypes.StoreCart
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const onPaymentCompleted = async () => {
    try {
      if (await completeIfSubscription(cart, setErrorMessage)) return
      const ticketMode = cartTicketMode(cart)
      if (ticketMode === "mixed") {
        setErrorMessage(
          "Tickets must be checked out on their own. Please purchase the tickets in your cart separately from other items."
        )
        return
      }
      const res =
        ticketMode === "all-tickets" ? await placeTicketOrder() : await placeOrder()
      if (!res.ok && res.error) {
        setErrorMessage(orderErrorFormatter(res.error))
      }
    } catch (error: any) {
      if (error?.message !== "NEXT_REDIRECT") {
        setErrorMessage(
          orderErrorFormatter({
            ...error,
            message: error?.message?.replace("Error setting up the request: ", ""),
          })
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handlePayment = () => {
    onPaymentCompleted()
  }

  return (
    <>
      <Button
        disabled={notReady}
        onClick={handlePayment}
        className="w-full"
        loading={submitting}
      >
        Place order
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="manual-payment-error-message"
      />
    </>
  )
}

export default PaymentButton

"use client"

import ErrorMessage from "@/components/molecules/ErrorMessage/ErrorMessage"
import { isManual, isStripe, offeredAtCheckout } from "../../../lib/constants"
import {
  placeOrder,
  placeTicketOrder,
  refreshCardPaymentSession,
} from "@/lib/data/cart"
import { HttpTypes } from "@medusajs/types"
import { useElements, useStripe } from "@stripe/react-stripe-js"
import React, { useContext, useEffect, useState } from "react"
import { Button } from "@/components/atoms"
import { StripeContext } from "../../organisms/PaymentContainer/StripeWrapper"
import { orderErrorFormatter } from "@/lib/helpers/order-error-formatter"
import { cardChargeMatchesCartTotal } from "@/lib/helpers/card-charge"
import {
  canPlaceWithoutPayment,
  cartOwesNothing,
  cartTicketMode,
  NOTHING_TO_PAY_NO_METHOD_NEEDED,
  NOTHING_TO_PAY_NOT_PLACEABLE,
} from "@/lib/helpers/nothing-to-pay"
import {
  listNames,
  type OfferedOption,
  shippingCoverage,
} from "@/lib/helpers/seller-shipping"
import { toast } from "@/lib/helpers/toast"
import { phase1ModuleFlags } from "@/lib/feature-flags"
import { completeSubscriptionCheckout } from "@/lib/data/subscriptions"
import {
  intervalNoun,
  paymentSessionDataFor,
  subscriptionCheckoutOf,
} from "@/lib/subscriptions/auto-renew"

type PaymentButtonProps = {
  cart: HttpTypes.StoreCart
  "data-testid": string
  /**
   * The shipping options Mercur lists for the cart (the checkout page's
   * `listCartShippingMethods`), for naming the sellers still without a
   * method. Without them the button still counts methods against sellers.
   */
  shippingOptions?: ReadonlyArray<OfferedOption> | null
}

// Which carts complete through the ticket checkout: `cartTicketMode`,
// lib/helpers/nothing-to-pay.ts (shared with the payment step).

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

/**
 * Said beside Place order while a seller in the cart has no shipping method.
 * Mercur's checkout refuses such a cart with "Seller shipping method not
 * found!", and only after it has authorized the card, so the button waits.
 */
const ShippingIncompleteNote = ({
  cart,
  shippingOptions,
}: {
  cart: HttpTypes.StoreCart
  shippingOptions?: ReadonlyArray<OfferedOption> | null
}) => {
  const coverage = shippingCoverage(cart, shippingOptions)
  if (coverage.complete) return null
  const names = coverage.toChoose.map((seller) => seller.name).filter(Boolean)
  return (
    <p className="mb-2 text-sm text-secondary" data-testid="shipping-incomplete-note">
      {names.length
        ? `Choose a delivery option for ${listNames(names)} before placing your order.`
        : coverage.noOptions.length
          ? "A seller in your cart has no delivery option for this address. Go back to Delivery to see which, and remove their items to place your order."
          : "Choose a delivery option for every seller in your cart before placing your order."}
    </p>
  )
}

const PaymentButton: React.FC<PaymentButtonProps> = (props) => (
  <>
    <SubscriptionCheckoutNote cart={props.cart} />
    <ShippingIncompleteNote cart={props.cart} shippingOptions={props.shippingOptions} />
    <PaymentButtonForProvider {...props} />
  </>
)

const PaymentButtonForProvider: React.FC<PaymentButtonProps> = ({
  cart,
  "data-testid": dataTestId,
  shippingOptions,
}) => {
  // One shipping method per seller, not one in all (see ShippingIncompleteNote).
  const notReady =
    !cart ||
    !cart.shipping_address ||
    !cart.billing_address ||
    !cart.email ||
    !shippingCoverage(cart, shippingOptions).complete

  const paymentSession = cart.payment_collection?.payment_sessions?.[0]

  // StripePaymentButton's hooks throw outside <Elements>, and PaymentWrapper
  // mounts that only around a pending card session (and only with a Stripe
  // key). A card session in any other state — one an unfinished attempt
  // already authorized, say — gets the disabled button below rather than a
  // crashed page; choosing the method again on the payment step opens a new
  // session.
  const stripeReady = useContext(StripeContext)

  // A cart that owes nothing takes no payment session, whatever session an
  // earlier total left on it (lib/helpers/nothing-to-pay.ts): the ticket
  // checkout places it with none; the main checkout refuses it (409
  // `cart_nothing_to_pay`), so that is said here, not after a click.
  if (cartOwesNothing(cart)) {
    return canPlaceWithoutPayment(cart) ? (
      <NothingToPayButton notReady={notReady} data-testid={dataTestId} />
    ) : (
      <>
        <Button disabled className="w-full">
          Place order
        </Button>
        <ErrorMessage
          error={NOTHING_TO_PAY_NOT_PLACEABLE}
          data-testid="nothing-to-pay-not-placeable"
        />
      </>
    )
  }

  switch (true) {
    case isStripe(paymentSession?.provider_id) && stripeReady:
      return (
        <StripePaymentButton
          notReady={notReady}
          cart={cart}
          data-testid={dataTestId}
        />
      )
    // A manual session places an order nobody pays for. The payment step lists
    // the provider only in a development build; a session on it that reaches
    // a production page anyway (opened through the API, or before this
    // change) gets the disabled button below.
    case isManual(paymentSession?.provider_id) &&
      offeredAtCheckout(paymentSession?.provider_id, process.env.NODE_ENV):
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

/**
 * Shown when the card session on this page is for an amount that is not the
 * cart's total. The backend refreshes a cart's payment collection after every
 * write that changes its total (SD-115), which deletes a session opened for
 * the old one, so a page rendered after such a write has no session and never
 * gets here: this is what is left when that refresh did not happen, or when a
 * session was opened while a change to the total was on its way (the
 * collection right and the session not).
 *
 * The notice comes with the action that puts it right, "Update payment"
 * (`refreshCardPaymentSession`), rather than with an instruction to find one.
 * The instructions this notice gave before could not be followed from this
 * state: choosing the payment method again is ignored by the radio group
 * while that method is picked, and choosing the delivery option the cart
 * already holds is refused by the backend before it writes ("Some of the
 * shipping methods are doubled!", measured in review), so nothing is
 * refreshed. What the action does was run against the backend in both stale
 * states (backend/integration-tests/http/cart-payment-refresh.spec.ts).
 */
const CARD_AMOUNT_CHANGED =
  "Your order total changed after you chose how to pay, so your card has not been charged. Update the payment to pay the current total."

/** "Update payment" failed; nothing was charged, and a second try finishes what the first began. */
const CARD_PAYMENT_NOT_UPDATED =
  "We could not update the payment for the new total, and your card has not been charged. Please try again."

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

  // confirmCardPayment charges what the session was opened for, which is not
  // necessarily the total on this page (lib/helpers/card-charge.ts). If the
  // two differ, the card is not confirmed at all.
  const chargeIsCartTotal = cardChargeMatchesCartTotal(session, cart)

  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)

  // "Update payment": the backend brings the cart's payment to its total and
  // opens the card session again, and the page is rendered afresh with that
  // session. The same provider, and for an approved subscription cart the
  // same off-session setup the payment step asks for.
  const updatePayment = async () => {
    if (!session) return
    setUpdating(true)
    setUpdateError(null)
    try {
      const sessionData = paymentSessionDataFor(
        cart,
        phase1ModuleFlags.consumerSubscriptions
      )
      await refreshCardPaymentSession(cart, {
        provider_id: session.provider_id,
        ...(sessionData ? { data: sessionData } : {}),
      })
    } catch {
      setUpdateError(CARD_PAYMENT_NOT_UPDATED)
    } finally {
      setUpdating(false)
    }
  }

  useEffect(() => {
    //@ts-ignore
    setDisabled(!card?._complete)
  }, [card, stripe, elements, cart])

  const handlePayment = async () => {
    setSubmitting(true)

    if (!stripe || !elements || !card || !cart || !chargeIsCartTotal) {
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
        disabled={disabled || notReady || !chargeIsCartTotal}
        onClick={handlePayment}
        loading={submitting}
        className="w-full"
      >
        Place order
      </Button>
      <ErrorMessage
        error={chargeIsCartTotal ? null : CARD_AMOUNT_CHANGED}
        data-testid="stripe-payment-amount-changed"
      />
      {chargeIsCartTotal ? null : (
        <Button
          variant="tonal"
          onClick={updatePayment}
          loading={updating}
          disabled={updating}
          className="w-full mt-2"
          data-testid="stripe-payment-update"
        >
          Update payment
        </Button>
      )}
      <ErrorMessage
        error={updateError}
        data-testid="stripe-payment-update-error"
      />
      <ErrorMessage
        error={errorMessage}
        data-testid="stripe-payment-error-message"
      />
    </>
  )
}

/**
 * Place order for an all-ticket cart that owes nothing: the ticket checkout,
 * with no payment session and nothing asked of Stripe.
 */
const NothingToPayButton = ({
  notReady,
  "data-testid": dataTestId,
}: {
  notReady: boolean
  "data-testid"?: string
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handlePlaceOrder = async () => {
    setSubmitting(true)
    try {
      const res = await placeTicketOrder()
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

  return (
    <>
      <p className="mb-2 text-sm text-secondary" data-testid="nothing-to-pay-note">
        {NOTHING_TO_PAY_NO_METHOD_NEEDED}
      </p>
      <Button
        disabled={notReady}
        onClick={handlePlaceOrder}
        loading={submitting}
        className="w-full"
        data-testid={dataTestId}
      >
        Place order
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="nothing-to-pay-error-message"
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
    setSubmitting(true)
    return onPaymentCompleted()
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

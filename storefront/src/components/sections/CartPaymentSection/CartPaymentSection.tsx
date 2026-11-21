"use client"

import ErrorMessage from "@/components/molecules/ErrorMessage/ErrorMessage"
import { initiatePaymentSession } from "@/lib/data/cart"
import { RadioGroup } from "@headlessui/react"
import {
  isStripe as isStripeFunc,
  paymentInfoMap,
} from "../../../lib/constants"
import { CheckCircleSolid, CreditCard } from "@medusajs/icons"
import { Container, Heading, Text } from "@medusajs/ui"
import PaymentContainer, {
  StripeCardContainer,
} from "../../organisms/PaymentContainer/PaymentContainer"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/atoms"
import { phase1ModuleFlags } from "@/lib/feature-flags"
import {
  canPlaceWithoutPayment,
  cartOwesNothing,
  NOTHING_TO_PAY_NO_METHOD_NEEDED,
  NOTHING_TO_PAY_NOT_PLACEABLE,
} from "@/lib/helpers/nothing-to-pay"
import {
  paymentSessionDataFor,
  paymentSessionInitArgs,
} from "@/lib/subscriptions/auto-renew"

type StoreCardPaymentMethod = any & {
  service_zone?: {
    fulfillment_set: {
      type: string
    }
  }
}

const CARD_SESSION_NOT_OPENED =
  "We could not start the card payment. Choose the payment method again to retry."

/** The region lists no provider this build offers (a region with only Medusa's manual provider, in production). */
const NO_PAYMENT_METHOD =
  "No payment method is available for this order. Please contact the store."

/** The list could not be fetched (`listCartPaymentMethods` answers null). */
const PAYMENT_METHODS_NOT_LOADED =
  "We couldn't load the payment methods. Refresh the page to try again."

const CartPaymentSection = ({
  cart,
  availablePaymentMethods,
}: {
  cart: any
  availablePaymentMethods: StoreCardPaymentMethod[] | null
}) => {
  const activeSession = cart.payment_collection?.payment_sessions?.find(
    (paymentSession: any) => paymentSession.status === "pending"
  )

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cardBrand, setCardBrand] = useState<string | null>(null)
  const [cardComplete, setCardComplete] = useState(false)
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(
    activeSession?.provider_id ?? ""
  )

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const isOpen = searchParams.get("step") === "payment"

  const isStripe = isStripeFunc(selectedPaymentMethod)

  // Only an approved subscription cart asks Stripe to keep the card for
  // off-session renewals; undefined for every other cart, and always with
  // NEXT_PUBLIC_FF_CONSUMER_SUBSCRIPTIONS_V1 off, so the session starts
  // exactly as before.
  const sessionData = paymentSessionDataFor(cart, phase1ModuleFlags.consumerSubscriptions)

  // A cart that owes nothing takes no payment session: the provider would be
  // asked for an intent of zero (lib/helpers/nothing-to-pay.ts). An all-ticket
  // cart can still be placed; any other cannot, and the step says so.
  const owesNothing = cartOwesNothing(cart)
  const placeableWithoutPayment = canPlaceWithoutPayment(cart)
  const hasPaymentMethods = (availablePaymentMethods?.length ?? 0) > 0

  const setPaymentMethod = async (method: string) => {
    if (owesNothing) {
      return
    }
    setError(null)
    setSelectedPaymentMethod(method)
    if (!isStripeFunc(method)) {
      return
    }
    try {
      await initiatePaymentSession(cart, {
        provider_id: method,
        ...(sessionData ? { data: sessionData } : {}),
      })
    } catch {
      // Picking the card is what opens its session, and without a session
      // there is no card form. The radio group ignores a click on the method
      // it already shows as picked, so the pick is taken back: the buyer can
      // then choose the card again, which is the retry. A method picked while
      // this one was still opening is left alone. The cause is in the server
      // log (medusaError); a production build would hand the page a redacted
      // message anyway.
      const previous =
        activeSession && activeSession.provider_id !== method
          ? activeSession.provider_id
          : ""
      setError(CARD_SESSION_NOT_OPENED)
      setSelectedPaymentMethod((current: string) =>
        current === method ? previous : current
      )
    }
  }

  const paidByGiftcard =
    cart?.gift_cards && cart?.gift_cards?.length > 0 && cart?.total === 0

  const paymentReady =
    (activeSession && cart?.shipping_methods.length !== 0) || paidByGiftcard

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams)
      params.set(name, value)

      return params.toString()
    },
    [searchParams]
  )

  const handleEdit = () => {
    router.push(pathname + "?" + createQueryString("step", "payment"), {
      scroll: false,
    })
  }

  const handleSubmit = async () => {
    if (owesNothing) {
      // No session to open. Only a cart that can be placed goes on.
      if (placeableWithoutPayment) {
        router.push(pathname + "?" + createQueryString("step", "review"), {
          scroll: false,
        })
      }
      return
    }
    setIsLoading(true)
    try {
      const shouldInputCard =
        isStripeFunc(selectedPaymentMethod) && !activeSession

      // null → reuse the active session (same provider, and — for an
      // approved subscription cart only — already set up for off-session use).
      const initArgs = paymentSessionInitArgs({
        activeSession,
        selectedProviderId: selectedPaymentMethod,
        sessionData,
      })

      if (initArgs) {
        await initiatePaymentSession(cart, initArgs)
      }

      if (!shouldInputCard) {
        return router.push(
          pathname + "?" + createQueryString("step", "review"),
          {
            scroll: false,
          }
        )
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    setError(null)
  }, [isOpen])

  const isEditEnabled =
    !isOpen && !!cart?.payment_collection?.payment_sessions?.length

  return (
    <div className="border p-4 rounded-sm bg-ui-bg-interactive">
      <div className="flex flex-row items-center justify-between mb-6">
        <Heading
          level="h2"
          className="flex flex-row text-3xl-regular gap-x-2 items-baseline items-center"
        >
          {!isOpen && paymentReady && <CheckCircleSolid />}
          Payment
        </Heading>
        {isEditEnabled && (
          <Text>
            <Button onClick={handleEdit} variant="tonal">
              Edit
            </Button>
          </Text>
        )}
      </div>
      <div>
        <div className={isOpen ? "block" : "hidden"}>
          {!paidByGiftcard && owesNothing && (
            <Text
              className="txt-medium text-ui-fg-subtle mb-4"
              data-testid="payment-nothing-to-pay"
            >
              {placeableWithoutPayment
                ? NOTHING_TO_PAY_NO_METHOD_NEEDED
                : NOTHING_TO_PAY_NOT_PLACEABLE}
            </Text>
          )}

          {/* A count, never a bare length: `list?.length && (…)` draws "0". */}
          {!paidByGiftcard && !owesNothing && !hasPaymentMethods && (
            <ErrorMessage
              error={
                availablePaymentMethods
                  ? NO_PAYMENT_METHOD
                  : PAYMENT_METHODS_NOT_LOADED
              }
              data-testid="payment-no-methods"
            />
          )}

          {!paidByGiftcard && !owesNothing && hasPaymentMethods && (
            <>
              <RadioGroup
                value={selectedPaymentMethod}
                onChange={(value: string) => setPaymentMethod(value)}
              >
                {(availablePaymentMethods ?? []).map((paymentMethod) => (
                  <div key={paymentMethod.id}>
                    {isStripeFunc(paymentMethod.id) ? (
                      <StripeCardContainer
                        paymentProviderId={paymentMethod.id}
                        selectedPaymentOptionId={selectedPaymentMethod}
                        paymentInfoMap={paymentInfoMap}
                        setCardBrand={setCardBrand}
                        setError={setError}
                        setCardComplete={setCardComplete}
                      />
                    ) : (
                      <PaymentContainer
                        paymentInfoMap={paymentInfoMap}
                        paymentProviderId={paymentMethod.id}
                        selectedPaymentOptionId={selectedPaymentMethod}
                      />
                    )}
                  </div>
                ))}
              </RadioGroup>
            </>
          )}

          {paidByGiftcard && (
            <div className="flex flex-col w-1/3">
              <Text className="txt-medium-plus text-ui-fg-base mb-1">
                Payment method
              </Text>
              <Text
                className="txt-medium text-ui-fg-subtle"
                data-testid="payment-method-summary"
              >
                Gift card
              </Text>
            </div>
          )}

          <ErrorMessage
            error={error}
            data-testid="payment-method-error-message"
          />

          <Button
            onClick={handleSubmit}
            variant="tonal"
            loading={isLoading}
            disabled={
              owesNothing
                ? !placeableWithoutPayment
                : (isStripe && !cardComplete) ||
                  (!selectedPaymentMethod && !paidByGiftcard)
            }
          >
            {!owesNothing && !activeSession && isStripeFunc(selectedPaymentMethod)
              ? " Enter card details"
              : "Continue to review"}
          </Button>
        </div>

        <div className={isOpen ? "hidden" : "block"}>
          {cart && paymentReady && activeSession ? (
            <div className="flex items-start gap-x-1 w-full">
              <div className="flex flex-col w-1/3">
                <Text className="txt-medium-plus text-ui-fg-base mb-1">
                  Payment method
                </Text>
                <Text
                  className="txt-medium text-ui-fg-subtle"
                  data-testid="payment-method-summary"
                >
                  {paymentInfoMap[activeSession?.provider_id]?.title ||
                    activeSession?.provider_id}
                </Text>
              </div>
              <div className="flex flex-col w-1/3">
                <Text className="txt-medium-plus text-ui-fg-base mb-1">
                  Payment details
                </Text>
                <div
                  className="flex gap-2 txt-medium text-ui-fg-subtle items-center"
                  data-testid="payment-details-summary"
                >
                  <Container className="flex items-center h-7 w-fit p-2 bg-ui-button-neutral-hover">
                    {paymentInfoMap[selectedPaymentMethod]?.icon || (
                      <CreditCard />
                    )}
                  </Container>
                  <Text>
                    {isStripeFunc(selectedPaymentMethod) && cardBrand
                      ? cardBrand
                      : "Another step will appear"}
                  </Text>
                </div>
              </div>
            </div>
          ) : paidByGiftcard ? (
            <div className="flex flex-col w-1/3">
              <Text className="txt-medium-plus text-ui-fg-base mb-1">
                Payment method
              </Text>
              <Text
                className="txt-medium text-ui-fg-subtle"
                data-testid="payment-method-summary"
              >
                Gift card
              </Text>
            </div>
          ) : owesNothing ? (
            <Text
              className="txt-medium text-ui-fg-subtle"
              data-testid="payment-method-summary"
            >
              Nothing to pay
            </Text>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default CartPaymentSection

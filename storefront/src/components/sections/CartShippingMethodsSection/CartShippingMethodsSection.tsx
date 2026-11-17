"use client"

import ErrorMessage from "@/components/molecules/ErrorMessage/ErrorMessage"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { setShippingMethod } from "@/lib/data/cart"
import { checkDeliveryForPostalCode, type DeliveryEligibility } from "@/lib/data/delivery"
import { calculatePriceForShippingOption } from "@/lib/data/fulfillment"
import { isFailedDeliveryCheck } from "@/lib/helpers/delivery-eligibility"
import { convertToLocale } from "@/lib/helpers/money"
import {
  type FulfillmentType,
  listNames,
  shippingCoverage,
  shownFulfillmentType,
} from "@/lib/helpers/seller-shipping"
import { CheckCircleSolid, ChevronUpDown, Loader } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import { clx, Heading, Text } from "@medusajs/ui"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Fragment, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/atoms"
import { CartShippingMethodRow } from "./CartShippingMethodRow"
import { Listbox, Transition, RadioGroup, Radio } from "@headlessui/react"
import clsx from "clsx"

// Fulfillment types
const FULFILLMENT_TYPE = {
  DELIVERY: "delivery",
  PICKUP: "pickup",
  SHIPPING: "shipping",
} as const satisfies Record<string, FulfillmentType>

const FULFILLMENT_TYPE_LABEL: Record<FulfillmentType, string> = {
  delivery: "Delivery",
  pickup: "Pickup",
  shipping: "Shipping",
}

// Extended cart item product type to include seller
type ExtendedStoreProduct = HttpTypes.StoreProduct & {
  seller?: {
    id: string
    name: string
  }
}

// Cart item type definition
type CartItem = {
  product?: ExtendedStoreProduct
  // Include other cart item properties as needed
}

const isReturnMethod = (sm: AvailableShippingMethod) =>
  sm.rules?.find((rule) => rule.attribute === "is_return")?.value === "true"

const isDeliveryMethod = (sm: AvailableShippingMethod) =>
  sm.service_zone?.fulfillment_set?.type === "delivery" ||
  !!sm.name?.toLowerCase().includes("delivery") ||
  !!sm.name?.toLowerCase().includes("internal")

const isPickupMethod = (sm: AvailableShippingMethod) =>
  sm.service_zone?.fulfillment_set?.type === "pickup" ||
  !!sm.name?.toLowerCase().includes("pickup")

const isShippingMethod = (sm: AvailableShippingMethod) =>
  sm.service_zone?.fulfillment_set?.type !== "delivery" &&
  sm.service_zone?.fulfillment_set?.type !== "pickup" &&
  !sm.name?.toLowerCase().includes("delivery") &&
  !sm.name?.toLowerCase().includes("pickup") &&
  !sm.name?.toLowerCase().includes("internal")

export type StoreCardShippingMethod = HttpTypes.StoreCartShippingOption & {
  seller_id?: string
  seller_name?: string
  service_zone?: {
    fulfillment_set: {
      type: string
      location?: {
        address?: {
          address_1?: string
          address_2?: string
          city?: string
          postal_code?: string
          country_code?: string
        }
      }
    }
  }
}

type ShippingMethodRule = { attribute: string; value: string }

// A shipping option as surfaced to the cart, with the marketplace fields the UI
// relies on (seller grouping, flat/calculated pricing, return-method rules, and
// an optional pickup location address).
type AvailableShippingMethod = StoreCardShippingMethod & {
  rules?: ShippingMethodRule[]
  seller_id: string
  price_type: string
  id: string
  amount?: number
  location_address?: {
    address_1?: string
    address_2?: string
    city?: string
    postal_code?: string
    country_code?: string
  }
}

type ShippingProps = {
  cart: Omit<HttpTypes.StoreCart, "items"> & {
    items?: CartItem[]
  }
  availableShippingMethods: AvailableShippingMethod[] | null
}

// Helper to format address
function formatAddress(address?: {
  address_1?: string
  address_2?: string
  city?: string
  postal_code?: string
  country_code?: string
}) {
  if (!address) return ""
  const parts = [
    address.address_1,
    address.address_2,
    address.postal_code && address.city ? `${address.postal_code} ${address.city}` : address.city,
    address.country_code?.toUpperCase(),
  ].filter(Boolean)
  return parts.join(", ")
}

const CartShippingMethodsSection: React.FC<ShippingProps> = ({
  cart,
  availableShippingMethods,
}) => {
  const [isLoadingPrices, setIsLoadingPrices] = useState(false)
  const [calculatedPricesMap, setCalculatedPricesMap] = useState<
    Record<string, number>
  >({})
  const [error, setError] = useState<string | null>(null)
  // The type the buyer picked. What is shown is derived from it on every
  // render (`shownFulfillmentType`), never reset behind the buyer's back.
  const [pickedFulfillmentType, setPickedFulfillmentType] = useState<FulfillmentType | undefined>(undefined)
  // option id -> seller id of options the buyer chose here. Mercur stops
  // listing a seller's options once the seller has a method, and the cart
  // read cannot say whose a method is (lib/helpers/seller-shipping.ts), so
  // this is how a chosen method stays paired with its seller on this page.
  const [chosenOptionSellers, setChosenOptionSellers] = useState<Record<string, string>>({})
  const [deliveryEligibility, setDeliveryEligibility] = useState<DeliveryEligibility | null>(null)
  const [isCheckingEligibility, setIsCheckingEligibility] = useState(false)

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const isOpen = searchParams.get("step") === "delivery"

  // The option lists, rebuilt only when the options change. They were
  // rebuilt on every render, and each effect that listed them as a
  // dependency ran on every render too.
  const _allMethods = useMemo(
    () => (availableShippingMethods ?? []).filter((sm) => !isReturnMethod(sm)),
    [availableShippingMethods]
  )
  const _deliveryMethods = useMemo(() => _allMethods.filter(isDeliveryMethod), [_allMethods])
  const _pickupMethods = useMemo(() => _allMethods.filter(isPickupMethod), [_allMethods])
  const _shippingMethods = useMemo(() => _allMethods.filter(isShippingMethod), [_allMethods])

  const hasDeliveryOptions = _deliveryMethods.length > 0
  const hasPickupOptions = _pickupMethods.length > 0
  const hasShippingOptions = _shippingMethods.length > 0

  const selectedFulfillmentType = shownFulfillmentType(pickedFulfillmentType, {
    delivery: hasDeliveryOptions,
    pickup: hasPickupOptions,
    shipping: hasShippingOptions,
  })

  // Which sellers still need a method: Mercur refuses the order, after
  // authorizing the card, unless every seller in the cart has one. When the
  // options could not be fetched (null), nothing is known about who has
  // options, so the rule only counts and names no one.
  const coverage = useMemo(
    () => shippingCoverage(cart, availableShippingMethods ? _allMethods : null, chosenOptionSellers),
    [cart, availableShippingMethods, _allMethods, chosenOptionSellers]
  )
  const sellerNames = (sellers: { name: string }[]) =>
    sellers.map((seller) => seller.name || "a seller in your cart")

  useEffect(() => {
    if (_allMethods.length) {
      const promises = _allMethods
        .filter((sm) => sm.price_type === "calculated")
        .map((sm) => calculatePriceForShippingOption(sm.id, cart.id))

      if (promises.length) {
        Promise.allSettled(promises).then((res) => {
          const pricesMap: Record<string, number> = {}
          res
            .filter((r) => r.status === "fulfilled")
            .forEach((p) => (pricesMap[p.value?.id || ""] = p.value?.amount!))

          setCalculatedPricesMap(pricesMap)
          setIsLoadingPrices(false)
        })
      }
    }
  }, [_allMethods, cart.id])

  const handleSubmit = () => {
    router.push(pathname + "?step=payment", { scroll: false })
  }

  const handleSetShippingMethod = async (id: string | null) => {
    if (!id) {
      return
    }

    try {
      setError(null)
      setIsLoadingPrices(true)
      const res = await setShippingMethod({
        cartId: cart.id,
        shippingMethodId: id,
      })
      if (!res.ok) {
        return setError(res.error?.message)
      }
      const sellerId = _allMethods.find((method) => method.id === id)?.seller_id
      if (sellerId) {
        setChosenOptionSellers((pairs) => ({ ...pairs, [id]: sellerId }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      setError(
        message.replace("Error setting up the request: ", "") ||
          "An error occurred"
      )
    } finally {
      setIsLoadingPrices(false)
    }
  }

  useEffect(() => {
    setError(null)
  }, [isOpen])

  const postalCode = cart.shipping_address?.postal_code

  // FBM's delivery-zone check, from the server (lib/data/delivery.ts): the
  // browser's own call carried no publishable key and was refused every
  // time. Advisory only: its answer is shown beside the Delivery options and
  // never moves the buyer off Delivery. A check that could not be made says
  // so; it used to switch the buyer to Pickup or Shipping, and the notice
  // that said why went with it.
  useEffect(() => {
    if (!postalCode || !hasDeliveryOptions) {
      setDeliveryEligibility(null)
      return
    }

    let current = true
    setIsCheckingEligibility(true)
    checkDeliveryForPostalCode(postalCode)
      .then((answer) => {
        if (current) setDeliveryEligibility(answer)
      })
      .catch(() => {
        if (current) setDeliveryEligibility(null)
      })
      .finally(() => {
        if (current) setIsCheckingEligibility(false)
      })
    return () => {
      current = false
    }
  }, [postalCode, hasDeliveryOptions])

  const deliveryCheckFailed = isFailedDeliveryCheck(deliveryEligibility)

  // Get methods based on selected fulfillment type
  const getMethodsForType = (type: FulfillmentType | undefined) => {
    switch (type) {
      case FULFILLMENT_TYPE.DELIVERY:
        return _deliveryMethods
      case FULFILLMENT_TYPE.PICKUP:
        return _pickupMethods
      case FULFILLMENT_TYPE.SHIPPING:
      default:
        return _shippingMethods
    }
  }

  const currentMethods = getMethodsForType(selectedFulfillmentType)

  const groupedBySellerId = currentMethods?.reduce<
    Record<string, AvailableShippingMethod[]>
  >((acc, method) => {
    const sellerId = method.seller_id

    if (!acc[sellerId]) {
      acc[sellerId] = []
    }

    const amount = Number(
      method.price_type === "flat"
        ? method.amount
        : calculatedPricesMap[method.id]
    )

    if (!isNaN(amount)) {
      acc[sellerId]?.push(method)
    }

    return acc
  }, {})

  const handleEdit = () => {
    router.replace(pathname + "?step=delivery")
  }

  const isEditEnabled = !isOpen && !!cart?.shipping_methods?.length

  const otherTypesWithOptions = (["delivery", "pickup", "shipping"] as const).filter(
    (type) =>
      type !== selectedFulfillmentType &&
      { delivery: hasDeliveryOptions, pickup: hasPickupOptions, shipping: hasShippingOptions }[type]
  )

  return (
    <div className="border p-4 rounded-sm bg-ui-bg-interactive">
      <div className="flex flex-row items-center justify-between mb-6">
        <Heading
          level="h2"
          className="flex flex-row text-3xl-regular gap-x-2 items-baseline items-center"
        >
          {!isOpen && (cart.shipping_methods?.length ?? 0) > 0 && (
            <CheckCircleSolid />
          )}
          Delivery
        </Heading>
        {isEditEnabled && (
          <Text>
            <Button onClick={handleEdit} variant="tonal">
              Edit
            </Button>
          </Text>
        )}
      </div>
      {isOpen ? (
        <>
          <div className="grid">

          {coverage.noOptions.length > 0 && (
            <div
              className="mb-4 rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800"
              role="alert"
              data-testid="sellers-without-delivery-options"
            >
              <p className="font-medium">
                {coverage.noOptionsExact
                  ? `${listNames(sellerNames(coverage.noOptions))} ${
                      coverage.noOptions.length === 1 ? "has" : "have"
                    } no delivery options for this address.`
                  : `${coverage.noOptionsCount === 1 ? "One seller" : `${coverage.noOptionsCount} sellers`} in your cart (${listNames(
                      sellerNames(coverage.noOptions),
                      "or"
                    )}) ${coverage.noOptionsCount === 1 ? "has" : "have"} no delivery options for this address.`}
              </p>
              <p className="mt-1">
                To check out, remove {coverage.noOptionsCount === 1 ? "that seller's" : "their"} items from{" "}
                <LocalizedClientLink href="/cart" className="underline">
                  your cart
                </LocalizedClientLink>{" "}
                or use a different address.
              </p>
            </div>
          )}

          {selectedFulfillmentType === FULFILLMENT_TYPE.DELIVERY && (deliveryEligibility || isCheckingEligibility) && (
            <div
              className={clsx("mb-4 rounded-md border p-3 text-sm",
                isCheckingEligibility ? "border-ui-border-base bg-ui-bg-subtle text-ui-fg-subtle" :
                deliveryEligibility?.available ? "border-green-200 bg-green-50 text-green-800" : "border-orange-200 bg-orange-50 text-orange-800"
              )}
              data-testid="delivery-eligibility"
            >
              {isCheckingEligibility
                ? "Checking delivery to your postal code..."
                : deliveryEligibility?.available
                  ? deliveryEligibility.message || "Delivery is available for your address."
                  : deliveryEligibility?.reason ||
                    (deliveryCheckFailed
                      ? "We couldn't check delivery to your address just now."
                      : "Delivery may not be available for this address.")}
              {!isCheckingEligibility && !deliveryEligibility?.available && deliveryEligibility?.suggestion ? (
                <div className="mt-1">{deliveryEligibility.suggestion}</div>
              ) : null}
            </div>
          )}
            {/* Fulfillment Type Selector */}
            {(hasDeliveryOptions || hasPickupOptions || hasShippingOptions) && (
              <div className="mb-6">
                <Heading level="h3" className="mb-3 text-lg font-medium">
                  How would you like to receive your order?
                </Heading>
                <RadioGroup
                  value={selectedFulfillmentType ?? null}
                  onChange={(type: FulfillmentType | null) => setPickedFulfillmentType(type ?? undefined)}
                  className="flex flex-col gap-3"
                >
                  {hasDeliveryOptions && (
                    <Radio
                      value={FULFILLMENT_TYPE.DELIVERY}
                      className="group relative flex items-center gap-3 cursor-pointer rounded-lg border p-4 transition-all data-[checked]:border-ui-border-interactive data-[checked]:bg-ui-bg-interactive-subtle hover:bg-gray-50"
                    >
                      <div className="flex h-5 w-5 items-center justify-center rounded-full border group-data-[checked]:border-ui-border-interactive group-data-[checked]:bg-ui-bg-interactive">
                        <span className="invisible h-2.5 w-2.5 rounded-full bg-white group-data-[checked]:visible" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-medium">🚴 Delivery</span>
                        <span className="text-sm text-ui-fg-subtle">
                          Get your order delivered to your address
                        </span>
                      </div>
                    </Radio>
                  )}
                  {hasPickupOptions && (
                    <Radio
                      value={FULFILLMENT_TYPE.PICKUP}
                      className="group relative flex items-center gap-3 cursor-pointer rounded-lg border p-4 transition-all data-[checked]:border-ui-border-interactive data-[checked]:bg-ui-bg-interactive-subtle hover:bg-gray-50"
                    >
                      <div className="flex h-5 w-5 items-center justify-center rounded-full border group-data-[checked]:border-ui-border-interactive group-data-[checked]:bg-ui-bg-interactive">
                        <span className="invisible h-2.5 w-2.5 rounded-full bg-white group-data-[checked]:visible" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-medium">🏪 Pickup</span>
                        <span className="text-sm text-ui-fg-subtle">
                          Pick up your order from the store
                        </span>
                      </div>
                    </Radio>
                  )}
                  {hasShippingOptions && (
                    <Radio
                      value={FULFILLMENT_TYPE.SHIPPING}
                      className="group relative flex items-center gap-3 cursor-pointer rounded-lg border p-4 transition-all data-[checked]:border-ui-border-interactive data-[checked]:bg-ui-bg-interactive-subtle hover:bg-gray-50"
                    >
                      <div className="flex h-5 w-5 items-center justify-center rounded-full border group-data-[checked]:border-ui-border-interactive group-data-[checked]:bg-ui-bg-interactive">
                        <span className="invisible h-2.5 w-2.5 rounded-full bg-white group-data-[checked]:visible" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-medium">📦 Shipping</span>
                        <span className="text-sm text-ui-fg-subtle">
                          Have your order shipped via carrier
                        </span>
                      </div>
                    </Radio>
                  )}
                </RadioGroup>
              </div>
            )}

            {/* Shipping Methods by Seller */}
            {selectedFulfillmentType && groupedBySellerId && Object.keys(groupedBySellerId).length > 0 && (
              <div data-testid="delivery-options-container">
                <div className="pb-8 md:pt-0 pt-2">
                  {Object.keys(groupedBySellerId).map((key) => {
                    const methods = groupedBySellerId[key]
                    const sellerName = methods[0]?.seller_name

                    return (
                      <div key={key} className="mb-4">
                        <Heading level="h3" className="mb-2">
                          {sellerName}
                        </Heading>

                        {/* Show pickup location info if pickup selected */}
                        {selectedFulfillmentType === FULFILLMENT_TYPE.PICKUP && methods[0]?.location_address && (
                          <div className="mb-3 p-3 bg-ui-bg-subtle rounded-lg text-sm">
                            <span className="font-medium">Pickup Location: </span>
                            {formatAddress(methods[0].location_address)}
                          </div>
                        )}

                        <Listbox
                          value={cart.shipping_methods?.find(sm =>
                            methods.some((m) => m.id === sm.shipping_option_id)
                          )?.shipping_option_id || null}
                          onChange={(value) => {
                            handleSetShippingMethod(value)
                          }}
                        >
                          <div className="relative">
                            <Listbox.Button
                              className={clsx(
                                "relative w-full flex justify-between items-center px-4 h-12 bg-component-secondary text-left cursor-default focus:outline-none border rounded-lg focus-visible:ring-2 focus-visible:ring-opacity-75 focus-visible:ring-white focus-visible:ring-offset-gray-300 focus-visible:ring-offset-2 focus-visible:border-gray-300 text-base-regular"
                              )}
                            >
                              {({ open }) => {
                                const selectedMethod = methods.find((m) =>
                                  cart.shipping_methods?.some(sm => sm.shipping_option_id === m.id)
                                )
                                return (
                                  <>
                                    <span className="block truncate">
                                      {selectedMethod 
                                        ? `${selectedMethod.name} - ${
                                            selectedMethod.price_type === "flat"
                                              ? convertToLocale({
                                                  amount: selectedMethod.amount!,
                                                  currency_code: cart?.currency_code,
                                                })
                                              : calculatedPricesMap[selectedMethod.id]
                                                ? convertToLocale({
                                                    amount: calculatedPricesMap[selectedMethod.id],
                                                    currency_code: cart?.currency_code,
                                                  })
                                                : "-"
                                          }`
                                        : `Choose ${selectedFulfillmentType} option`}
                                    </span>
                                    <ChevronUpDown
                                      className={clx(
                                        "transition-rotate duration-200",
                                        {
                                          "transform rotate-180": open,
                                        }
                                      )}
                                    />
                                  </>
                                )
                              }}
                            </Listbox.Button>
                            <Transition
                              as={Fragment}
                              leave="transition ease-in duration-100"
                              leaveFrom="opacity-100"
                              leaveTo="opacity-0"
                            >
                              <Listbox.Options
                                className="absolute z-20 w-full overflow-auto text-small-regular bg-white border rounded-lg border-top-0 max-h-60 focus:outline-none sm:text-sm"
                                data-testid="shipping-address-options"
                              >
                                {methods.map((option) => {
                                  return (
                                    <Listbox.Option
                                      className="cursor-pointer select-none relative pl-6 pr-10 hover:bg-gray-50 py-4 border-b"
                                      value={option.id}
                                      key={option.id}
                                    >
                                      {option.name}
                                      {" - "}
                                      {option.price_type === "flat" ? (
                                        convertToLocale({
                                          amount: option.amount!,
                                          currency_code: cart?.currency_code,
                                        })
                                      ) : calculatedPricesMap[option.id] ? (
                                        convertToLocale({
                                          amount: calculatedPricesMap[option.id],
                                          currency_code: cart?.currency_code,
                                        })
                                      ) : isLoadingPrices ? (
                                        <Loader />
                                      ) : (
                                        "-"
                                      )}
                                    </Listbox.Option>
                                  )
                                })}
                              </Listbox.Options>
                            </Transition>
                          </div>
                        </Listbox>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* No methods available message */}
            {selectedFulfillmentType && (!groupedBySellerId || Object.keys(groupedBySellerId).length === 0) && (
              <div className="p-4 bg-ui-bg-subtle rounded-lg text-center">
                <Text className="text-ui-fg-subtle">
                  No {selectedFulfillmentType} options available for your location.
                  {otherTypesWithOptions.map((type, index) => (
                    <Fragment key={type}>
                      {index === 0 ? " Try " : " or "}
                      <button
                        onClick={() => setPickedFulfillmentType(type)}
                        className="text-ui-fg-interactive underline"
                      >
                        {FULFILLMENT_TYPE_LABEL[type]}
                      </button>
                      {index === otherTypesWithOptions.length - 1 ? " instead." : ""}
                    </Fragment>
                  ))}
                </Text>
              </div>
            )}

            {cart && (cart.shipping_methods?.length ?? 0) > 0 && (
              <div className="flex flex-col mt-4" data-testid="selected-delivery-options">
                <Heading level="h3" className="mb-2 text-sm font-medium text-ui-fg-subtle">
                  Selected Options:
                </Heading>
                {cart.shipping_methods?.map((method) => (
                  <CartShippingMethodRow
                    key={method.id}
                    method={method}
                    currency_code={cart.currency_code}
                  />
                ))}
              </div>
            )}
          </div>
          <div>
            {coverage.toChoose.length > 0 && (
              <p className="mb-2 text-sm text-ui-fg-subtle" data-testid="sellers-to-choose-for">
                Choose a delivery option for {listNames(sellerNames(coverage.toChoose))} to continue.
              </p>
            )}
            <ErrorMessage
              error={error}
              data-testid="delivery-option-error-message"
            />
            <Button
              onClick={handleSubmit}
              variant="tonal"
              disabled={!coverage.complete}
              loading={isLoadingPrices}
            >
              Continue to payment
            </Button>
          </div>
        </>
      ) : (
        <div>
          <div className="text-small-regular">
            {cart && (cart.shipping_methods?.length ?? 0) > 0 && (
              <div className="flex flex-col">
                {/* Show fulfillment type badge */}
                {selectedFulfillmentType && (
                  <div className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-ui-fg-subtle">
                    {selectedFulfillmentType === FULFILLMENT_TYPE.DELIVERY && "🚴 Delivery"}
                    {selectedFulfillmentType === FULFILLMENT_TYPE.PICKUP && "🏪 Pickup"}
                    {selectedFulfillmentType === FULFILLMENT_TYPE.SHIPPING && "📦 Shipping"}
                  </div>
                )}
                {cart.shipping_methods?.map((method) => (
                  <div key={method.id} className="mb-4 border rounded-md p-4">
                    <Text className="txt-medium-plus text-ui-fg-base mb-1">
                      Method
                    </Text>
                    <Text className="txt-medium text-ui-fg-subtle">
                      {method.name}{" "}
                      {convertToLocale({
                        amount: method.amount!,
                        currency_code: cart?.currency_code,
                      })}
                    </Text>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default CartShippingMethodsSection

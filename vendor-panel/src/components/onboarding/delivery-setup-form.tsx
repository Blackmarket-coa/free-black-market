import { useState } from "react"
import {
  Alert,
  Button,
  Checkbox,
  Heading,
  Input,
  Label,
  Text,
  toast,
} from "@medusajs/ui"
import { CountrySelect } from "../inputs/country-select"
import {
  sellingSetupMutationKeys,
  useIsBusy,
  useSellingSetup,
  useSetUpDelivery,
} from "../../hooks/api/selling-setup"
import {
  regionCountryCodes,
  regionCountryNames,
  regionOfCountry,
  type DeliverySetup,
  type DeliverySetupInput,
  type DeliverySetupResult,
  type SellingRegion,
  unofferedReason,
} from "../../lib/selling-setup"

/**
 * Pickup or shipping from one screen (SD-151 (4)).
 *
 * A store needs a stock location linked to its sales channel and a shipping
 * option on it before a buyer can check out; Settings, Locations asks for
 * those over five screens and nothing told a new vendor they were needed.
 * This asks where the goods are and how buyers get them, and makes the rest
 * with `setUpDelivery`. It says delivery is set up only from what the backend
 * answers when the setup is read back.
 *
 * A new place can only be in a country buyers are in (a region's country),
 * and the flat rate is asked for in that region's currency: an option in a
 * zone no buyer is in, or priced in a currency no buyer pays in, is offered
 * to no one (measured: a Canadian zone and a EUR-only price each left a US
 * buyer unable to check out while the store read as ready).
 */

export type DeliveryAnswers = {
  locationName: string
  address1: string
  city: string
  province: string
  postalCode: string
  countryCode: string
  offerPickup: boolean
  pickupName: string
  offerShipping: boolean
  shippingName: string
  /** As typed, in major units of the region's currency: "5" is $5.00 in USD. */
  shippingPrice: string
}

export const DEFAULT_DELIVERY_ANSWERS: DeliveryAnswers = {
  locationName: "",
  address1: "",
  city: "",
  province: "",
  postalCode: "",
  countryCode: "us",
  // Neither is ticked for the vendor: what they offer is theirs to say.
  offerPickup: false,
  pickupName: "Pickup",
  offerShipping: false,
  shippingName: "Standard shipping",
  shippingPrice: "",
}

/** The currency buyers in that country pay in, upper case ("USD"). */
const currencyFor = (regions: SellingRegion[], countryCode: string | null | undefined) =>
  (regionOfCountry(regions, countryCode)?.currency_code ?? "").toUpperCase()

/**
 * The setup the answers ask for, or what is wrong with them. A store that
 * already has a stock location is not asked for an address.
 */
export const deliveryInputFrom = (
  answers: DeliveryAnswers,
  current: Pick<DeliverySetup, "location" | "options" | "regions"> | undefined
): { input: DeliverySetupInput } | { problem: string } => {
  const regions = current?.regions ?? []
  const hasLocation = Boolean(current?.location)
  if (regions.length === 0) {
    return {
      problem:
        "This marketplace has no buyer region yet, so no option would be offered to anyone. Contact support.",
    }
  }
  if (!hasLocation) {
    if (!answers.locationName.trim()) {
      return { problem: "Give the place you keep your goods a name." }
    }
    if (!answers.address1.trim()) {
      return { problem: "Enter the street address of that place." }
    }
    if (!/^[a-z]{2}$/i.test(answers.countryCode.trim())) {
      return { problem: "Choose the country that place is in." }
    }
    if (!regionOfCountry(regions, answers.countryCode)) {
      return {
        problem: `Choose a country buyers on this marketplace are in: ${regionCountryNames(regions)}.`,
      }
    }
  }
  const currency = currencyFor(
    regions,
    current?.location?.address?.country_code || answers.countryCode
  )
  if (!answers.offerPickup && !answers.offerShipping) {
    return {
      problem:
        (current?.options.length ?? 0) > 0
          ? "Tick pickup or shipping to add another option."
          : "Tick pickup, shipping, or both: a buyer has to choose one at checkout.",
    }
  }
  if (answers.offerPickup && !answers.pickupName.trim()) {
    return { problem: "Give the pickup option a name buyers will see." }
  }
  let amount = 0
  if (answers.offerShipping) {
    if (!answers.shippingName.trim()) {
      return { problem: "Give the shipping option a name buyers will see." }
    }
    const typed = answers.shippingPrice.trim().replace(",", ".")
    amount = Number(typed)
    if (typed === "" || !Number.isFinite(amount) || amount < 0) {
      return {
        problem: `Enter what you charge for shipping, in ${currency || "your buyers' currency"}. Enter 0 to ship free.`,
      }
    }
  }

  return {
    input: {
      location: {
        name: answers.locationName,
        address_1: answers.address1,
        city: answers.city,
        province: answers.province,
        postal_code: answers.postalCode,
        country_code: answers.countryCode,
      },
      pickup: answers.offerPickup ? { name: answers.pickupName.trim() } : null,
      shipping: answers.offerShipping
        ? { name: answers.shippingName.trim(), amount }
        : null,
    },
  }
}

type DeliverySetupFormProps = {
  /** What the form starts with; the vendor can change all of it. */
  initial?: Partial<DeliveryAnswers>
  /** Called once the backend has answered every call of the setup. */
  onDone?: (result: DeliverySetupResult) => void
}

export const DeliverySetupForm = ({
  initial,
  onDone,
}: DeliverySetupFormProps) => {
  const [answers, setAnswers] = useState<DeliveryAnswers>({
    ...DEFAULT_DELIVERY_ANSWERS,
    ...initial,
  })
  const [problem, setProblem] = useState<string | null>(null)
  const set = <K extends keyof DeliveryAnswers>(key: K, value: DeliveryAnswers[K]) =>
    setAnswers((before) => ({ ...before, [key]: value }))

  const { data: setup, isPending, isError, error, refetch } = useSellingSetup()
  const setUp = useSetUpDelivery()
  const { pending, isBusyNow } = useIsBusy(sellingSetupMutationKeys.delivery)

  const delivery = setup?.delivery
  const location = delivery?.location ?? null
  const regions = delivery?.regions ?? []
  // Only countries buyers are in; the first of them until the vendor chooses.
  const countryChoices = [...new Set(regions.flatMap(regionCountryCodes))]
  const country = countryChoices.includes(answers.countryCode.trim().toLowerCase())
    ? answers.countryCode.trim().toLowerCase()
    : (countryChoices[0] ?? "")
  const deliversFrom = location ? location.address?.country_code : country
  const currency = currencyFor(regions, deliversFrom)
  const locationOutside = Boolean(
    location && regions.length > 0 && !regionOfCountry(regions, deliversFrom)
  )

  const submit = async () => {
    // One setup at a time, however fast the button is pressed.
    if (isBusyNow()) return
    const asked = deliveryInputFrom({ ...answers, countryCode: country }, delivery)
    if ("problem" in asked) {
      setProblem(asked.problem)
      toast.error(asked.problem)
      return
    }
    setProblem(null)
    try {
      const result = await setUp.mutateAsync(asked.input)
      toast.success("Delivery saved", {
        description: result.options.length
          ? `Buyers can now choose: ${result.options.map((o) => o.name).join(", ")}.`
          : `${result.location.name} is linked to your sales channel.`,
      })
      onDone?.(result)
    } catch (e) {
      // The step that failed, in the backend's words. What was made before it
      // stays; pressing again makes only what is missing.
      const message =
        e instanceof Error ? e.message : "The setup could not be saved."
      setProblem(message)
      toast.error("Delivery was not fully set up", { description: message })
    }
  }

  if (isPending) {
    return <Text className="text-ui-fg-subtle">Checking your store…</Text>
  }
  if (isError || !delivery) {
    return (
      <div className="flex flex-col gap-y-3">
        <Alert variant="error">
          We could not read your store's delivery setup
          {error?.message ? `: ${error.message}` : "."}
        </Alert>
        <div>
          <Button variant="secondary" size="small" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-6">
      {delivery.ready ? (
        <Alert variant="success">
          Delivery is set up. Stock is held at {location?.name}, and buyers can
          choose: {delivery.options.map((o) => o.name).join(", ")}.
        </Alert>
      ) : (
        <Alert variant="warning">
          {location
            ? delivery.locationLinked
              ? delivery.unoffered.length > 0
                ? `Buyers cannot check out yet: no buyer is offered your pickup or shipping. ${delivery.unoffered
                    .map(unofferedReason)
                    .join(" ")} Fix it in Settings, Locations, or add an option here.`
                : `Buyers cannot check out yet: ${location.name} has no pickup or shipping option.`
              : `Buyers cannot add your products to a cart yet: ${location.name} is not linked to your sales channel.`
            : "Buyers cannot check out yet: your store has no stock location and no pickup or shipping option."}
        </Alert>
      )}
      {locationOutside ? (
        <Alert variant="warning">
          {location?.name} is in{" "}
          {(location?.address?.country_code ?? "").toUpperCase() || "no country"},
          where this marketplace has no buyers: it sells to{" "}
          {regionCountryNames(regions)}. A pickup or shipping option there would
          be offered to no one. Change its address in Settings, Locations.
        </Alert>
      ) : null}

      <section className="flex flex-col gap-y-3">
        <Heading level="h2">Where your goods are</Heading>
        {location ? (
          <Text className="text-ui-fg-subtle">
            Your stock is held at <strong>{location.name}</strong>
            {location.address?.address_1
              ? ` (${[location.address.address_1, location.address.city]
                  .filter(Boolean)
                  .join(", ")})`
              : ""}
            .{" "}
            {delivery.locationLinked
              ? "It is linked to your sales channel."
              : "Saving links it to your sales channel."}
          </Text>
        ) : (
          <>
            <Text className="text-ui-fg-subtle">
              The place you keep what you sell, and hand it over from. Your
              stock is counted here.
            </Text>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label htmlFor="ds-name">Name of this place</Label>
                <Input
                  id="ds-name"
                  placeholder="Home, the farm, the studio…"
                  value={answers.locationName}
                  onChange={(e) => set("locationName", e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="ds-address">Street address</Label>
                <Input
                  id="ds-address"
                  value={answers.address1}
                  onChange={(e) => set("address1", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ds-city">City</Label>
                <Input
                  id="ds-city"
                  value={answers.city}
                  onChange={(e) => set("city", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ds-province">State</Label>
                <Input
                  id="ds-province"
                  value={answers.province}
                  onChange={(e) => set("province", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ds-postal">ZIP / postal code</Label>
                <Input
                  id="ds-postal"
                  value={answers.postalCode}
                  onChange={(e) => set("postalCode", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ds-country">Country</Label>
                <CountrySelect
                  id="ds-country"
                  value={country}
                  countryCodes={countryChoices}
                  onChange={(e) => set("countryCode", e.target.value)}
                />
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Only countries buyers on this marketplace are in.
                </Text>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-y-3">
        <Heading level="h2">How buyers get their order</Heading>
        <Text className="text-ui-fg-subtle">
          A buyer chooses one of these at checkout, and an order cannot be
          placed without one, whatever you sell. Offer either or both. You
          arrange the handover yourself: nothing here books a courier.
        </Text>

        <div className="border-ui-border-base rounded-md border p-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="ds-pickup"
              checked={answers.offerPickup}
              onCheckedChange={(checked) => set("offerPickup", checked === true)}
            />
            <div className="flex-1">
              <Label htmlFor="ds-pickup">Pickup, free</Label>
              <Text size="small" className="text-ui-fg-subtle">
                Buyers in your country can choose to collect from you.
              </Text>
              {answers.offerPickup ? (
                <div className="mt-3">
                  <Label htmlFor="ds-pickup-name">Shown to buyers as</Label>
                  <Input
                    id="ds-pickup-name"
                    value={answers.pickupName}
                    onChange={(e) => set("pickupName", e.target.value)}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="border-ui-border-base rounded-md border p-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="ds-shipping"
              checked={answers.offerShipping}
              onCheckedChange={(checked) =>
                set("offerShipping", checked === true)
              }
            />
            <div className="flex-1">
              <Label htmlFor="ds-shipping">Shipping, one flat rate</Label>
              <Text size="small" className="text-ui-fg-subtle">
                One price per order to anywhere in your country. Rates by
                region or weight are in Settings, Locations.
              </Text>
              {answers.offerShipping ? (
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <Label htmlFor="ds-shipping-name">Shown to buyers as</Label>
                    <Input
                      id="ds-shipping-name"
                      value={answers.shippingName}
                      onChange={(e) => set("shippingName", e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="ds-shipping-price">
                      Price per order{currency ? ` (${currency})` : ""}
                    </Label>
                    <Input
                      id="ds-shipping-price"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="5.00"
                      value={answers.shippingPrice}
                      onChange={(e) => set("shippingPrice", e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {problem ? <Alert variant="error">{problem}</Alert> : null}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending} isLoading={pending}>
          {delivery.ready ? "Add this option" : "Save delivery"}
        </Button>
      </div>
    </div>
  )
}

export default DeliverySetupForm

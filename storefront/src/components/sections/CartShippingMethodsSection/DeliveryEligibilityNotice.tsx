import type { DeliveryEligibility } from "@/lib/data/delivery"
import {
  type DeliveryAlternative,
  deliveryAnswerIsShown,
  isFailedDeliveryCheck,
  isOutsideDeliveryZones,
} from "@/lib/helpers/delivery-eligibility"
import type { FulfillmentType } from "@/lib/helpers/seller-shipping"
import clsx from "clsx"

const ALTERNATIVE_LABEL: Record<DeliveryAlternative, string> = {
  pickup: "Pickup",
  shipping: "Shipping",
}

/**
 * What the delivery step tells the buyer about the delivery-zone check
 * (lib/helpers/delivery-eligibility.ts for what each answer means):
 *
 * - beside the Delivery options: the answer, or that it could not be checked;
 * - after the step pre-selected Pickup or Shipping because the address is
 *   outside every delivery zone: why, and that Delivery can still be chosen;
 * - for a store with no delivery zones configured: nothing.
 */
export function DeliveryEligibilityNotice({
  answer,
  checking,
  selected,
  nudgedTo,
}: {
  answer: DeliveryEligibility | null
  checking: boolean
  /** The fulfillment type whose options are shown. */
  selected: FulfillmentType | undefined
  /** Where this answer moved the selection, if it did. */
  nudgedTo: DeliveryAlternative | undefined
}) {
  const onDelivery = selected === "delivery"

  if (checking) {
    return onDelivery ? (
      <div
        className="mb-4 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3 text-sm text-ui-fg-subtle"
        data-testid="delivery-eligibility"
      >
        Checking delivery to your postal code...
      </div>
    ) : null
  }

  if (!answer || !deliveryAnswerIsShown(answer)) {
    return null
  }

  if (!onDelivery) {
    // Moved off Delivery by this answer: the reason stays in view.
    if (!nudgedTo || selected !== nudgedTo || !isOutsideDeliveryZones(answer)) {
      return null
    }
    return (
      <div
        className="mb-4 rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800"
        role="status"
        data-testid="delivery-nudge"
      >
        {answer.reason || "Delivery isn't available at your address."}
        <div className="mt-1">
          {`We've selected ${ALTERNATIVE_LABEL[nudgedTo]} instead. You can still choose Delivery`}
          {answer.approximate
            ? ": this check goes by your postal code, so it is approximate."
            : "."}
        </div>
      </div>
    )
  }

  return (
    <div
      className={clsx(
        "mb-4 rounded-md border p-3 text-sm",
        answer.available
          ? "border-green-200 bg-green-50 text-green-800"
          : "border-orange-200 bg-orange-50 text-orange-800"
      )}
      data-testid="delivery-eligibility"
    >
      {answer.available
        ? answer.message || "Delivery is available for your address."
        : answer.reason ||
          (isFailedDeliveryCheck(answer)
            ? "We couldn't check delivery to your address just now."
            : "Delivery may not be available for this address.")}
      {!answer.available && answer.suggestion ? (
        <div className="mt-1">{answer.suggestion}</div>
      ) : null}
    </div>
  )
}

import { timingSafeEqual } from "crypto"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * The proof a delivery was created to require, and whether a submission meets it.
 *
 * `food_delivery.proof_type` is set when the delivery is created (`NONE` by
 * default) and overwritten with the proof actually recorded. Before delivery it
 * is therefore the requirement. Both proof routes used to compare the PIN only
 * when the caller *also* chose `PIN_CODE`, so a courier (or anyone) could skip a
 * PIN-protected delivery's PIN by submitting `PHOTO` instead; and
 * `PUT /store/food-deliveries/:id` could set `DELIVERED` with no proof at all.
 *
 * The rule here: **a delivery that requires proof reaches a delivered state
 * only by presenting that proof**, and a PIN requirement is met only by the
 * PIN on record.
 */

/** Statuses that mean the goods reached someone. */
export const DELIVERED_STATUSES: ReadonlySet<string> = new Set([
  "DELIVERED",
  "DELIVERED_TO_NEIGHBOR",
  "DELIVERED_TO_SAFE_PLACE",
])

type DeliveryProofRequirement = {
  proof_type?: string | null
  proof_pin_code?: string | null
}

/** True when the delivery was created with a proof requirement. */
export function requiresProof(delivery: DeliveryProofRequirement): boolean {
  return !!delivery.proof_type && delivery.proof_type !== "NONE"
}

function samePin(expected: string, submitted: string): boolean {
  const a = Buffer.from(expected, "utf8")
  const b = Buffer.from(submitted, "utf8")
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Null when `submitted` satisfies the delivery's requirement, else the reason
 * to refuse. A PIN requirement with no PIN on record is refused rather than
 * waved through: the requirement cannot be met, so it is not met.
 */
export function proofOfDeliveryError(
  delivery: DeliveryProofRequirement,
  submitted: { proof_type: string; pin_code?: string | null }
): string | null {
  if (!requiresProof(delivery)) return null

  if (submitted.proof_type !== delivery.proof_type) {
    return `This delivery requires ${delivery.proof_type} proof`
  }

  if (delivery.proof_type === "PIN_CODE") {
    const expected = delivery.proof_pin_code
    const given = submitted.pin_code
    if (!expected || !given || !samePin(expected, given)) {
      return "Invalid PIN code"
    }
  }

  return null
}

/**
 * The delivery, or null when there is no such row. Only a not-found becomes
 * null; any other failure propagates, so a database outage surfaces as an
 * error rather than as a refusal.
 */
export async function retrieveDeliveryOrNull<T>(
  service: { retrieveFoodDelivery: (id: string) => Promise<T> },
  id: string
): Promise<T | null> {
  try {
    return await service.retrieveFoodDelivery(id)
  } catch (error) {
    if ((error as { type?: string })?.type === MedusaError.Types.NOT_FOUND) {
      return null
    }
    throw error
  }
}

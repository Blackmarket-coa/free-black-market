import { timingSafeEqual } from "crypto"
import { nullIfNotFound } from "../../shared/null-if-not-found"
import { isPlatformFileUrl, platformFileUrlBases } from "../../shared/platform-file-url"

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
 * only by meeting that requirement**. Only one of the four is proof in the
 * sense of something the courier cannot produce alone:
 *
 * - PIN_CODE is met only by the PIN on record, which the recipient holds and
 *   the courier is never shown (`DELIVERY_SECRETS`).
 * - PHOTO and SIGNATURE are met by `photo_url` / `signature_url`, which must
 *   be an https URL of a file in this platform's own storage
 *   (`isPlatformFileUrl`). That proves where the file is, not what it shows:
 *   the courier chooses the file. These are **courier-attested**, not
 *   verified.
 * - RECIPIENT_CONFIRMATION is met by a non-blank `recipient_name`, typed by
 *   the courier, who can read the recipient's name off the delivery. It is a
 *   **courier attestation that the recipient confirmed**, not a confirmation
 *   by the recipient, and must not be described as proof. A real one needs
 *   an act only the recipient can perform (their own token, or the PIN).
 *
 * Naming the type alone used to be enough for the last three, so the courier
 * the requirement constrains could close the delivery with
 * `{ proof_type: "PHOTO" }`; then with `{ proof_type: "PHOTO", photo_url:
 * "x:y" }`, since any URL zod accepts (`javascript:`, `data:` too) passed and
 * was stored and served back verbatim.
 */

/**
 * A PIN a producer may set when creating a PIN_CODE delivery: 4 to 10 digits.
 * Shorter PINs are guessable in a handful of tries, and a PIN_CODE delivery
 * created with no PIN can never be delivered (nothing writes the PIN later,
 * and `proofOfDeliveryError` refuses a requirement with no PIN on record).
 */
export const DELIVERY_PIN_PATTERN = /^\d{4,10}$/

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

/**
 * How a requirement is named in a message to the caller. Only PIN_CODE is
 * called proof; the other three are named as what they are, the courier's
 * attestation, so no response tells anyone a typed name or a chosen file
 * proved a hand-over.
 */
export function proofRequirementLabel(proofType: string | null | undefined): string {
  if (proofType === "PIN_CODE") return "PIN_CODE proof"
  if (proofType === "PHOTO" || proofType === "SIGNATURE" || proofType === "RECIPIENT_CONFIRMATION") {
    return `${proofType} (courier-attested)`
  }
  return String(proofType)
}

/**
 * What a closed delivery says about how it was closed: the delivery event
 * `recordProofOfDelivery` saves (served by `GET /store/food-deliveries/:id`
 * to the producer, courier and recipient) and the `/proof` 200 message. Built
 * from `proofRequirementLabel`, so it calls PIN_CODE proof and names the other
 * three as courier-attested. It used to read "Delivery completed with PHOTO
 * proof" (and SIGNATURE, RECIPIENT_CONFIRMATION) beside a 200 of "Proof of
 * delivery recorded successfully", after the refusals had stopped calling
 * those proof.
 */
export function deliveryCompletedDescription(proofType: string | null | undefined): string {
  return `Delivery completed with ${proofRequirementLabel(proofType)}`
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
 *
 * A `photo_url` or `signature_url` is checked whatever the requirement, even
 * on a delivery that requires none: it is stored on the delivery and served
 * to its producer, courier and recipient, so a `javascript:` or foreign URL
 * is refused before it is written, not only when it is the evidence.
 */
export function proofOfDeliveryError(
  delivery: DeliveryProofRequirement,
  submitted: {
    proof_type: string
    pin_code?: string | null
    photo_url?: string | null
    signature_url?: string | null
    recipient_name?: string | null
  },
  fileUrlBases: readonly string[] = platformFileUrlBases()
): string | null {
  for (const field of ["photo_url", "signature_url"] as const) {
    const url = submitted[field]
    if (url != null && !isPlatformFileUrl(url, fileUrlBases)) {
      return `${field} must be an https URL of a file uploaded to this platform`
    }
  }

  if (!requiresProof(delivery)) return null

  if (submitted.proof_type !== delivery.proof_type) {
    return `This delivery requires ${proofRequirementLabel(delivery.proof_type)}`
  }

  switch (delivery.proof_type) {
    case "PIN_CODE": {
      const expected = delivery.proof_pin_code
      const given = submitted.pin_code
      if (!expected || !given || !samePin(expected, given)) {
        return "Invalid PIN code"
      }
      return null
    }
    // Courier-attested: the URL was checked above for where it points, and
    // nothing checks what the file shows.
    case "PHOTO":
      return submitted.photo_url ? null : "PHOTO requires photo_url (a file the courier uploaded; not verified)"
    case "SIGNATURE":
      return submitted.signature_url
        ? null
        : "SIGNATURE requires signature_url (a file the courier uploaded; not verified)"
    // Courier-attested: the courier types the name. Not proof (see above).
    case "RECIPIENT_CONFIRMATION":
      return submitted.recipient_name?.trim()
        ? null
        : "RECIPIENT_CONFIRMATION requires recipient_name (the courier's attestation of who received it)"
    default:
      // A requirement this code does not know how to check is not met.
      return `This delivery requires ${delivery.proof_type}, which cannot be accepted here`
  }
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
  return nullIfNotFound(service.retrieveFoodDelivery(id))
}

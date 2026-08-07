import { OPERATION_TYPES, MAJOR_ALLERGENS } from "../../../modules/cottage-food"

/**
 * Field allowlists + coercion for the cottage-food vendor routes.
 *
 * Kept in one place because the profile carries a seller's home address and
 * permit number — fields that should only ever be written through an explicit
 * list, never by spreading a request body onto a model.
 */

const TEXT_FIELDS = [
  "jurisdiction_label",
  "state_code",
  "permit_number",
  "permit_type_label",
  "permit_issuer",
  "food_handler_cert_number",
  "timezone",
  "label_disclosure_text",
  "label_business_name",
  "label_address",
] as const

const DATE_FIELDS = [
  "permit_issued_at",
  "permit_expires_at",
  "food_handler_expires_at",
] as const

const BOOLEAN_FIELDS = [
  "allows_pickup",
  "allows_delivery",
  "allows_shipping",
  "allows_out_of_state",
  "allows_wholesale",
  "show_address_publicly",
  "public_disclosure_opt_in",
] as const

/**
 * Limits. Explicit null is meaningful and must survive: it's how a seller
 * clears a cap they no longer want tracked, which has to be distinguishable
 * from "field absent from this PATCH".
 */
const NULLABLE_NUMBER_FIELDS = [
  "annual_sales_cap_cents",
  "daily_meal_cap",
  "weekly_meal_cap",
] as const

function cleanText(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed.slice(0, 2000) : null
}

function cleanDate(value: unknown): Date | null | undefined {
  if (value === null) return null
  if (typeof value !== "string" && !(value instanceof Date)) return undefined
  const date = new Date(value as string)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function cleanNonNegativeNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.trunc(n)
}

/**
 * Build the persistable patch from a request body.
 *
 * Anything unrecognized, malformed, or out of range is dropped rather than
 * rejected — a seller shouldn't lose a whole profile edit because one date was
 * mistyped. The response echoes the saved profile so they can see what landed.
 */
export function sanitizeProfileInput(
  body: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}

  if (
    typeof body.operation_type === "string" &&
    (OPERATION_TYPES as readonly string[]).includes(body.operation_type)
  ) {
    patch.operation_type = body.operation_type
  }

  for (const field of TEXT_FIELDS) {
    if (!(field in body)) continue
    const value = cleanText(body[field])
    if (value !== undefined) patch[field] = value
  }

  for (const field of DATE_FIELDS) {
    if (!(field in body)) continue
    const value = cleanDate(body[field])
    if (value !== undefined) patch[field] = value
  }

  for (const field of BOOLEAN_FIELDS) {
    if (!(field in body)) continue
    if (typeof body[field] === "boolean") patch[field] = body[field]
  }

  for (const field of NULLABLE_NUMBER_FIELDS) {
    if (!(field in body)) continue
    const value = cleanNonNegativeNumber(body[field])
    if (value !== undefined) patch[field] = value
  }

  if ("cap_period_start_month" in body) {
    const month = cleanNonNegativeNumber(body.cap_period_start_month)
    if (month !== null && month !== undefined && month >= 1 && month <= 12) {
      patch.cap_period_start_month = month
    }
  }

  return patch
}

/** Normalize the ingredient list, preserving the seller's ordering. */
export function sanitizeIngredients(
  value: unknown
): Array<{ name: string; note?: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .map((item) => {
      if (typeof item === "string") return { name: item.trim() }
      if (item && typeof item === "object") {
        const name = String((item as { name?: unknown }).name ?? "").trim()
        const note = (item as { note?: unknown }).note
        return name
          ? { name, ...(typeof note === "string" && note.trim() ? { note: note.trim() } : {}) }
          : null
      }
      return null
    })
    .filter((i): i is { name: string; note?: string } => Boolean(i?.name))
    .slice(0, 200)
}

/** Keep only recognized Big-9 allergen keys, de-duplicated. */
export function sanitizeAllergens(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const allowed = new Set<string>(MAJOR_ALLERGENS as readonly string[])
  return [...new Set(value.filter((a): a is string => typeof a === "string" && allowed.has(a)))]
}

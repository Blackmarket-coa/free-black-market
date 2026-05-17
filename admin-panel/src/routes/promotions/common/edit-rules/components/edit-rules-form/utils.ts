import type { AdminPromotionRule } from "@medusajs/types"

/**
 * The /admin/promotions/.../rules response inlines fields the SDK
 * `AdminPromotionRule` type doesn't expose (required, field_type,
 * disguised, values, plus value-shape variation). Capture the
 * structural shape consumed here so callers can pass through the SDK
 * type without casting at every call site.
 */
export type RuleResponseExt = AdminPromotionRule & {
  required?: boolean
  field_type?: string
  disguised?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  values?: any
}

export const generateRuleAttributes = (rules?: RuleResponseExt[]) =>
  (rules || []).map((rule) => ({
    id: rule.id,
    required: rule.required,
    field_type: rule.field_type,
    disguised: rule.disguised,
    attribute: rule.attribute!,
    operator: rule.operator!,
    values:
      rule.field_type === "number" || rule.operator === "eq"
        ? typeof rule.values === "object"
          ? rule.values[0]?.value
          : rule.values
        : rule?.values?.map((v: { value: string }) => v.value!),
  }))

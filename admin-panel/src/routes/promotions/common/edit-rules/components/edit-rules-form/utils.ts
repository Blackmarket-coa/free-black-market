import { AdminPromotionRule } from "@medusajs/types"

// Backend enriches promotion rules with extra UI metadata that the public
// AdminPromotionRule type doesn't expose.
export type ExtendedPromotionRule = AdminPromotionRule & {
  required?: boolean
  field_type?: string
  disguised?: boolean
}

export const generateRuleAttributes = (rules?: ExtendedPromotionRule[]) =>
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
          ? (rule.values as Array<{ value: string }> | undefined)?.[0]?.value
          : rule.values
        : (rule.values as Array<{ value: string }> | undefined)?.map(
            (v) => v.value
          ),
  }))

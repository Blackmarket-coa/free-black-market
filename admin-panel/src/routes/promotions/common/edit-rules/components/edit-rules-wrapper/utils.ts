import type { RuleResponseExt } from "@routes/promotions/common/edit-rules/components/edit-rules-form/utils"

export const getRuleValue = (rule: RuleResponseExt) => {
  if (rule.field_type === "number") {
    return parseInt(rule.values as unknown as string)
  }

  return rule.values
}

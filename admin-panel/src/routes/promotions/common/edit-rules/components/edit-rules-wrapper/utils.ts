import { ExtendedPromotionRule } from "../edit-rules-form/utils"

export const getRuleValue = (rule: ExtendedPromotionRule) => {
  if (rule.field_type === "number") {
    return parseInt(rule.values as unknown as string)
  }

  return rule.values
}

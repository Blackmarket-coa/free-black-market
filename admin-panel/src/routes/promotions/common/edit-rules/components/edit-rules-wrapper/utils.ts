import type { RuleResponseExt } from "../edit-rules-form/utils"

export const getRuleValue = (rule: RuleResponseExt) => {
  if (rule.field_type === "number") {
    return parseInt(rule.values as unknown as string)
  }

  return rule.values
}

import { castNumber } from "@lib/cast-number"
import { ITEM_TOTAL_ATTRIBUTE } from "@routes/locations/common/constants"

type PriceRuleOperator = "gt" | "lt" | "eq" | "lte" | "gte"

const createPriceRule = (
  attribute: string,
  operator: PriceRuleOperator,
  value: string | number
) => {
  const rule = {
    attribute,
    operator,
    value: castNumber(value),
  }

  return rule
}

export const buildShippingOptionPriceRules = (rule: {
  gte?: string | number | null
  lte?: string | number | null
  gt?: string | number | null
  lt?: string | number | null
  eq?: string | number | null
}) => {
  const conditions: { value: string | number | null | undefined; operator: PriceRuleOperator }[] = [
    { value: rule.gte, operator: "gte" },
    { value: rule.lte, operator: "lte" },
    { value: rule.gt, operator: "gt" },
    { value: rule.lt, operator: "lt" },
    { value: rule.eq, operator: "eq" },
  ]

  const conditionsWithValues = conditions.filter(({ value }) => value) as {
    value: string | number
    operator: PriceRuleOperator
  }[]

  return conditionsWithValues.map(({ operator, value }) =>
    createPriceRule(ITEM_TOTAL_ATTRIBUTE, operator, value)
  )
}

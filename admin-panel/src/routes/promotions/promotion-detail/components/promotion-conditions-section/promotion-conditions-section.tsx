import { PencilSquare } from "@medusajs/icons"
import type { ApplicationMethodTargetTypeValues, HttpTypes, PromotionRuleTypes, } from "@medusajs/types"
import { Badge, Container, Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { ActionMenu } from "@components/common/action-menu"
import { BadgeListSummary } from "@components/common/badge-list-summary"
import { NoRecords } from "@components/common/empty-table-content"

type RuleProps = {
  rule: HttpTypes.AdminPromotionRule
}

function RuleBlock({ rule }: RuleProps) {
  // AdminPromotionRule in @medusajs/types omits the human-readable
  // labels and field_type that the admin response inlines. Cast
  // structurally so the badges below typecheck.
  const ruleExt = rule as HttpTypes.AdminPromotionRule & {
    attribute_label?: string
    operator_label?: string
    field_type?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    values?: any
  }

  return (
    <div className="bg-ui-bg-subtle shadow-borders-base align-center flex justify-around rounded-md p-2">
      <div className="text-ui-fg-subtle txt-compact-xsmall flex items-center whitespace-nowrap">
        <Badge
          size="2xsmall"
          key="rule-attribute"
          className="txt-compact-xsmall-plus tag-neutral-text mx-1 inline-block truncate"
        >
          {ruleExt.attribute_label}
        </Badge>

        <span className="txt-compact-2xsmall mx-1 inline-block">
          {ruleExt.operator_label}
        </span>

        <BadgeListSummary
          inline
          className="!txt-compact-small-plus"
          list={
            ruleExt.field_type === "number"
              ? [ruleExt.values]
              : ruleExt.values?.map((v: { label?: string }) => v.label)
          }
        />
      </div>
    </div>
  )
}

/**
 * The admin-panel routes accept hyphenated rule-type strings
 * ("buy-rules", "target-rules") for URL/route segments while the SDK's
 * PromotionRuleTypes uses the underscore form. Accept both so callers
 * can keep their hyphenated routing form.
 */
type RuleTypeKey =
  | PromotionRuleTypes
  | "buy-rules"
  | "target-rules"

type PromotionConditionsSectionProps = {
  rules: HttpTypes.AdminPromotionRule[]
  ruleType: RuleTypeKey
  applicationMethodTargetType?: ApplicationMethodTargetTypeValues
}

export const PromotionConditionsSection = ({
  rules,
  ruleType,
  applicationMethodTargetType,
}: PromotionConditionsSectionProps) => {
  const { t } = useTranslation()

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col">
          <Heading>
            {t(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (ruleType === "target-rules" || ruleType === "target_rules"
                ? `promotions.fields.conditions.${ruleType}.${applicationMethodTargetType}.title`
                : `promotions.fields.conditions.${ruleType}.title`) as any
            )}
          </Heading>
        </div>

        <ActionMenu
          groups={[
            {
              actions: [
                {
                  icon: <PencilSquare />,
                  label: t("actions.edit"),
                  to: `${ruleType}/edit`,
                },
              ],
            },
          ]}
        />
      </div>

      <div className="text-ui-fg-subtle flex flex-col gap-2 px-6 pb-4 pt-2">
        {!rules.length && (
          <NoRecords
            className="h-[180px]"
            title={t("general.noRecordsTitle")}
            message={t("promotions.conditions.list.noRecordsMessage")}
            action={{
              to: `${ruleType}/edit`,
              label: t("promotions.conditions.add"),
            }}
            buttonVariant="transparentIconLeft"
          />
        )}

        {rules.map((rule) => (
          <RuleBlock key={`${rule.id}-${rule.attribute}`} rule={rule} />
        ))}
      </div>
    </Container>
  )
}

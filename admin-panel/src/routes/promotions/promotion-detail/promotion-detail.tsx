import type {
  ApplicationMethodTargetTypeValues,
  PromotionRuleTypes,
} from "@medusajs/types"
import { useLoaderData, useParams } from "react-router-dom"

import { TwoColumnPageSkeleton } from "../../../components/common/skeleton"
import { TwoColumnPage } from "../../../components/layout/pages"
import { usePromotion, usePromotionRules } from "../../../hooks/api/promotions"
import { useExtension } from "../../../providers/extension-provider"
import { CampaignSection } from "./components/campaign-section"
import { PromotionConditionsSection } from "./components/promotion-conditions-section"
import { PromotionGeneralSection } from "./components/promotion-general-section"
import { promotionLoader } from "./loader"

export const PromotionDetail = () => {
  const initialData = useLoaderData() as Awaited<
    ReturnType<typeof promotionLoader>
  >

  const { id } = useParams()
  const { promotion, isLoading } = usePromotion(id!, { initialData })
  const query: Record<string, string> = {}

  if (promotion?.type === "buyget") {
    query.promotion_type = promotion.type
  }

  const { rules } = usePromotionRules(id!, "rules", query)
  const { rules: targetRules } = usePromotionRules(id!, "target-rules", query)
  const { rules: buyRules } = usePromotionRules(id!, "buy-rules", query)

  const { getWidgets } = useExtension()

  if (isLoading || !promotion) {
    return (
      <TwoColumnPageSkeleton mainSections={3} sidebarSections={1} showJSON />
    )
  }

  return (
    <TwoColumnPage
      data={promotion}
      widgets={{
        after: getWidgets("promotion.details.after"),
        before: getWidgets("promotion.details.before"),
        sideAfter: getWidgets("promotion.details.side.after"),
        sideBefore: getWidgets("promotion.details.side.before"),
      }}
      hasOutlet
      showJSON
    >
      <TwoColumnPage.Main>
        <PromotionGeneralSection promotion={promotion} />
        <PromotionConditionsSection
          rules={rules || []}
          ruleType={"rules" as PromotionRuleTypes}
          applicationMethodTargetType={"items" as ApplicationMethodTargetTypeValues}
        />
        <PromotionConditionsSection
          rules={targetRules || []}
          ruleType={"target-rules" as unknown as PromotionRuleTypes}
          applicationMethodTargetType={
            ((promotion.application_method?.target_type ||
              "items") as ApplicationMethodTargetTypeValues)
          }
        />
        {promotion.type === "buyget" && (
          <PromotionConditionsSection
            rules={buyRules || []}
            ruleType={"buy-rules" as unknown as PromotionRuleTypes}
            applicationMethodTargetType={
              "items" as ApplicationMethodTargetTypeValues
            }
          />
        )}
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        <CampaignSection campaign={promotion.campaign!} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

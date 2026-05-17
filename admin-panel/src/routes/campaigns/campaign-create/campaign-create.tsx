import { RouteFocusModal } from "@components/modals"
import { CreateCampaignForm } from "@routes/campaigns/campaign-create/components/create-campaign-form"

export const CampaignCreate = () => {
  return (
    <RouteFocusModal>
      <CreateCampaignForm />
    </RouteFocusModal>
  )
}

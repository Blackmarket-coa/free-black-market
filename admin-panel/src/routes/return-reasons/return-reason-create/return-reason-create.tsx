import { RouteFocusModal } from "@components/modals"
import { ReturnReasonCreateForm } from "@routes/return-reasons/return-reason-create/components/return-reason-create-form"

export const ReturnReasonCreate = () => {
  return (
    <RouteFocusModal>
      <ReturnReasonCreateForm />
    </RouteFocusModal>
  )
}

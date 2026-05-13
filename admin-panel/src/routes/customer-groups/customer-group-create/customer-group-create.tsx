import { RouteFocusModal } from "@components/modals"
import { CreateCustomerGroupForm } from "@routes/customer-groups/customer-group-create/components/create-customer-group-form"

export const CustomerGroupCreate = () => {
  return (
    <RouteFocusModal>
      <CreateCustomerGroupForm />
    </RouteFocusModal>
  )
}

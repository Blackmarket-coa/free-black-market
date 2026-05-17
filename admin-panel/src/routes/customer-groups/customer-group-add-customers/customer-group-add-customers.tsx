import { useParams } from "react-router-dom"
import { RouteFocusModal } from "@components/modals"
import { AddCustomersForm } from "@routes/customer-groups/customer-group-add-customers/components/add-customers-form"

export const CustomerGroupAddCustomers = () => {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <AddCustomersForm customerGroupId={id!} />
    </RouteFocusModal>
  )
}

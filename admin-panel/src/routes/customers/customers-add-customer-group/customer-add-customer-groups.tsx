import { useParams } from "react-router-dom"
import { RouteFocusModal } from "@components/modals"
import { AddCustomerGroupsForm } from "@routes/customers/customers-add-customer-group/components/add-customers-form"

export const CustomerAddCustomerGroups = () => {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <AddCustomerGroupsForm customerId={id!} />
    </RouteFocusModal>
  )
}

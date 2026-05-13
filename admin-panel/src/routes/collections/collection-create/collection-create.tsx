import { RouteFocusModal } from "@components/modals"
import { CreateCollectionForm } from "@routes/collections/collection-create/components/create-collection-form"

export const CollectionCreate = () => {
  return (
    <RouteFocusModal>
      <CreateCollectionForm />
    </RouteFocusModal>
  )
}

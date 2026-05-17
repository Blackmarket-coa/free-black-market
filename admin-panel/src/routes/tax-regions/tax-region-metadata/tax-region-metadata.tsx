import { useParams } from "react-router-dom"

import { useTaxRegion, useUpdateTaxRegion } from "../../../hooks/api"
import { MetadataForm } from "../../../components/forms/metadata-form"
import { RouteDrawer } from "../../../components/modals"

export const TaxRegionMetadata = () => {
  const { id } = useParams()

  const { tax_region, isPending, isError, error } = useTaxRegion(id!)
  const { mutateAsync, isPending: isMutating } = useUpdateTaxRegion(id!)

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <MetadataForm
        isPending={isPending}
        isMutating={isMutating}
        hook={mutateAsync as never}
        metadata={tax_region?.metadata}
      />
    </RouteDrawer>
  )
}

import { CreateVenueRequest } from "../types"

/**
 * Stub modal for creating a Venue. The Shows / Venues admin flow ships
 * incrementally; the editor UI lands in a follow-up PR. Routes that
 * reference this component compile in the meantime, and the actual
 * `CreateVenueModal` will replace this stub.
 */
type Props = {
  open: boolean
  onOpenChange: () => void
  onSubmit: (data: CreateVenueRequest) => void | Promise<void>
}

export const CreateVenueModal = (_props: Props) => {
  void _props
  return null
}

import { RouteFocusModal } from "@components/modals"
import { InviteUserForm } from "@routes/users/user-invite/components/invite-user-form/invite-user-form"

export const UserInvite = () => {
  return (
    <RouteFocusModal>
      <InviteUserForm />
    </RouteFocusModal>
  )
}

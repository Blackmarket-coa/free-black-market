import { useContext } from "react"
import { RouteModalProviderContext } from "@components/modals/route-modal-provider/route-modal-context"

export const useRouteModal = () => {
  const context = useContext(RouteModalProviderContext)

  if (!context) {
    throw new Error("useRouteModal must be used within a RouteModalProvider")
  }

  return context
}

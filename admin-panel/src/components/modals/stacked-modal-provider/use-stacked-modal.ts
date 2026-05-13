import { useContext } from "react"
import { StackedModalContext } from "@components/modals/stacked-modal-provider/stacked-modal-context"

export const useStackedModal = () => {
  const context = useContext(StackedModalContext)

  if (!context) {
    throw new Error(
      "useStackedModal must be used within a StackedModalProvider"
    )
  }

  return context
}

import { useContext } from "react"
import { SidebarContext } from "@providers/sidebar-provider/sidebar-context"

export const useSidebar = () => {
  const context = useContext(SidebarContext)

  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }

  return context
}

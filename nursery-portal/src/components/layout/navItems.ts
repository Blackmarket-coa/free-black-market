import type { Role } from "@/types"

export interface NavItem {
  to: string
  label: string
  icon: string
  hubOnly?: boolean
}

// All roles see the core items; hub adds Network + Wholesale.
export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: "🏠" },
  { to: "/inventory", label: "Inventory", icon: "🪴" },
  { to: "/propagation", label: "Propagation", icon: "🌱" },
  { to: "/listings", label: "Listings", icon: "🏷️" },
  { to: "/orders", label: "Orders", icon: "🛒" },
  { to: "/seasonal", label: "Seasonal Planner", icon: "📅" },
  { to: "/payouts", label: "Payouts", icon: "💸" },
  { to: "/quests", label: "Quests", icon: "🏆" },
  { to: "/blackout", label: "Blackout", icon: "💬" },
  { to: "/analytics", label: "Analytics", icon: "📊" },
  { to: "/network", label: "Network", icon: "🌐", hubOnly: true },
  { to: "/wholesale", label: "Wholesale", icon: "📦", hubOnly: true },
]

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.hubOnly || role === "hub")
}

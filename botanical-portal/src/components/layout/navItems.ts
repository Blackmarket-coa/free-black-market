import type { OperatorType } from "@/types"

export interface NavItem {
  to: string
  label: string
  icon: string
  collectiveOnly?: boolean
}

// All operators see the core items; collectives add Makers + Pool Splits.
export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: "🏠" },
  { to: "/pathways", label: "Pathways", icon: "🧭" },
  { to: "/production", label: "Production", icon: "⚗️" },
  { to: "/formulas", label: "Formulas", icon: "📖" },
  { to: "/raw-materials", label: "Raw Materials", icon: "🌾" },
  { to: "/finished", label: "Finished Goods", icon: "🫙" },
  { to: "/listings", label: "Listings", icon: "🏷️" },
  { to: "/wholesale", label: "Wholesale", icon: "📦" },
  { to: "/orders", label: "Orders", icon: "🛒" },
  { to: "/compliance", label: "Compliance", icon: "✅" },
  { to: "/nursery", label: "Nursery Network", icon: "🌐" },
  { to: "/payouts", label: "Payouts", icon: "💸" },
  { to: "/analytics", label: "Analytics", icon: "📊" },
  { to: "/quests", label: "Quests", icon: "🏆" },
  { to: "/blackout", label: "Blackout", icon: "💬" },
  { to: "/makers", label: "Makers", icon: "👥", collectiveOnly: true },
  { to: "/pool-splits", label: "Pool Splits", icon: "🤝", collectiveOnly: true },
]

export function navItemsForOperator(operatorType: OperatorType): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.collectiveOnly || operatorType === "collective")
}

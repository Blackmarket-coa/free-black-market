export interface NavItem {
  to: string
  label: string
  icon: string
}

// Creator monetization navigation. Mirrors the wellness/nursery portal shell;
// the surfaces are creator-specific (memberships, credits, boosts, splits,
// stream overlay) and bridge into the creator's Blackout Space.
export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: "🏠" },
  { to: "/memberships", label: "Memberships", icon: "💎" },
  { to: "/credits", label: "Coalition Credits", icon: "🪙" },
  { to: "/boosts", label: "Governance Boosts", icon: "🚀" },
  { to: "/splits", label: "Smart Splits", icon: "🤝" },
  { to: "/stream", label: "Stream", icon: "🎬" },
  { to: "/blackout", label: "Blackout Space", icon: "💬" },
  { to: "/payouts", label: "Payouts", icon: "💸" },
  { to: "/analytics", label: "Analytics", icon: "📊" },
  { to: "/embed", label: "Embed", icon: "🔗" },
  { to: "/quests", label: "Quests", icon: "🎯" },
]

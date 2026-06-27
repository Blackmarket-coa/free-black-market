export interface NavItem {
  to: string
  label: string
  icon: string
}

// Solo wellness practitioner navigation (warm-themed). No hub/node split.
export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: "🏠" },
  { to: "/calendar", label: "Booking Calendar", icon: "📅" },
  { to: "/sessions", label: "Sessions", icon: "🌿" },
  { to: "/classes", label: "Classes", icon: "🎉" },
  { to: "/digital", label: "Digital Products", icon: "📥" },
  { to: "/products", label: "Physical Products", icon: "🧴" },
  { to: "/memberships", label: "Memberships", icon: "💎" },
  { to: "/clients", label: "Clients", icon: "👥" },
  { to: "/payouts", label: "Payouts", icon: "💸" },
  { to: "/blackout", label: "Blackout", icon: "💬" },
  { to: "/analytics", label: "Analytics", icon: "📊" },
  { to: "/embed", label: "Embed", icon: "🔗" },
  { to: "/quests", label: "Quests", icon: "🎯" },
]

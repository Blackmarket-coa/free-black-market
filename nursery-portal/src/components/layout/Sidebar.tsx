import { NavLink } from "react-router-dom"
import { useRole } from "@/hooks/useRole"
import { usePayouts } from "@/hooks/usePayouts"
import { navItemsForRole } from "./navItems"
import { TierBadge } from "@/components/payouts/TierBadge"
import { classNames } from "@/lib/format"

// Role-aware sidebar. Collapses to an icon rail under md (greenhouse phones);
// labels are hidden but kept as title tooltips.
export function Sidebar() {
  const { role, nodeId } = useRole()
  const { data: payouts } = usePayouts()
  const items = navItemsForRole(role)

  return (
    <aside className="row-span-1 border-r border-moss bg-bark flex flex-col">
      <div className="px-3 py-3 border-b border-moss hidden md:block">
        <div className="text-xs text-ghost uppercase tracking-wide">
          {role === "hub" ? "Hub Operator" : "Grower Node"}
        </div>
        <div className="text-sm text-cream-50 font-medium mt-0.5">
          {role === "hub" ? "BMC Network" : nodeId.replace("node_", "").toUpperCase()}
        </div>
        {payouts && (
          <div className="mt-2">
            <TierBadge tier={payouts.tier} />
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto scroll-area py-2">
        <ul className="space-y-0.5 px-2">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                title={item.label}
                className={({ isActive }) =>
                  classNames(
                    "flex items-center gap-3 rounded-sm px-2.5 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-forest-900/40 text-cream-50 border border-forest-700"
                      : "text-mist hover:text-cream-100 hover:bg-moss/40 border border-transparent"
                  )
                }
              >
                <span aria-hidden className="text-base w-5 text-center shrink-0">
                  {item.icon}
                </span>
                <span className="hidden md:inline truncate">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}

import { NavLink } from "react-router-dom"
import { useOperatorType } from "@/hooks/useOperatorType"
import { navItemsForOperator } from "./navItems"
import { classNames } from "@/lib/format"

// Operator-aware sidebar. Collapses to an icon rail under md; labels are hidden
// but kept as title tooltips.
export function Sidebar() {
  const { operatorType, nurseryNodeId } = useOperatorType()
  const items = navItemsForOperator(operatorType)

  return (
    <aside className="row-span-1 border-r border-moss bg-bark flex flex-col">
      <div className="px-3 py-3 border-b border-moss hidden md:block">
        <div className="text-xs text-ghost uppercase tracking-wide">
          {operatorType === "collective" ? "Collective" : "Plant Products Maker"}
        </div>
        <div className="text-sm text-cream-50 font-medium mt-0.5">
          {operatorType === "collective" ? "Production House" : "Your Workshop"}
        </div>
        {nurseryNodeId && (
          <div className="text-[11px] text-forest-300 mt-1">
            🌐 {nurseryNodeId.replace("node_", "").toUpperCase()}
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

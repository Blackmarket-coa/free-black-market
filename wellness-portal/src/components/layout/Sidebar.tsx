import { NavLink } from "react-router-dom"
import { usePractitioner } from "@/hooks/usePractitioner"
import { usePayouts } from "@/hooks/useWellness"
import { NAV_ITEMS } from "./navItems"
import { TierBadge } from "@bmc/ui"
import { classNames } from "@bmc/portal-kit"

// Warm, practitioner-focused sidebar. Collapses to an icon rail under md;
// labels are hidden but kept as title tooltips.
export function Sidebar() {
  const { practitionerName } = usePractitioner()
  const { data: payouts } = usePayouts()

  return (
    <aside className="row-span-1 border-r border-moss bg-bark flex flex-col">
      <div className="px-3 py-3 border-b border-moss hidden md:block">
        <div className="text-xs text-ghost uppercase tracking-wide">Practitioner</div>
        <div className="text-sm text-cream-50 font-medium mt-0.5">{practitionerName}</div>
        {payouts && (
          <div className="mt-2">
            <TierBadge tier={payouts.tier} />
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto scroll-area py-2">
        <ul className="space-y-0.5 px-2">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                title={item.label}
                className={({ isActive }) =>
                  classNames(
                    "flex items-center gap-3 rounded-sm px-2.5 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-amber-900/30 text-cream-50 border border-amber-700"
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

      <div className="hidden md:block border-t border-moss px-3 py-3 space-y-1.5">
        <a
          href="https://freeblackmarket.com"
          target="_blank"
          rel="noreferrer"
          className="block text-xs text-amber-300 hover:text-amber-200"
        >
          View my FBM storefront ↗
        </a>
        <a
          href="https://shaktiinnergy.com"
          target="_blank"
          rel="noreferrer"
          className="block text-xs text-mist hover:text-cream-100"
        >
          View my website ↗
        </a>
      </div>
    </aside>
  )
}

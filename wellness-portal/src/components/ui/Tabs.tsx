// TODO: extract to packages/bmc-ui
import { classNames } from "@/lib/format"

export interface TabDef {
  key: string
  label: string
  count?: number
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[]
  active: string
  onChange: (key: string) => void
}) {
  return (
    <div className="flex gap-1 border-b border-moss mb-4 overflow-x-auto scroll-area">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={classNames(
            "px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors",
            active === t.key
              ? "border-amber-500 text-cream-50"
              : "border-transparent text-mist hover:text-cream-100"
          )}
        >
          {t.label}
          {typeof t.count === "number" && (
            <span className="ml-1.5 text-xs text-ghost">({t.count})</span>
          )}
        </button>
      ))}
    </div>
  )
}

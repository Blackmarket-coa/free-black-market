import { useOperatorType } from "@/hooks/useOperatorType"

export function TopBar() {
  const { operatorType } = useOperatorType()
  return (
    <header className="col-span-2 flex items-center justify-between px-4 border-b border-moss bg-bark">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-lg">
          🌿
        </span>
        <span className="heading text-sm tracking-tight">FBM Botanical Portal</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-mist">
        <span className="hidden sm:inline">
          {operatorType === "collective" ? "Collective view" : "Maker view"}
        </span>
        <span className="w-7 h-7 rounded-full bg-forest-700 text-cream-50 flex items-center justify-center text-xs">
          {operatorType === "collective" ? "C" : "M"}
        </span>
      </div>
    </header>
  )
}

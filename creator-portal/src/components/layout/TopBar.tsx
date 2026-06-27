import { useCreator } from "@/hooks/useCreator"

export function TopBar() {
  const { creatorName } = useCreator()
  const initials = creatorName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

  return (
    <header className="col-span-2 flex items-center justify-between px-4 border-b border-moss bg-bark">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-lg">
          🎬
        </span>
        <span className="heading text-sm tracking-tight">FBM Creator Portal</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-mist">
        <span className="hidden sm:inline">{creatorName}</span>
        <span className="w-7 h-7 rounded-full bg-amber-600 text-cream-50 flex items-center justify-center text-xs">
          {initials}
        </span>
      </div>
    </header>
  )
}

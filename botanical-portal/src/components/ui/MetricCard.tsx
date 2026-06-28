import type { ReactNode } from "react"

export function MetricCard({
  label,
  value,
  subtitle,
  icon,
}: {
  label: string
  value: ReactNode
  subtitle?: string
  icon?: ReactNode
}) {
  return (
    <div className="panel-pad">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-ghost">{label}</span>
        {icon && <span className="text-lg leading-none">{icon}</span>}
      </div>
      <div className="heading text-2xl mt-2 text-cream-50">{value}</div>
      {subtitle && <div className="text-xs text-mist mt-1">{subtitle}</div>}
    </div>
  )
}

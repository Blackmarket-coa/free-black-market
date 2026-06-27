import type { ReactNode } from "react"

export function EmptyState({
  icon = "🌱",
  title,
  message,
  cta,
}: {
  icon?: string
  title: string
  message?: string
  cta?: ReactNode
}) {
  return (
    <div className="panel-pad flex flex-col items-center justify-center text-center py-12">
      <div className="text-4xl mb-3" aria-hidden>
        {icon}
      </div>
      <h3 className="heading text-lg text-cream-50">{title}</h3>
      {message && <p className="text-sm text-mist mt-1 max-w-sm">{message}</p>}
      {cta && <div className="mt-4">{cta}</div>}
    </div>
  )
}

import { PageHeader } from "./PageHeader"
import { EmptyState } from "./EmptyState"

// Placeholder for routes whose full build is a follow-up. Keeps navigation
// complete so nothing 404s and the information architecture is visible.
export function StubPage({
  title,
  icon,
  summary,
  planned,
}: {
  title: string
  icon: string
  summary: string
  planned: string[]
}) {
  return (
    <div>
      <PageHeader title={title} subtitle={summary} />
      <EmptyState
        icon={icon}
        title="Coming soon"
        message="This surface is scaffolded. The full build is a follow-up; the planned sections are listed below."
      />
      <div className="panel-pad mt-4">
        <div className="text-xs uppercase tracking-wide text-ghost mb-2">
          Planned sections
        </div>
        <ul className="space-y-1 text-sm text-mist list-disc list-inside">
          {planned.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

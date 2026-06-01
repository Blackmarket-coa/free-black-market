import type { EarnedTitle } from "@/lib/data/progression"

/**
 * A single earned title chip on the character sheet. Presentation-only.
 */
export function TitleBadge({ title }: { title: EarnedTitle }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
      style={{ borderColor: title.color, color: title.color }}
      title={title.description}
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: title.color }}
      />
      {title.name}
    </span>
  )
}

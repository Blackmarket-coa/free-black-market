import { Badge } from "@medusajs/ui"
import type { RequirementTag } from "../../../hooks/api/quests"

const TAG_META: Record<RequirementTag, { label: string; color: "green" | "orange" | "blue" | "grey" }> = {
  platform: { label: "🟢 FBM-generated", color: "green" },
  assisted: { label: "🟡 FBM-assisted", color: "orange" },
  "vendor-supplied": { label: "⚪ You upload", color: "blue" },
  "outside-fbm": { label: "❌ Outside FBM", color: "grey" },
}

export const RequirementTagBadge = ({ tag }: { tag: RequirementTag }) => {
  const meta = TAG_META[tag]
  return (
    <Badge size="2xsmall" color={meta.color}>
      {meta.label}
    </Badge>
  )
}

const STATUS_COLOR: Record<string, "green" | "orange" | "grey" | "red"> = {
  satisfied: "green",
  unsatisfied: "orange",
  unavailable: "grey",
  checklist: "blue" as any,
}

export const RequirementStatusBadge = ({ status }: { status: string }) => {
  return (
    <Badge size="2xsmall" color={(STATUS_COLOR[status] ?? "grey") as any}>
      {status}
    </Badge>
  )
}

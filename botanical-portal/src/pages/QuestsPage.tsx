import { useMemo, useState } from "react"
import { useQuestCatalog, useQuestEnrollments } from "@/hooks/useQuests"
import { PageHeader } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { Tabs } from "@bmc/ui"
import { EmptyState } from "@bmc/ui"
import { classNames } from "@bmc/portal-kit"
import type {
  QuestCatalogEntry,
  QuestEnrollmentItem,
  QuestRequirementStatus,
  QuestRequirementTag,
} from "@/types"

// Requirement-tag legend, mirroring the backend catalog contract:
// platform 🟢 / assisted 🟡 / vendor-supplied ⚪ / outside-fbm ❌
const TAG_META: Record<QuestRequirementTag, { icon: string; label: string }> = {
  platform: { icon: "🟢", label: "FBM generates from real records" },
  assisted: { icon: "🟡", label: "FBM drafts, you confirm" },
  "vendor-supplied": { icon: "⚪", label: "you upload it" },
  "outside-fbm": { icon: "❌", label: "happens outside FBM" },
}

const STATUS_STYLE: Record<QuestRequirementStatus, string> = {
  satisfied: "text-forest-300",
  unsatisfied: "text-amber-300",
  unavailable: "text-ghost",
  checklist: "text-mist",
}

export function QuestsPage() {
  const catalog = useQuestCatalog()
  const enrollments = useQuestEnrollments()
  const [tab, setTab] = useState("enrolled")

  const isLoading = catalog.isLoading || enrollments.isLoading
  const isError = catalog.isError || enrollments.isError

  const catalogByKey = useMemo(() => {
    const map = new Map<string, QuestCatalogEntry>()
    for (const q of catalog.data ?? []) map.set(q.key, q)
    return map
  }, [catalog.data])

  const active = (enrollments.data ?? []).filter((e) => e.enrollment.status === "ACTIVE")
  const enrolledKeys = new Set(active.map((e) => e.enrollment.quest_key))
  const available = (catalog.data ?? []).filter((q) => !enrolledKeys.has(q.key))

  return (
    <div>
      <PageHeader
        title="Quests"
        subtitle="Opt-in goals evaluated against your live operating record. FBM assembles the evidence; the gatekeeper decides."
      />
      <QueryState isLoading={isLoading} isError={isError}>
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: "enrolled", label: "In progress", count: active.length },
            { key: "catalog", label: "Catalog", count: available.length },
          ]}
        />

        {tab === "enrolled" &&
          (active.length === 0 ? (
            <EmptyState
              icon="🏆"
              title="No active quests"
              message="Browse the catalog and opt into a quest — nothing is auto-enrolled."
            />
          ) : (
            <div className="space-y-3">
              {active.map((item) => (
                <EnrollmentCard
                  key={item.enrollment.id}
                  item={item}
                  quest={catalogByKey.get(item.enrollment.quest_key)}
                />
              ))}
            </div>
          ))}

        {tab === "catalog" && (
          <div className="grid lg:grid-cols-2 gap-3">
            {available.map((q) => (
              <CatalogCard key={q.key} quest={q} />
            ))}
          </div>
        )}
      </QueryState>
    </div>
  )
}

function EnrollmentCard({
  item,
  quest,
}: {
  item: QuestEnrollmentItem
  quest?: QuestCatalogEntry
}) {
  const ev = item.evaluation
  const title = quest?.title ?? item.enrollment.quest_key
  const stageCount = ev?.stages.length ?? quest?.stages.length ?? 0
  const stageIndex = ev?.current_stage_index ?? item.enrollment.current_stage
  const currentStage = ev ? ev.stages.find((s) => s.key === ev.current_stage_key) : undefined

  return (
    <div className="panel-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-cream-50 font-medium truncate">{title}</div>
          <div className="text-[11px] text-ghost">
            {quest?.category}
            {quest?.type === "collective" && " · collective"}
          </div>
        </div>
        {ev?.packet_available && (
          <button className="btn-ghost text-xs shrink-0">View packet</button>
        )}
      </div>

      {/* Stage rail */}
      {stageCount > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1.5">
            {(ev?.stages ?? quest?.stages ?? []).map((s, i) => {
              const open = ev ? ev.stages[i]?.open : i < stageIndex
              return (
                <div key={s.key} className="flex-1">
                  <div
                    className={classNames(
                      "h-1.5 rounded-full",
                      open ? "bg-forest-500" : "bg-moss"
                    )}
                  />
                  <div
                    className={classNames(
                      "text-[10px] mt-1 truncate",
                      open ? "text-forest-300" : "text-ghost"
                    )}
                  >
                    {s.label}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="text-xs text-mist mt-1.5">
            Stage {Math.min(stageIndex, stageCount)}/{stageCount}
            {ev?.final_gate_open && <span className="text-forest-300"> — final gate open</span>}
          </div>
        </div>
      )}

      {/* What's still missing for the next gate */}
      {currentStage && currentStage.missing.length > 0 && (
        <div className="mt-2 text-xs text-amber-300">
          Missing: {currentStage.missing.join(" · ")}
        </div>
      )}

      {/* Requirement statuses */}
      {ev && (
        <div className="mt-3 grid sm:grid-cols-2 gap-x-4 gap-y-1">
          {ev.requirements.map((r) => (
            <div key={r.key} className="flex items-center gap-1.5 text-xs">
              <span aria-hidden>{TAG_META[r.tag].icon}</span>
              <span className="text-mist truncate" title={r.note}>
                {r.label}
              </span>
              <span className={classNames("ml-auto shrink-0", STATUS_STYLE[r.status])}>
                {r.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {quest && <p className="text-[11px] text-ghost mt-3">{quest.disclaimer}</p>}
    </div>
  )
}

function CatalogCard({ quest }: { quest: QuestCatalogEntry }) {
  return (
    <div className="panel-pad flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-cream-50 font-medium">{quest.title}</div>
          <div className="text-[11px] text-ghost">
            {quest.category}
            {quest.type === "collective" && " · collective"}
          </div>
        </div>
        <span className="text-lg shrink-0" aria-hidden>
          🏆
        </span>
      </div>

      <p className="text-xs text-mist mt-2">{quest.outcome}</p>

      <div className="mt-3 space-y-1">
        {quest.requirements.map((r) => (
          <div key={r.key} className="flex items-center gap-1.5 text-xs">
            <span aria-hidden title={TAG_META[r.tag].label}>
              {TAG_META[r.tag].icon}
            </span>
            <span className="text-mist truncate" title={r.note}>
              {r.label}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-2 text-[11px] text-ghost">
        {quest.stages.length} stages · gatekeeper: {quest.gatekeeper}
        {quest.has_packet && " · evidence packet"}
      </div>

      <p className="text-[11px] text-ghost mt-2">{quest.disclaimer}</p>

      <div className="mt-3 pt-3 border-t border-moss/50">
        {/* POST /vendor/quests/enrollments { quest_key } — wired with the enroll flow */}
        <button className="btn-primary text-xs" disabled>
          Opt in
        </button>
      </div>
    </div>
  )
}

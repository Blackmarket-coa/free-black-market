import { useMemo, useState } from "react"
import {
  useQuestCatalog,
  useQuestEnrollments,
  useEnrollQuest,
  useDropQuest,
} from "@/hooks/useQuests"
import { usePayouts } from "@/hooks/usePayouts"
import { PageHeader } from "@bmc/ui"
import { Tabs } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { EmptyState } from "@bmc/ui"
import { KarmaBar } from "@bmc/ui"
import { TierBadge } from "@bmc/ui"
import type {
  QuestCatalogEntry,
  QuestEnrollmentItem,
  QuestRequirementTag,
  QuestRequirementStatus,
} from "@/types"
import { classNames } from "@bmc/portal-kit"

// Requirement-tag legend (mirrors the backend catalog legend).
const TAG_META: Record<QuestRequirementTag, { icon: string; label: string }> = {
  platform: { icon: "🟢", label: "FBM generates it from real records" },
  assisted: { icon: "🟡", label: "FBM drafts it; you review" },
  "vendor-supplied": { icon: "⚪", label: "You upload it" },
  "outside-fbm": { icon: "❌", label: "Handled outside FBM" },
}

const REQ_STATUS: Record<QuestRequirementStatus, { mark: string; className: string }> = {
  satisfied: { mark: "✓", className: "text-forest-300" },
  unsatisfied: { mark: "•", className: "text-amber-300" },
  unavailable: { mark: "—", className: "text-ghost" },
  checklist: { mark: "☐", className: "text-mist" },
}

function EnrollmentCard({
  item,
  quest,
  onDrop,
  dropping,
}: {
  item: QuestEnrollmentItem
  quest?: QuestCatalogEntry
  onDrop: (id: string) => void
  dropping: boolean
}) {
  const { enrollment, evaluation } = item
  const stages = evaluation?.stages ?? quest?.stages ?? []
  const stageCount = stages.length
  const complete = enrollment.status === "COMPLETE"
  const reached = complete
    ? stageCount
    : evaluation?.current_stage_index ?? enrollment.current_stage
  const nextStage = evaluation?.stages.find((s) => !s.open)

  return (
    <div className="panel-pad">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-cream-100">
            {quest?.title ?? enrollment.quest_key}
          </div>
          {quest && <div className="text-xs text-mist mt-0.5">{quest.outcome}</div>}
        </div>
        {complete ? (
          <span className="text-xs text-forest-400 shrink-0">Complete ✓</span>
        ) : (
          <span className="text-xs text-amber-300 shrink-0">
            Stage {reached}/{stageCount || "?"}
          </span>
        )}
      </div>

      {/* Stage progress segments */}
      {stageCount > 0 && (
        <div className="mt-3">
          <div className="flex gap-1">
            {stages.map((s, i) => (
              <div
                key={s.key}
                title={s.label}
                className={classNames(
                  "h-1.5 flex-1 rounded-full",
                  i < reached ? "bg-forest-500" : "bg-moss"
                )}
              />
            ))}
          </div>
          <div className="flex justify-between text-[11px] text-ghost mt-1">
            {stages.map((s, i) => (
              <span key={s.key} className={i < reached ? "text-forest-300" : undefined}>
                {s.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* What's missing to open the next gate */}
      {!complete && nextStage && nextStage.missing.length > 0 && (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-ghost mb-1">
            To reach {nextStage.label}
          </div>
          <ul className="space-y-0.5">
            {nextStage.missing.map((m) => (
              <li key={m} className="text-xs text-mist">
                • {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Live requirement checklist */}
      {evaluation && (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-ghost mb-1">
            Requirements
          </div>
          <ul className="space-y-0.5">
            {evaluation.requirements.map((r) => (
              <li key={r.key} className="flex items-center gap-2 text-xs">
                <span className={classNames("w-3 shrink-0", REQ_STATUS[r.status].className)}>
                  {REQ_STATUS[r.status].mark}
                </span>
                <span aria-hidden>{TAG_META[r.tag].icon}</span>
                <span className="text-mist">{r.label}</span>
                {r.note && <span className="text-ghost truncate">— {r.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {quest && (
        <p className="text-[11px] text-ghost mt-3 leading-snug">{quest.disclaimer}</p>
      )}

      {enrollment.status === "ACTIVE" && (
        <div className="flex justify-end mt-2">
          <button
            className="btn-ghost text-xs"
            disabled={dropping}
            onClick={() => onDrop(enrollment.id)}
          >
            Drop quest
          </button>
        </div>
      )}
    </div>
  )
}

export function QuestsPage() {
  const catalog = useQuestCatalog()
  const enrollments = useQuestEnrollments()
  const { data: payouts } = usePayouts()
  const enroll = useEnrollQuest()
  const drop = useDropQuest()
  const [tab, setTab] = useState("mine")

  const questByKey = useMemo(
    () => new Map((catalog.data?.quests ?? []).map((q) => [q.key, q])),
    [catalog.data]
  )

  // Dropped quests leave the board; the backend keeps the row for the record.
  const mine = useMemo(
    () =>
      (enrollments.data?.enrollments ?? []).filter(
        (e) => e.enrollment.status !== "DROPPED"
      ),
    [enrollments.data]
  )

  const enrolledKeys = useMemo(
    () => new Set(mine.map((e) => e.enrollment.quest_key)),
    [mine]
  )

  const byCategory = useMemo(() => {
    const groups = new Map<string, QuestCatalogEntry[]>()
    for (const q of catalog.data?.quests ?? []) {
      const list = groups.get(q.category) ?? []
      list.push(q)
      groups.set(q.category, list)
    }
    return Array.from(groups.entries())
  }, [catalog.data])

  return (
    <div>
      <PageHeader
        title="Quests"
        subtitle="Opt-in progressions built from your real operating record — never auto-enrolled"
      />

      {/* Tier & KARMA (shares the payouts hook — same source as /payouts) */}
      {payouts && (
        <section className="panel-pad mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="heading text-base">Tier & KARMA</h2>
            <TierBadge tier={payouts.tier} size="lg" />
          </div>
          <KarmaBar tier={payouts.tier} karma={payouts.karma_total} />
          <div className="mt-3">
            <div className="text-xs uppercase tracking-wide text-ghost mb-1">
              Recent KARMA
            </div>
            <ul className="space-y-0.5">
              {payouts.karma_events.slice(0, 3).map((e) => (
                <li key={e.id} className="flex items-center justify-between text-xs">
                  <span className="text-mist">{e.description}</span>
                  <span className="text-forest-300 shrink-0 ml-2">+{e.karma}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "mine", label: "My quests", count: mine.length },
          { key: "catalog", label: "Catalog", count: catalog.data?.count },
        ]}
      />

      <QueryState
        isLoading={catalog.isLoading || enrollments.isLoading}
        isError={catalog.isError || enrollments.isError}
      >
        {tab === "mine" &&
          (mine.length === 0 ? (
            <EmptyState
              icon="🏆"
              title="No quests yet"
              message="Browse the catalog and opt into a quest — FBM assembles the paperwork from records you already have."
              cta={
                <button className="btn-primary text-sm" onClick={() => setTab("catalog")}>
                  Browse the catalog
                </button>
              }
            />
          ) : (
            <div className="grid lg:grid-cols-2 gap-3">
              {mine.map((item) => (
                <EnrollmentCard
                  key={item.enrollment.id}
                  item={item}
                  quest={questByKey.get(item.enrollment.quest_key)}
                  onDrop={(id) => drop.mutate(id)}
                  dropping={drop.isPending}
                />
              ))}
            </div>
          ))}

        {tab === "catalog" && (
          <div className="space-y-6">
            {/* Tag legend */}
            <div className="panel-pad flex flex-wrap gap-x-4 gap-y-1">
              {(Object.keys(TAG_META) as QuestRequirementTag[]).map((tag) => (
                <span key={tag} className="text-[11px] text-mist">
                  <span aria-hidden>{TAG_META[tag].icon}</span> {TAG_META[tag].label}
                </span>
              ))}
            </div>

            {byCategory.map(([category, quests]) => (
              <section key={category}>
                <h2 className="heading text-base mb-2">{category}</h2>
                <div className="grid lg:grid-cols-2 gap-3">
                  {quests.map((q) => {
                    const enrolled = enrolledKeys.has(q.key)
                    return (
                      <div key={q.key} className="panel-pad flex flex-col">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-cream-100">{q.title}</span>
                          {q.type === "collective" && (
                            <span className="text-[11px] text-amber-300 shrink-0">
                              Collective
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-mist mt-0.5">{q.outcome}</div>
                        <div className="text-xs text-ghost mt-1">
                          Gatekeeper: {q.gatekeeper}
                        </div>

                        <div className="text-xs text-mist mt-2">
                          {q.stages.map((s) => s.label).join(" → ")}
                        </div>

                        <ul className="mt-2 space-y-0.5">
                          {q.requirements.map((r) => (
                            <li key={r.key} className="text-xs text-mist">
                              <span aria-hidden>{TAG_META[r.tag].icon}</span> {r.label}
                              {r.note && (
                                <span className="text-ghost"> — {r.note}</span>
                              )}
                            </li>
                          ))}
                        </ul>

                        <p className="text-[11px] text-ghost mt-2 leading-snug">
                          {q.disclaimer}
                        </p>

                        <div className="flex justify-end mt-auto pt-3">
                          {enrolled ? (
                            <span className="text-xs text-forest-300">Enrolled ✓</span>
                          ) : (
                            <button
                              className="btn-primary text-xs"
                              disabled={enroll.isPending}
                              onClick={() => enroll.mutate(q.key)}
                            >
                              Enroll
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  )
}

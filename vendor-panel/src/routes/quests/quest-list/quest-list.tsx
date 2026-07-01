import { Link } from "react-router-dom"
import {
  Container,
  Heading,
  Text,
  Button,
  Badge,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { ArrowRight } from "@medusajs/icons"
import {
  useQuestCatalog,
  useQuestEnrollments,
  useEnrollQuest,
  useDropQuest,
  type QuestCatalogEntry,
  type EnrollmentWithEvaluation,
} from "../../../hooks/api/quests"
import { RequirementTagBadge } from "../components/requirement-badge"

const QuestListPage = () => {
  const { data: catalogData, isLoading: catalogLoading } = useQuestCatalog()
  const { data: enrollData, isLoading: enrollLoading } = useQuestEnrollments()
  const enroll = useEnrollQuest()
  const drop = useDropQuest()
  const prompt = usePrompt()

  const catalog = catalogData?.quests ?? []
  const enrollments = enrollData?.enrollments ?? []
  const activeByKey = new Map(
    enrollments
      .filter((e) => e.enrollment.status === "ACTIVE")
      .map((e) => [e.enrollment.quest_key, e])
  )

  const handleEnroll = async (quest: QuestCatalogEntry) => {
    try {
      await enroll.mutateAsync(quest.key)
      toast.success(`Enrolled in ${quest.title}`)
    } catch {
      toast.error("Could not enroll")
    }
  }

  const handleDrop = async (e: EnrollmentWithEvaluation, title: string) => {
    const confirmed = await prompt({
      title: "Drop quest",
      description: `Drop "${title}"? Your underlying records (revenue, documents, production, inventory) are kept — only the quest tracking stops.`,
      confirmText: "Drop quest",
      cancelText: "Keep",
    })
    if (!confirmed) return
    try {
      await drop.mutateAsync(e.enrollment.id)
      toast.success("Quest dropped. Your records were kept.")
    } catch {
      toast.error("Could not drop quest")
    }
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container>
        <div className="mb-2">
          <Heading level="h1">Quests</Heading>
          <Text className="text-ui-fg-subtle">
            Turn your real operating history into leverage toward a loan, grant,
            wholesale account, or certification. Quests are optional — enroll in
            what you want, drop anytime without losing your records.
          </Text>
        </div>
      </Container>

      {/* Active quests */}
      <Container>
        <Heading level="h2" className="mb-2">
          Your quests
        </Heading>
        {enrollLoading ? (
          <Text className="text-ui-fg-subtle">Loading…</Text>
        ) : activeByKey.size === 0 ? (
          <Text className="text-ui-fg-subtle">
            No active quests. Browse the catalog below to start one.
          </Text>
        ) : (
          <div className="flex flex-col gap-y-2">
            {[...activeByKey.values()].map((e) => {
              const def = catalog.find((c) => c.key === e.enrollment.quest_key)
              const evalv = e.evaluation
              const stageCount = def?.stages.length ?? 0
              return (
                <div
                  key={e.enrollment.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Text weight="plus">{def?.title ?? e.enrollment.quest_key}</Text>
                      {e.enrollment.status === "COMPLETE" ? (
                        <Badge size="2xsmall" color="green">
                          Complete
                        </Badge>
                      ) : null}
                      {evalv?.packet_available ? (
                        <Badge size="2xsmall" color="blue">
                          Packet ready
                        </Badge>
                      ) : null}
                    </div>
                    <Text size="small" className="text-ui-fg-subtle">
                      Stage {evalv?.current_stage_index ?? e.enrollment.current_stage} of {stageCount}
                      {def ? ` · Gatekeeper: ${def.gatekeeper}` : ""}
                    </Text>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="small" variant="secondary" asChild>
                      <Link to={`/quests/${e.enrollment.id}`}>
                        Open <ArrowRight />
                      </Link>
                    </Button>
                    <Button
                      size="small"
                      variant="transparent"
                      onClick={() => handleDrop(e, def?.title ?? e.enrollment.quest_key)}
                    >
                      Drop
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Container>

      {/* Catalog */}
      <Container>
        <Heading level="h2" className="mb-2">
          Available quests
        </Heading>
        {catalogLoading ? (
          <Text className="text-ui-fg-subtle">Loading catalog…</Text>
        ) : (
          <div className="flex flex-col gap-y-3">
            {catalog.map((quest) => {
              const enrolled = activeByKey.has(quest.key)
              return (
                <div key={quest.key} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Text weight="plus">{quest.title}</Text>
                        <Badge size="2xsmall" color="grey">
                          {quest.category}
                        </Badge>
                        {quest.type === "collective" ? (
                          <Badge size="2xsmall" color="purple">
                            Collective
                          </Badge>
                        ) : null}
                      </div>
                      <Text size="small" className="text-ui-fg-subtle">
                        {quest.outcome}
                      </Text>
                      <Text size="small" className="text-ui-fg-muted mt-1">
                        Gatekeeper: {quest.gatekeeper} · {quest.stages.length} stages
                      </Text>
                      {/* What it needs, tagged — visible BEFORE committing. */}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {quest.requirements.map((r) => (
                          <span key={r.key} className="inline-flex items-center gap-1">
                            <RequirementTagBadge tag={r.tag} />
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      {enrolled ? (
                        <Badge color="green">Enrolled</Badge>
                      ) : (
                        <Button
                          size="small"
                          onClick={() => handleEnroll(quest)}
                          isLoading={enroll.isPending}
                        >
                          Enroll
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Container>
    </div>
  )
}

export default QuestListPage

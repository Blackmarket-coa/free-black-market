import { useParams } from "react-router-dom"
import {
  Container,
  Heading,
  Text,
  Button,
  Badge,
  toast,
} from "@medusajs/ui"
import { ArrowDownTray } from "@medusajs/icons"
import {
  useQuestEnrollment,
  useQuestCatalog,
  useGeneratePacket,
} from "../../../hooks/api/quests"
import { StageProgress } from "../components/stage-progress"
import {
  RequirementTagBadge,
  RequirementStatusBadge,
} from "../components/requirement-badge"
import { QuestDisclaimer } from "../components/quest-disclaimer"

const QuestDetailPage = () => {
  const { id = "" } = useParams()
  const { data, isLoading } = useQuestEnrollment(id)
  const { data: catalogData } = useQuestCatalog()
  const generate = useGeneratePacket()

  if (isLoading || !data) {
    return (
      <Container>
        <Text className="text-ui-fg-subtle">Loading…</Text>
      </Container>
    )
  }

  const { enrollment, evaluation } = data
  const def = catalogData?.quests.find((c) => c.key === enrollment.quest_key)

  const handleGenerate = async () => {
    try {
      const res = await generate.mutateAsync(enrollment.id)
      // Open the rendered HTML packet in a new tab for print-to-PDF / save.
      const win = window.open("", "_blank")
      if (win) {
        win.document.write(res.html)
        win.document.close()
      } else {
        toast.error("Allow pop-ups to open the packet")
      }
      toast.success("Packet generated")
    } catch (e: any) {
      toast.error(e?.message ?? "Packet is only available once the final stage is open")
    }
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container>
        <div className="flex items-start justify-between">
          <div>
            <Heading level="h1">{def?.title ?? enrollment.quest_key}</Heading>
            <Text className="text-ui-fg-subtle">{def?.outcome}</Text>
          </div>
          <Badge color={enrollment.status === "COMPLETE" ? "green" : "orange"}>
            {enrollment.status}
          </Badge>
        </div>
        {def ? (
          <div className="mt-3">
            <QuestDisclaimer
              disclaimer={def.disclaimer}
              guardrail={def.health_claims_guardrail}
            />
          </div>
        ) : null}
      </Container>

      {/* Stage progression */}
      <Container>
        <Heading level="h2" className="mb-3">
          Progress
        </Heading>
        {evaluation ? (
          <StageProgress
            stages={evaluation.stages}
            currentIndex={evaluation.current_stage_index}
          />
        ) : (
          <Text className="text-ui-fg-subtle">
            This quest is no longer active.
          </Text>
        )}
      </Container>

      {/* Requirements */}
      {evaluation ? (
        <Container>
          <Heading level="h2" className="mb-3">
            Requirements
          </Heading>
          <div className="flex flex-col gap-y-2">
            {evaluation.requirements.map((r) => (
              <div
                key={r.key}
                className="flex items-center justify-between gap-2 border-b pb-2 last:border-b-0"
              >
                <div>
                  <Text size="small" weight="plus">
                    {r.label}
                  </Text>
                  {r.note ? (
                    <Text size="small" className="text-ui-fg-subtle">
                      {r.note}
                    </Text>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <RequirementTagBadge tag={r.tag} />
                  <RequirementStatusBadge status={r.status} />
                </div>
              </div>
            ))}
          </div>
        </Container>
      ) : null}

      {/* Packet export */}
      {def?.has_packet ? (
        <Container>
          <div className="flex items-center justify-between">
            <div>
              <Heading level="h2">Export packet</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Available once the final stage gate is open. FBM assembles it from
                your records; you complete the remaining items and submit to the
                gatekeeper.
              </Text>
            </div>
            <Button
              onClick={handleGenerate}
              isLoading={generate.isPending}
              disabled={!evaluation?.packet_available}
            >
              <ArrowDownTray /> Generate packet
            </Button>
          </div>
        </Container>
      ) : null}
    </div>
  )
}

export default QuestDetailPage

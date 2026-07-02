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
  useCollective,
  useQuestCatalog,
  useConsentCollective,
  useRevokeConsent,
  useGenerateCollectivePacket,
} from "../../../hooks/api/quests"
import { StageProgress } from "../components/stage-progress"
import { QuestDisclaimer } from "../components/quest-disclaimer"

const CollectiveDetailPage = () => {
  const { id = "" } = useParams()
  const { data, isLoading } = useCollective(id)
  const { data: catalogData } = useQuestCatalog()
  const consent = useConsentCollective(id)
  const revoke = useRevokeConsent(id)
  const generate = useGenerateCollectivePacket(id)

  if (isLoading || !data) {
    return (
      <Container>
        <Text className="text-ui-fg-subtle">Loading…</Text>
      </Container>
    )
  }

  const { collective, is_owner, member_count, consented_member_ids, required_scopes, evaluation } = data
  const def = catalogData?.quests.find((c) => c.key === collective.quest_key)

  const handleConsent = async () => {
    try {
      await consent.mutateAsync(required_scopes)
      toast.success("Consent recorded — your record can now be aggregated")
    } catch {
      toast.error("Could not record consent (join the collective first)")
    }
  }

  const handleRevoke = async () => {
    try {
      await revoke.mutateAsync()
      toast.success("Consent revoked. Your records are untouched.")
    } catch {
      toast.error("Could not revoke consent")
    }
  }

  const handlePacket = async () => {
    try {
      const res = await generate.mutateAsync()
      const win = window.open("", "_blank")
      if (win) {
        win.document.write(res.html)
        win.document.close()
      }
      toast.success("Joint packet generated")
    } catch (e: any) {
      toast.error(e?.message ?? "Packet not available yet")
    }
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container>
        <div className="flex items-start justify-between">
          <div>
            <Heading level="h1">{collective.title}</Heading>
            <Text className="text-ui-fg-subtle">{def?.title ?? collective.quest_key}</Text>
          </div>
          <Badge color="grey">{collective.status}</Badge>
        </div>
        {def ? (
          <div className="mt-3">
            <QuestDisclaimer disclaimer={def.disclaimer} guardrail={def.health_claims_guardrail} />
          </div>
        ) : null}
        <div className="mt-3 flex gap-4">
          <Text size="small" className="text-ui-fg-subtle">
            Members: <span className="text-ui-fg-base">{member_count}</span>
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            Consenting: <span className="text-ui-fg-base">{consented_member_ids.length}</span>
          </Text>
        </div>
      </Container>

      {/* Consent — a member grants scoped consent for aggregation. */}
      <Container>
        <Heading level="h2" className="mb-1">
          Your consent
        </Heading>
        <Text size="small" className="text-ui-fg-subtle mb-3">
          Aggregation includes your record only while you consent to these scopes:{" "}
          {required_scopes.join(", ") || "—"}. Revoking keeps all your records and
          simply removes you from the combined evaluation.
        </Text>
        <div className="flex gap-2">
          <Button size="small" onClick={handleConsent} isLoading={consent.isPending}>
            Consent to aggregate
          </Button>
          <Button size="small" variant="secondary" onClick={handleRevoke} isLoading={revoke.isPending}>
            Revoke consent
          </Button>
        </div>
      </Container>

      {/* Combined progress over consenting members only. */}
      <Container>
        <Heading level="h2" className="mb-3">
          Combined progress
        </Heading>
        {evaluation ? (
          <StageProgress stages={evaluation.stages} currentIndex={evaluation.current_stage_index} />
        ) : (
          <Text className="text-ui-fg-subtle">
            No consenting members yet — nothing to combine.
          </Text>
        )}
      </Container>

      {/* Joint packet (owner only). */}
      {is_owner && def?.has_packet ? (
        <Container>
          <div className="flex items-center justify-between">
            <div>
              <Heading level="h2">Joint packet</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Assembled from consenting members once the final stage opens.
              </Text>
            </div>
            <Button
              onClick={handlePacket}
              isLoading={generate.isPending}
              disabled={!evaluation?.packet_available}
            >
              <ArrowDownTray /> Generate joint packet
            </Button>
          </div>
        </Container>
      ) : null}
    </div>
  )
}

export default CollectiveDetailPage

import { MedusaService } from "@medusajs/framework/utils"
import {
  QuestEnrollment,
  QuestStageEvent,
  QuestPacket,
  QuestCollective,
  QuestMemberConsent,
} from "./models"
import { EnrollmentStatus } from "./models/quest-enrollment"
import { CollectiveStatus } from "./models/quest-collective"
import { getQuestDefinition, listQuestDefinitions } from "./definitions"
import { evaluateQuest } from "./engine"
import { buildPacketExport, renderPacketHtml, type PacketExport } from "./packet"
import type { QuestDefinition, QuestEvaluation, VendorSubstrate } from "./types"

/** XP granted per newly-passed stage gate (best-effort, via injected callback). */
const STAGE_XP = 50

type AwardXp = (sellerId: string, amount: number, meta: Record<string, unknown>) => Promise<void>

/**
 * Vendor Quest engine service.
 *
 * Owns only the new facts (enrollments, stage events, packets, collectives,
 * consent). Evaluation and packet assembly are pure functions of
 * `(definition, substrate)` — the substrate itself is built by the caller
 * (`substrate/build.ts`) and passed in, so this service never reaches across
 * modules and stays unit-testable. XP is awarded through an injected callback
 * (like `collective-quest`), keeping the module decoupled from `progression`.
 */
class VendorQuestModuleService extends MedusaService({
  QuestEnrollment,
  QuestStageEvent,
  QuestPacket,
  QuestCollective,
  QuestMemberConsent,
}) {
  // ── Catalog (pure config) ─────────────────────────────────────────────────

  /** Browsable catalog: what each quest is and what it needs, before opting in. */
  getCatalog() {
    return listQuestDefinitions().map((d) => this.toCatalogEntry(d))
  }

  private toCatalogEntry(d: QuestDefinition) {
    return {
      key: d.key,
      category: d.category,
      title: d.title,
      outcome: d.outcome,
      type: d.type,
      gatekeeper: d.gatekeeper.name,
      disclaimer: d.gatekeeper.disclaimer,
      health_claims_guardrail: !!d.healthClaimsGuardrail,
      uses_fields: d.usesFields,
      has_packet: !!d.packetTemplate,
      requirements: d.requirements.map((r) => ({
        key: r.key,
        label: r.label,
        tag: r.tag,
        needs: r.needs ?? [],
        note: r.note,
      })),
      stages: [...d.stageGates]
        .sort((a, b) => a.order - b.order)
        .map((g) => ({ key: g.key, label: g.label, order: g.order, description: g.description })),
    }
  }

  // ── Enrollment (opt-in / opt-out) ─────────────────────────────────────────

  async enroll(sellerId: string, questKey: string, collectiveId?: string) {
    const def = getQuestDefinition(questKey)
    if (!def) throw new Error(`Unknown quest '${questKey}'`)

    const existing = await this.listQuestEnrollments({
      seller_id: sellerId,
      quest_key: questKey,
      status: EnrollmentStatus.ACTIVE,
    })
    if (existing.length) return existing[0]

    return this.createQuestEnrollments({
      seller_id: sellerId,
      quest_key: questKey,
      status: EnrollmentStatus.ACTIVE,
      current_stage: 0,
      collective_id: collectiveId ?? null,
      enrolled_at: new Date(),
    })
  }

  /**
   * Drop a quest. Sets status = DROPPED and stamps dropped_at. NEVER deletes the
   * vendor's substrate records (documents, production batches, ledger, etc.) —
   * a hard constraint verified by a decoupling test.
   */
  async drop(enrollmentId: string) {
    await this.updateQuestEnrollments({
      id: enrollmentId,
      status: EnrollmentStatus.DROPPED,
      dropped_at: new Date(),
    })
    return this.retrieveQuestEnrollment(enrollmentId)
  }

  async listEnrollmentsForSeller(sellerId: string) {
    return this.listQuestEnrollments({ seller_id: sellerId })
  }

  // ── Evaluation & progression ──────────────────────────────────────────────

  /** Pure evaluation of an enrollment against a prebuilt substrate. */
  evaluate(questKey: string, substrate: VendorSubstrate): QuestEvaluation {
    const def = getQuestDefinition(questKey)
    if (!def) throw new Error(`Unknown quest '${questKey}'`)
    return evaluateQuest(def, substrate)
  }

  /**
   * Re-evaluate an enrollment against the live substrate and persist any stage
   * advance. Writes one append-only `quest_stage_event` per newly-passed gate,
   * updates `current_stage`, and (best-effort) awards XP via the callback. When
   * the final gate opens the enrollment is marked COMPLETE.
   */
  async syncProgress(
    enrollment: { id: string; seller_id: string; quest_key: string; current_stage: number },
    substrate: VendorSubstrate,
    opts?: { awardXp?: AwardXp }
  ): Promise<QuestEvaluation> {
    const evaluation = this.evaluate(enrollment.quest_key, substrate)
    const prev = Number(enrollment.current_stage ?? 0)
    const now = evaluation.current_stage_index

    if (now > prev) {
      for (let stage = prev + 1; stage <= now; stage++) {
        const stageInfo = evaluation.stages[stage - 1]
        await this.createQuestStageEvents({
          enrollment_id: enrollment.id,
          seller_id: enrollment.seller_id,
          quest_key: enrollment.quest_key,
          from_stage: stage - 1,
          to_stage: stage,
          stage_key: stageInfo?.key ?? null,
          evaluated_snapshot: { stage: stageInfo, at: substrate.generated_at },
          xp_awarded: STAGE_XP,
        })
        if (opts?.awardXp) {
          try {
            await opts.awardXp(enrollment.seller_id, STAGE_XP, {
              quest_key: enrollment.quest_key,
              stage_key: stageInfo?.key,
            })
          } catch {
            /* XP is best-effort; the stage event is the source of record */
          }
        }
      }

      const isComplete = evaluation.final_gate_open
      await this.updateQuestEnrollments({
        id: enrollment.id,
        current_stage: now,
        ...(isComplete
          ? { status: EnrollmentStatus.COMPLETE, completed_at: new Date() }
          : {}),
      })
    }

    return evaluation
  }

  // ── Packet generation ─────────────────────────────────────────────────────

  /**
   * Build and persist a packet for an enrollment. Only succeeds when the final
   * gate is open and the quest defines a packet. Returns the structured export
   * plus rendered HTML. Every packet carries the honest-UI disclaimer.
   */
  async generatePacket(
    enrollment: { id: string; seller_id: string; quest_key: string },
    substrate: VendorSubstrate
  ): Promise<{ export: PacketExport; html: string }> {
    const def = getQuestDefinition(enrollment.quest_key)
    if (!def) throw new Error(`Unknown quest '${enrollment.quest_key}'`)
    if (!def.packetTemplate) {
      throw new Error(`Quest '${enrollment.quest_key}' has no exportable packet`)
    }

    const evaluation = evaluateQuest(def, substrate)
    if (!evaluation.packet_available) {
      throw new Error("Packet is only available once the final stage gate is open")
    }

    const exportData = buildPacketExport(def, substrate)!
    const html = renderPacketHtml(exportData)

    await this.createQuestPackets({
      enrollment_id: enrollment.id,
      seller_id: enrollment.seller_id,
      quest_key: enrollment.quest_key,
      packet_key: exportData.packet_key,
      export_json: exportData as unknown as Record<string, unknown>,
      disclaimer: exportData.disclaimer,
      remaining_items: exportData.remaining_items as any,
      generated_at: new Date(),
    })

    return { export: exportData, html }
  }

  // ── Collective quests (Q11–Q13) ───────────────────────────────────────────

  async formCollective(questKey: string, ownerSellerId: string, title: string) {
    const def = getQuestDefinition(questKey)
    if (!def) throw new Error(`Unknown quest '${questKey}'`)
    if (def.type !== "collective") {
      throw new Error(`Quest '${questKey}' is not a collective quest`)
    }
    return this.createQuestCollectives({
      quest_key: questKey,
      owner_seller_id: ownerSellerId,
      title,
      status: CollectiveStatus.FORMING,
    })
  }

  /** Record explicit, scoped consent for a member to aggregate their substrate. */
  async recordConsent(collectiveId: string, sellerId: string, scopes: string[]) {
    return this.createQuestMemberConsents({
      collective_id: collectiveId,
      seller_id: sellerId,
      consent_scopes: scopes as any,
      consented_at: new Date(),
    })
  }

  async revokeConsent(consentId: string) {
    await this.updateQuestMemberConsents({ id: consentId, revoked_at: new Date() })
    return this.retrieveQuestMemberConsent(consentId)
  }

  /**
   * Seller ids in a collective that currently consent to a given scope. Only
   * un-revoked consents whose `consent_scopes` include the scope are returned —
   * aggregation must read no member outside this set (never leak one vendor's
   * records to another).
   */
  async getConsentedSellers(collectiveId: string, scope: string): Promise<string[]> {
    const consents = await this.listQuestMemberConsents({ collective_id: collectiveId })
    return consents
      .filter((c) => !c.revoked_at)
      .filter((c) => Array.isArray(c.consent_scopes) && (c.consent_scopes as string[]).includes(scope))
      .map((c) => c.seller_id as string)
  }
}

export default VendorQuestModuleService

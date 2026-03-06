import { MedusaService } from "@medusajs/framework/utils"
import {
  HypeProfile,
  HypeProfileStatus,
  HypeProfileType,
  OpsFundingBucket,
  OpsFundingBucketCode,
  OracleSigningKey,
  OracleSigningKeyStatus,
  OracleVerificationReceipt,
  PredictionMarket,
  PredictionMarketState,
  PredictionMode,
  PredictionPayoutEntry,
  PredictionPayoutStatus,
  PredictionPosition,
  PredictionPositionStatus,
  PredictionSettlement,
  PredictionSettlementStatus,
  PredictionStakeUnit,
  SafetyRiskLevel,
  UserPredictionSafety,
} from "./models"
import { PredictionPolicyService } from "./policy-service"

class VendorHypeOperationsPredictionService extends MedusaService({
  HypeProfile,
  OpsFundingBucket,
  PredictionMarket,
  PredictionPosition,
  PredictionSettlement,
  PredictionPayoutEntry,
  OracleVerificationReceipt,
  OracleSigningKey,
  UserPredictionSafety,
}) {
  private readonly policyService = new PredictionPolicyService()

  private readonly MARKET_STATE_TRANSITIONS: Record<PredictionMarketState, PredictionMarketState[]> = {
    [PredictionMarketState.DRAFT]: [PredictionMarketState.SCHEDULED, PredictionMarketState.VOIDED],
    [PredictionMarketState.SCHEDULED]: [PredictionMarketState.OPEN, PredictionMarketState.VOIDED],
    [PredictionMarketState.OPEN]: [PredictionMarketState.LOCKED, PredictionMarketState.VOIDED],
    [PredictionMarketState.LOCKED]: [PredictionMarketState.IN_REVIEW, PredictionMarketState.VOIDED],
    [PredictionMarketState.IN_REVIEW]: [PredictionMarketState.SETTLED, PredictionMarketState.VOIDED],
    [PredictionMarketState.SETTLED]: [],
    [PredictionMarketState.VOIDED]: [],
  }

  async createHypeProfile(input: {
    profile_type: HypeProfileType
    owner_id: string
    slug: string
    display_name: string
    mission: string
    story_markdown?: string
    trust_score?: number
    readiness_score?: number
    capital_need_amount?: number
    metadata?: Record<string, unknown>
  }) {
    const [profile] = await this.createHypeProfiles([{ ...input, status: HypeProfileStatus.DRAFT }])

    const defaultBuckets = [
      {
        profile_id: profile.id,
        code: OpsFundingBucketCode.OPS_CORE,
        name: "Operations Core",
        display_order: 10,
      },
      {
        profile_id: profile.id,
        code: OpsFundingBucketCode.PRODUCTION_INPUTS,
        name: "Production Inputs",
        display_order: 20,
      },
      { profile_id: profile.id, code: OpsFundingBucketCode.GROWTH, name: "Growth", display_order: 30 },
      { profile_id: profile.id, code: OpsFundingBucketCode.RESERVE, name: "Reserve", display_order: 40 },
    ]

    await this.createOpsFundingBuckets(defaultBuckets)

    return profile
  }

  async publishHypeProfile(id: string) {
    const [profile] = await this.listHypeProfiles({ id })
    if (!profile) {
      throw new Error(`Hype profile ${id} was not found`)
    }

    if (profile.status === HypeProfileStatus.ARCHIVED) {
      throw new Error("Archived hype profiles cannot be published")
    }

    await this.updateHypeProfiles({
      id,
      status: HypeProfileStatus.PUBLISHED,
      published_at: new Date(),
    })

    const [updated] = await this.listHypeProfiles({ id })
    return updated
  }

  async createPredictionMarket(input: {
    profile_id: string
    milestone_id?: string
    title: string
    description?: string
    mode?: PredictionMode
    jurisdiction_code: string
    policy_version?: string
    oracle_config_id: string
    starts_at: Date
    locks_at: Date
    settlement_deadline_at?: Date
    payout_cap_config?: Record<string, unknown>
    created_by: string
    metadata?: Record<string, unknown>
  }) {
    if (input.locks_at <= input.starts_at) {
      throw new Error("Prediction market locks_at must be later than starts_at")
    }

    const mode = input.mode || PredictionMode.NON_CASH
    const policyDecision = this.policyService.evaluateMode(mode, input.jurisdiction_code)
    if (!policyDecision.allowed) {
      throw new Error(policyDecision.reason || "Prediction mode blocked by policy")
    }

    const [market] = await this.createPredictionMarkets([
      {
        ...input,
        mode,
        policy_version: input.policy_version || policyDecision.policy_version,
        state: PredictionMarketState.DRAFT,
      },
    ])

    return market
  }

  async transitionPredictionMarketState(id: string, nextState: PredictionMarketState) {
    const [market] = await this.listPredictionMarkets({ id })

    if (!market) {
      throw new Error(`Prediction market ${id} was not found`)
    }

    const validTransitions = this.MARKET_STATE_TRANSITIONS[market.state as PredictionMarketState] || []

    if (!validTransitions.includes(nextState)) {
      throw new Error(
        `Invalid prediction market transition from ${market.state} to ${nextState}. Valid transitions: ${validTransitions.join(", ") || "none"}`
      )
    }

    await this.updatePredictionMarkets({ id, state: nextState })
    const [updated] = await this.listPredictionMarkets({ id })
    return updated
  }

  async ensureSupporterEligibility(supporterId: string) {
    const [safety] = await this.listUserPredictionSafeties({ supporter_id: supporterId })
    if (!safety) {
      const [created] = await this.createUserPredictionSafeties([
        {
          supporter_id: supporterId,
          daily_position_limit: 20,
          daily_positions_count: 0,
          risk_level: SafetyRiskLevel.LOW,
        },
      ])
      return created
    }

    const now = new Date()
    if (safety.self_excluded_until && now < safety.self_excluded_until) {
      throw new Error("self_exclusion_active")
    }
    if (safety.cooldown_until && now < safety.cooldown_until) {
      throw new Error("cooldown_active")
    }

    const today = now.toISOString().slice(0, 10)
    const currentCount = safety.daily_counter_date === today ? safety.daily_positions_count : 0
    if (currentCount >= safety.daily_position_limit) {
      throw new Error("daily_position_limit_reached")
    }

    return safety
  }

  async markSupporterParticipation(supporterId: string) {
    const [safety] = await this.listUserPredictionSafeties({ supporter_id: supporterId })
    const now = new Date()
    const today = now.toISOString().slice(0, 10)

    if (!safety) {
      await this.createUserPredictionSafeties([
        {
          supporter_id: supporterId,
          daily_position_limit: 20,
          daily_positions_count: 1,
          daily_counter_date: today,
          cooldown_until: new Date(Date.now() + 30_000),
          last_position_at: now,
          risk_level: SafetyRiskLevel.LOW,
        },
      ])
      return
    }

    const nextCount = (safety.daily_counter_date === today ? safety.daily_positions_count : 0) + 1
    await this.updateUserPredictionSafeties({
      id: safety.id,
      daily_positions_count: nextCount,
      daily_counter_date: today,
      cooldown_until: new Date(Date.now() + 30_000),
      last_position_at: now,
    })
  }

  async placePredictionPosition(input: {
    market_id: string
    supporter_id: string
    outcome_option_key: string
    stake_amount: number
    stake_unit?: PredictionStakeUnit
    max_payout_amount?: number
    idempotency_key: string
    metadata?: Record<string, unknown>
  }) {
    await this.ensureSupporterEligibility(input.supporter_id)

    const [market] = await this.listPredictionMarkets({ id: input.market_id })
    if (!market) {
      throw new Error(`Prediction market ${input.market_id} was not found`)
    }
    if (market.state !== PredictionMarketState.OPEN) {
      throw new Error("Positions can only be placed while a market is open")
    }

    const [existing] = await this.listPredictionPositions({
      market_id: input.market_id,
      supporter_id: input.supporter_id,
      idempotency_key: input.idempotency_key,
    })

    if (existing) {
      return existing
    }

    const existingBySupporter = await this.listPredictionPositions({
      market_id: input.market_id,
      supporter_id: input.supporter_id,
    })
    if (existingBySupporter.length >= 50) {
      throw new Error("position_limit_reached_for_market")
    }

    const [position] = await this.createPredictionPositions([
      {
        ...input,
        stake_unit: input.stake_unit || PredictionStakeUnit.POINTS,
        status: PredictionPositionStatus.OPEN,
      },
    ])

    await this.markSupporterParticipation(input.supporter_id)
    return position
  }

  async settlePredictionMarket(input: {
    market_id: string
    settlement_ref: string
    oracle_outcome_key: string
    oracle_evidence_uri: string
    executed_by?: "system" | "operator"
    execution_run_id: string
    dispute_window_ends_at?: Date
    metadata?: Record<string, unknown>
  }) {
    const [market] = await this.listPredictionMarkets({ id: input.market_id })
    if (!market) {
      throw new Error(`Prediction market ${input.market_id} was not found`)
    }
    if (market.state !== PredictionMarketState.IN_REVIEW) {
      throw new Error("Prediction markets can only be settled from IN_REVIEW state")
    }

    const [existingSettlement] = await this.listPredictionSettlements({ settlement_ref: input.settlement_ref })
    if (existingSettlement) {
      return existingSettlement
    }

    if (input.dispute_window_ends_at && new Date() < input.dispute_window_ends_at) {
      throw new Error("dispute_window_open_settlement_not_allowed")
    }

    const [settlement] = await this.createPredictionSettlements([
      {
        ...input,
        settled_at: new Date(),
        status: PredictionSettlementStatus.FINAL,
        executed_by: input.executed_by || "system",
      },
    ])

    const positions = await this.listPredictionPositions({ market_id: input.market_id })
    const payoutEntries = positions.map((position) => {
      const winner = position.outcome_option_key === input.oracle_outcome_key
      const defaultPayout = winner ? Number(position.stake_amount) * 2 : 0
      const cappedPayout = position.max_payout_amount
        ? Math.min(defaultPayout, Number(position.max_payout_amount))
        : defaultPayout
      const failed = winner && cappedPayout <= 0

      return {
        settlement_id: settlement.id,
        market_id: input.market_id,
        position_id: position.id,
        supporter_id: position.supporter_id,
        payout_amount: cappedPayout,
        payout_unit: position.stake_unit,
        payout_status: failed
          ? PredictionPayoutStatus.FAILED
          : winner
            ? PredictionPayoutStatus.CREDITED
            : PredictionPayoutStatus.COMPUTED,
        is_winner: winner,
        failure_reason: failed ? "payout_cap_or_balance_violation" : null,
        metadata: { oracle_outcome_key: input.oracle_outcome_key },
      }
    })

    if (payoutEntries.length) {
      await this.createPredictionPayoutEntries(payoutEntries as any)
    }

    for (const position of positions) {
      await this.updatePredictionPositions({
        id: position.id,
        status:
          position.outcome_option_key === input.oracle_outcome_key
            ? PredictionPositionStatus.WON
            : PredictionPositionStatus.LOST,
      })
    }

    await this.updatePredictionMarkets({ id: input.market_id, state: PredictionMarketState.SETTLED })
    return settlement
  }

  async reverseSettlement(input: {
    settlement_id: string
    market_id: string
    reason: string
    execution_run_id: string
    actor_id: string
  }) {
    const [settlement] = await this.listPredictionSettlements({ id: input.settlement_id, market_id: input.market_id })
    if (!settlement) {
      throw new Error("settlement_not_found")
    }
    if (settlement.status === PredictionSettlementStatus.REVERSED) {
      return settlement
    }

    await this.updatePredictionSettlements({
      id: settlement.id,
      status: PredictionSettlementStatus.REVERSED,
      metadata: {
        ...(settlement.metadata as Record<string, unknown> | undefined),
        reversal_reason: input.reason,
        reversed_by: input.actor_id,
        reversal_run_id: input.execution_run_id,
      },
    })

    const payouts = await this.listPredictionPayoutEntries({ settlement_id: settlement.id })
    for (const payout of payouts) {
      await this.updatePredictionPayoutEntries({ id: payout.id, payout_status: PredictionPayoutStatus.REVERSED })
      await this.updatePredictionPositions({ id: payout.position_id, status: PredictionPositionStatus.OPEN })
    }

    await this.updatePredictionMarkets({ id: input.market_id, state: PredictionMarketState.IN_REVIEW })

    const [updated] = await this.listPredictionSettlements({ id: settlement.id })
    return updated
  }

  async recordOracleVerificationReceipt(input: {
    market_id: string
    settlement_ref: string
    key_id: string
    algorithm: string
    nonce: string
    payload_hash: string
    signature: string
    signed_at: Date
    expires_at: Date
    signature_verified: boolean
    metadata?: Record<string, unknown>
  }) {
    const [signingKey] = await this.listOracleSigningKeys({ key_id: input.key_id })
    if (!signingKey || signingKey.status === OracleSigningKeyStatus.RETIRED) {
      throw new Error("oracle_key_not_active")
    }

    const [existingNonce] = await this.listOracleVerificationReceipts({ nonce: input.nonce })
    if (existingNonce) {
      throw new Error("oracle_replay_detected_nonce_already_used")
    }

    const [receipt] = await this.createOracleVerificationReceipts([input])
    return receipt
  }

  async upsertOracleSigningKey(input: {
    key_id: string
    algorithm?: string
    public_key_pem: string
    status?: OracleSigningKeyStatus
    valid_from?: Date
    valid_to?: Date
    rotation_note?: string
    metadata?: Record<string, unknown>
  }) {
    const [existing] = await this.listOracleSigningKeys({ key_id: input.key_id })
    if (existing) {
      await this.updateOracleSigningKeys({
        id: existing.id,
        algorithm: input.algorithm || existing.algorithm,
        public_key_pem: input.public_key_pem,
        status: input.status || existing.status,
        valid_from: input.valid_from || existing.valid_from,
        valid_to: input.valid_to,
        rotation_note: input.rotation_note,
        metadata: input.metadata,
      })
      const [updated] = await this.listOracleSigningKeys({ id: existing.id })
      return updated
    }

    const [created] = await this.createOracleSigningKeys([
      {
        key_id: input.key_id,
        algorithm: input.algorithm || "ed25519",
        public_key_pem: input.public_key_pem,
        status: input.status || OracleSigningKeyStatus.ACTIVE,
        valid_from: input.valid_from || new Date(),
        valid_to: input.valid_to,
        rotation_note: input.rotation_note,
        metadata: input.metadata,
      },
    ])

    return created
  }

  async rotateOracleSigningKey(input: {
    old_key_id: string
    new_key_id: string
    new_public_key_pem: string
    rotation_note: string
  }) {
    const [oldKey] = await this.listOracleSigningKeys({ key_id: input.old_key_id })
    if (!oldKey) {
      throw new Error("old_key_not_found")
    }

    await this.updateOracleSigningKeys({
      id: oldKey.id,
      status: OracleSigningKeyStatus.RETIRING,
      valid_to: new Date(),
      rotation_note: input.rotation_note,
    })

    return this.upsertOracleSigningKey({
      key_id: input.new_key_id,
      public_key_pem: input.new_public_key_pem,
      status: OracleSigningKeyStatus.ACTIVE,
      valid_from: new Date(),
      rotation_note: input.rotation_note,
    })
  }

  async upsertUserPredictionSafety(input: {
    supporter_id: string
    self_excluded_until?: Date | null
    cooldown_until?: Date | null
    daily_position_limit?: number
    risk_level?: SafetyRiskLevel
    metadata?: Record<string, unknown>
  }) {
    const [existing] = await this.listUserPredictionSafeties({ supporter_id: input.supporter_id })
    if (existing) {
      await this.updateUserPredictionSafeties({
        id: existing.id,
        self_excluded_until: input.self_excluded_until,
        cooldown_until: input.cooldown_until,
        daily_position_limit: input.daily_position_limit,
        risk_level: input.risk_level,
        metadata: input.metadata,
      })
      const [updated] = await this.listUserPredictionSafeties({ id: existing.id })
      return updated
    }

    const [created] = await this.createUserPredictionSafeties([
      {
        supporter_id: input.supporter_id,
        self_excluded_until: input.self_excluded_until,
        cooldown_until: input.cooldown_until,
        daily_position_limit: input.daily_position_limit || 20,
        daily_positions_count: 0,
        risk_level: input.risk_level || SafetyRiskLevel.LOW,
        metadata: input.metadata,
      },
    ])

    return created
  }

  async updateHypeProfile(id: string, updates: Record<string, unknown>) {
    await this.updateHypeProfiles({ id, ...updates })
    const [profile] = await this.listHypeProfiles({ id })
    return profile
  }

  async deleteHypeProfile(id: string) {
    await this.deleteHypeProfiles(id)
  }

  async listFundingBuckets(profileId: string) {
    return this.listOpsFundingBuckets({ profile_id: profileId })
  }

  async upsertFundingBucket(input: {
    id?: string
    profile_id: string
    code: OpsFundingBucketCode
    name: string
    description?: string
    is_active?: boolean
    display_order?: number
    metadata?: Record<string, unknown>
  }) {
    if (input.id) {
      await this.updateOpsFundingBuckets({
        id: input.id,
        profile_id: input.profile_id,
        code: input.code,
        name: input.name,
        description: input.description,
        is_active: input.is_active,
        display_order: input.display_order,
        metadata: input.metadata,
      })
      const [updated] = await this.listOpsFundingBuckets({ id: input.id })
      return updated
    }

    const [created] = await this.createOpsFundingBuckets([
      {
        profile_id: input.profile_id,
        code: input.code,
        name: input.name,
        description: input.description,
        is_active: input.is_active ?? true,
        display_order: input.display_order ?? 0,
        metadata: input.metadata,
      },
    ])

    return created
  }

  getPolicyDecision(mode: PredictionMode, jurisdictionCode: string) {
    return this.policyService.evaluateMode(mode, jurisdictionCode)
  }
}

export default VendorHypeOperationsPredictionService

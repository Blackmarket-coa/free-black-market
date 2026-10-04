import { createLogger } from "../../shared/logger"
import { featureFlagState } from "../../shared/feature-flags"
const log = createLogger("modules/hawala-ledger/service")
import { MedusaService, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { auditFinancialTransaction } from "./audit-logger"
import { assertRailInvariants } from "./posture-a-guard"
import {
  buildKarmaAttestation,
  isKarmaUniqueViolation,
  validateKarmaEventInput,
  type KarmaEventInput,
} from "./karma"
import { splitAdvanceRepayment } from "./advance-repayment-split"
import {
  assertCarrierSnapshot,
  CarrierRefusalError,
  countsTowardPool,
  isCarriedPool,
  isValidCarrierAmount,
  projectPoolCarrier,
  stripPoolCarrierFields,
  sumMajorUnits,
  type PoolCarrierSnapshot,
} from "./carrier"
import {
  designatedReturnKey,
  hasDesignatedBalance,
  isDesignatedReturnAccountType,
  isSystemEscrowAccount,
  stripPoolDesignationFields,
  summariseDesignatedPool,
  toCents,
  totalDesignatedPoolFunds,
  type DesignatedPoolFundsReport,
} from "./designated"
import {
  assertOrgAdvanceEligibility,
  assertOrgAdvanceRecipient,
  assertOrgAdvanceTerms,
  deriveOrgAdvancePosition,
  isOrgAdvance,
  OPEN_ADVANCE_STATUSES,
  OrgAdvanceRefusalError,
  requireReference,
  totalOwedMajorUnits,
} from "./org-advance"
import { splitConsignmentCents } from "../../lib/consignment"
import {
  reconcileRecords,
  deriveCandidateBounds,
  validateCriteria,
  type EntryCandidate,
  type ExternalRecordInput,
  type MatchingRuleInput,
} from "./external-reconciliation"
import {
  conditionMet,
  dollarsToCents,
  isMonitorField,
  monitorTransition,
  normalizeOperator,
} from "./monitor-evaluator"
import {
  LedgerAccount,
  LedgerEntry,
  SettlementBatch,
  InvestmentPool,
  Investment,
  BankAccount,
  AchTransaction,
  VendorAdvance,
  AdvanceRepayment,
  PayoutConfig,
  PayoutSplitRule,
  PayoutRequest,
  ChargebackProtection,
  ChargebackClaim,
  VendorPayment,
  VendorCreditLine,
  CreditLineTransaction,
  EscrowAgreement,
  PatronageAllocation,
  KarmaEvent,
  ExternalRecord,
  MatchingRule,
  ReconciliationRun,
  ReconciliationMatch,
  IngestCursor,
  BalanceMonitor,
  MonitorBreach,
  PoolCarrierDistribution,
} from "./models"

class HawalaLedgerModuleService extends MedusaService({
  LedgerAccount,
  LedgerEntry,
  SettlementBatch,
  InvestmentPool,
  Investment,
  BankAccount,
  AchTransaction,
  VendorAdvance,
  AdvanceRepayment,
  PayoutConfig,
  PayoutSplitRule,
  PayoutRequest,
  ChargebackProtection,
  ChargebackClaim,
  VendorPayment,
  VendorCreditLine,
  CreditLineTransaction,
  EscrowAgreement,
  PatronageAllocation,
  KarmaEvent,
  ExternalRecord,
  MatchingRule,
  ReconciliationRun,
  ReconciliationMatch,
  IngestCursor,
  BalanceMonitor,
  MonitorBreach,
  PoolCarrierDistribution,
}) {
  // ==================== ACCOUNT MANAGEMENT ====================

  /**
   * Create a new ledger account with unique account number
   */
  async createAccount(data: {
    account_type: string
    currency_code?: string
    owner_type?: string
    owner_id?: string
    stellar_address?: string
    metadata?: Record<string, any>
  }) {
    const accountNumber = this.generateAccountNumber(data.account_type)
    
    return this.createLedgerAccounts({
      account_number: accountNumber,
      account_type: data.account_type as any,
      currency_code: data.currency_code || "USD",
      owner_type: data.owner_type as any,
      owner_id: data.owner_id,
      stellar_address: data.stellar_address,
      balance: 0,
      pending_balance: 0,
      available_balance: 0,
      status: "ACTIVE" as const,
      metadata: data.metadata,
    })
  }

  /**
   * Generate unique account number
   */
  private generateAccountNumber(accountType: string): string {
    const prefix = {
      USER_WALLET: "USR",
      PRODUCER_POOL: "PRD",
      SELLER_EARNINGS: "SLR",
      PLATFORM_FEE: "PLT",
      SETTLEMENT: "STL",
      RESERVE: "RSV",
      ESCROW: "ESC",
      CREATOR_EARNINGS: "CRE",
      CREATOR_REWARD_POOL: "CRP",
    }[accountType] || "GEN"
    
    const timestamp = Date.now().toString(36).toUpperCase()
    const random = Math.random().toString(36).substring(2, 6).toUpperCase()
    
    return `${prefix}-${timestamp}-${random}`
  }

  /**
   * Get or create system accounts (platform fee, reserve, settlement)
   */
  async getOrCreateSystemAccount(accountType: string) {
    // Must pin owner_id: "system" — per-subject escrows (subcontract, campaign)
    // are also account_type ESCROW + owner_type SYSTEM but carry a subject id
    // as owner_id. Without this filter the singleton lookup could return one of
    // those and misroute an order payment/refund out of the wrong escrow.
    const existing = await this.listLedgerAccounts({
      account_type: accountType,
      owner_type: "SYSTEM",
      owner_id: "system",
    })

    if (existing.length > 0) {
      return existing[0]
    }

    return this.createAccount({
      account_type: accountType,
      owner_type: "SYSTEM",
      owner_id: "system",
    })
  }

  /**
   * Get or create a SELLER_EARNINGS account for a vendor.
   */
  async getOrCreateSellerEarnings(sellerId: string, currencyCode: string = "USD") {
    const existing = await this.listLedgerAccounts({
      account_type: "SELLER_EARNINGS",
      owner_type: "SELLER",
      owner_id: sellerId,
    })

    if (existing.length > 0) {
      return existing[0]
    }

    return this.createAccount({
      account_type: "SELLER_EARNINGS",
      owner_type: "SELLER",
      owner_id: sellerId,
      currency_code: currencyCode,
    })
  }

  /**
   * Get or create a CREATOR_EARNINGS account for a creator seller.
   * Used by the creator-monetization platform to credit affiliate commissions.
   */
  async getOrCreateCreatorEarnings(creatorSellerId: string, currencyCode: string = "USD") {
    const existing = await this.listLedgerAccounts({
      account_type: "CREATOR_EARNINGS",
      owner_type: "CREATOR",
      owner_id: creatorSellerId,
    })

    if (existing.length > 0) {
      return existing[0]
    }

    return this.createAccount({
      account_type: "CREATOR_EARNINGS",
      owner_type: "CREATOR",
      owner_id: creatorSellerId,
      currency_code: currencyCode,
    })
  }

  /**
   * Credit a creator's earnings account from a vendor's seller earnings.
   *
   * Hawala stores money in DOLLARS (decimal) while the creator-attribution
   * module operates in cents. Callers MUST pass `amountCents` as integer cents;
   * we divide by 100 to match the ledger's decimal convention (mirrors the
   * pattern in hawala-order-payment.ts).
   */
  async creditCreatorCommission(args: {
    vendorSellerId: string
    creatorSellerId: string
    amountCents: number
    orderId: string
    attributionId: string
    currencyCode?: string
    description?: string
  }) {
    if (args.amountCents <= 0) {
      throw new Error("creditCreatorCommission amountCents must be > 0")
    }

    const currency = args.currencyCode || "USD"
    const vendorAccount = await this.getOrCreateSellerEarnings(args.vendorSellerId, currency)
    const creatorAccount = await this.getOrCreateCreatorEarnings(args.creatorSellerId, currency)

    return this.createTransfer({
      debit_account_id: vendorAccount.id,
      credit_account_id: creatorAccount.id,
      amount: args.amountCents / 100,
      entry_type: "CREATOR_COMMISSION",
      reference_type: "CREATOR_ATTRIBUTION",
      reference_id: args.attributionId,
      order_id: args.orderId,
      idempotency_key: `creator-commission-${args.attributionId}`,
      description:
        args.description ||
        `Creator commission for order ${args.orderId} (attribution ${args.attributionId})`,
      metadata: {
        attribution_id: args.attributionId,
        creator_seller_id: args.creatorSellerId,
        vendor_seller_id: args.vendorSellerId,
      },
    })
  }

  /**
   * Get or create a CREATOR_REWARD_POOL account for a program (or
   * platform-funded global pool when programId is null). Used to escrow
   * funds for engagement-pool distributions.
   */
  async getOrCreateCreatorRewardPool(
    poolId: string,
    currencyCode: string = "USD"
  ) {
    const existing = await this.listLedgerAccounts({
      account_type: "CREATOR_REWARD_POOL",
      owner_type: "SYSTEM",
      owner_id: poolId,
    })
    if (existing.length > 0) return existing[0]
    return this.createAccount({
      account_type: "CREATOR_REWARD_POOL",
      owner_type: "SYSTEM",
      owner_id: poolId,
      currency_code: currencyCode,
    })
  }

  /**
   * Fund a creator reward pool from the funder's earnings (vendor) or the
   * platform reserve (when funderSellerId is null). Used when a vendor
   * opens a $X engagement pool for a program.
   *
   * AUTHZ: Funding from the platform RESERVE (funderSellerId null) moves
   * platform money with no counterparty paying in, so it must be
   * explicitly authorized via `allowPlatformFunding === true`. Route
   * callers MUST gate that flag behind admin authentication — never pass
   * it from unauthenticated/seller-facing handlers.
   */
  async fundCreatorRewardPool(args: {
    poolId: string
    funderSellerId: string | null
    amountCents: number
    currencyCode?: string
    idempotencyKey?: string
    allowPlatformFunding?: boolean
  }) {
    if (args.amountCents <= 0) {
      throw new Error("fundCreatorRewardPool amountCents must be > 0")
    }
    const currency = args.currencyCode || "USD"
    const poolAccount = await this.getOrCreateCreatorRewardPool(args.poolId, currency)
    let sourceAccount
    if (args.funderSellerId) {
      sourceAccount = await this.getOrCreateSellerEarnings(args.funderSellerId, currency)
    } else {
      // Platform-funded: require explicit, admin-gated authorization.
      if (args.allowPlatformFunding !== true) {
        throw new Error("Platform-funded reward pools require explicit authorization")
      }
      sourceAccount = await this.getOrCreateSystemAccount("RESERVE")
    }
    return this.createTransfer({
      debit_account_id: sourceAccount.id,
      credit_account_id: poolAccount.id,
      amount: args.amountCents / 100,
      entry_type: "TRANSFER",
      reference_type: "CREATOR_REWARD_POOL",
      reference_id: args.poolId,
      idempotency_key: args.idempotencyKey || `pool-fund-${args.poolId}`,
      description: `Fund creator reward pool ${args.poolId}`,
      metadata: {
        pool_id: args.poolId,
        funder_seller_id: args.funderSellerId,
      },
    })
  }

  /**
   * Credit a creator's earnings from a funded reward pool. Reverses the
   * usual commission flow direction: pool -> creator earnings.
   */
  async creditCreatorReward(args: {
    poolId: string
    creatorSellerId: string
    amountCents: number
    rewardPayoutId: string
    currencyCode?: string
    description?: string
  }) {
    if (args.amountCents <= 0) {
      throw new Error("creditCreatorReward amountCents must be > 0")
    }
    const currency = args.currencyCode || "USD"
    const poolAccount = await this.getOrCreateCreatorRewardPool(args.poolId, currency)
    const creatorAccount = await this.getOrCreateCreatorEarnings(
      args.creatorSellerId,
      currency
    )
    return this.createTransfer({
      debit_account_id: poolAccount.id,
      credit_account_id: creatorAccount.id,
      amount: args.amountCents / 100,
      entry_type: "CREATOR_REWARD",
      reference_type: "CREATOR_REWARD_POOL",
      reference_id: args.poolId,
      idempotency_key: `creator-reward-${args.rewardPayoutId}`,
      description:
        args.description ||
        `Creator reward payout ${args.rewardPayoutId} from pool ${args.poolId}`,
      metadata: {
        pool_id: args.poolId,
        reward_payout_id: args.rewardPayoutId,
        creator_seller_id: args.creatorSellerId,
      },
    })
  }

  /**
   * Open escrow for a service subcontract or contract: move funds from
   * the buyer-vendor's seller-earnings into a per-subcontract ESCROW
   * account. The funds stay there until release or refund.
   */
  async openSubcontractEscrow(args: {
    subcontractId: string
    parentSellerId: string
    amountCents: number
    currencyCode?: string
  }) {
    if (args.amountCents <= 0) {
      throw new Error("openSubcontractEscrow amountCents must be > 0")
    }
    const currency = args.currencyCode || "USD"
    const parentAccount = await this.getOrCreateSellerEarnings(
      args.parentSellerId,
      currency
    )
    // Use a dedicated escrow account scoped to the subcontract id.
    const existing = await this.listLedgerAccounts({
      account_type: "ESCROW",
      owner_type: "SYSTEM",
      owner_id: args.subcontractId,
    })
    const escrowAccount =
      existing[0] ??
      (await this.createAccount({
        account_type: "ESCROW",
        owner_type: "SYSTEM",
        owner_id: args.subcontractId,
        currency_code: currency,
      }))
    return this.createTransfer({
      debit_account_id: parentAccount.id,
      credit_account_id: escrowAccount.id,
      amount: args.amountCents / 100,
      entry_type: "TRANSFER",
      reference_type: "MANUAL",
      reference_id: args.subcontractId,
      idempotency_key: `subcontract-escrow-${args.subcontractId}`,
      description: `Escrow for subcontract ${args.subcontractId}`,
      metadata: {
        subcontract_id: args.subcontractId,
        parent_seller_id: args.parentSellerId,
      },
    })
  }

  /**
   * Release subcontract escrow to the service vendor's earnings on
   * verified delivery + acceptance.
   */
  async releaseSubcontractEscrow(args: {
    subcontractId: string
    serviceSellerId: string
    amountCents: number
    currencyCode?: string
  }) {
    if (args.amountCents <= 0) {
      throw new Error("releaseSubcontractEscrow amountCents must be > 0")
    }
    const currency = args.currencyCode || "USD"
    const escrows = await this.listLedgerAccounts({
      account_type: "ESCROW",
      owner_type: "SYSTEM",
      owner_id: args.subcontractId,
    })
    if (escrows.length === 0) {
      throw new Error(`No escrow account for subcontract ${args.subcontractId}`)
    }
    const serviceAccount = await this.getOrCreateSellerEarnings(
      args.serviceSellerId,
      currency
    )
    return this.createTransfer({
      debit_account_id: escrows[0].id,
      credit_account_id: serviceAccount.id,
      amount: args.amountCents / 100,
      entry_type: "TRANSFER",
      reference_type: "MANUAL",
      reference_id: args.subcontractId,
      idempotency_key: `subcontract-release-${args.subcontractId}`,
      description: `Release subcontract escrow ${args.subcontractId} to service vendor`,
      metadata: {
        subcontract_id: args.subcontractId,
        service_seller_id: args.serviceSellerId,
      },
    })
  }

  /**
   * Refund subcontract escrow back to the buyer-vendor on dispute or
   * cancel.
   */
  async refundSubcontractEscrow(args: {
    subcontractId: string
    parentSellerId: string
    amountCents: number
    reason: string
    currencyCode?: string
  }) {
    if (args.amountCents <= 0) {
      throw new Error("refundSubcontractEscrow amountCents must be > 0")
    }
    const currency = args.currencyCode || "USD"
    const escrows = await this.listLedgerAccounts({
      account_type: "ESCROW",
      owner_type: "SYSTEM",
      owner_id: args.subcontractId,
    })
    if (escrows.length === 0) {
      throw new Error(`No escrow account for subcontract ${args.subcontractId}`)
    }
    const parentAccount = await this.getOrCreateSellerEarnings(
      args.parentSellerId,
      currency
    )
    return this.createTransfer({
      debit_account_id: escrows[0].id,
      credit_account_id: parentAccount.id,
      amount: args.amountCents / 100,
      entry_type: "REFUND",
      reference_type: "MANUAL",
      reference_id: args.subcontractId,
      idempotency_key: `subcontract-refund-${args.subcontractId}`,
      description: `Refund subcontract escrow ${args.subcontractId}: ${args.reason}`,
      metadata: {
        subcontract_id: args.subcontractId,
        reason: args.reason,
      },
    })
  }

  /**
   * Get or create the per-campaign ESCROW account holding all-or-nothing
   * crowdfunding backings for a collective campaign.
   */
  private async getOrCreateCampaignEscrow(campaignId: string, currency: string) {
    const existing = await this.listLedgerAccounts({
      account_type: "ESCROW",
      owner_type: "SYSTEM",
      owner_id: campaignId,
    })
    return (
      existing[0] ??
      (await this.createAccount({
        account_type: "ESCROW",
        owner_type: "SYSTEM",
        owner_id: campaignId,
        currency_code: currency,
      }))
    )
  }

  /**
   * Escrow a crowdfunding backing: move funds from the backer's USER_WALLET
   * into the campaign's ESCROW account. All-or-nothing: funds stay there
   * until the campaign is released (funded) or refunded (failed).
   */
  async openCampaignBackingEscrow(args: {
    campaignId: string
    backingId: string
    backerCustomerId: string
    amountCents: number
    currencyCode?: string
  }) {
    if (args.amountCents <= 0) {
      throw new Error("openCampaignBackingEscrow amountCents must be > 0")
    }
    const currency = args.currencyCode || "USD"
    // Backer funding source: the same CUSTOMER USER_WALLET resolution as the
    // hawala-order-payment subscriber (get-or-create).
    const wallets = await this.listLedgerAccounts({
      account_type: "USER_WALLET",
      owner_type: "CUSTOMER",
      owner_id: args.backerCustomerId,
    })
    const backerWallet =
      wallets[0] ??
      (await this.createAccount({
        account_type: "USER_WALLET",
        owner_type: "CUSTOMER",
        owner_id: args.backerCustomerId,
        currency_code: currency,
      }))
    const escrowAccount = await this.getOrCreateCampaignEscrow(args.campaignId, currency)
    return this.createTransfer({
      debit_account_id: backerWallet.id,
      credit_account_id: escrowAccount.id,
      amount: args.amountCents / 100,
      entry_type: "TRANSFER",
      reference_type: "MANUAL",
      reference_id: args.campaignId,
      idempotency_key: `campaign-backing-${args.backingId}`,
      description: `Escrow backing ${args.backingId} for campaign ${args.campaignId}`,
      metadata: {
        campaign_id: args.campaignId,
        backing_id: args.backingId,
        backer_customer_id: args.backerCustomerId,
      },
    })
  }

  /**
   * Refund a single backing's escrow back to the backer's wallet when the
   * campaign fails. Idempotent per backing via campaign-refund-<backingId>.
   */
  async refundCampaignBackingEscrow(args: {
    campaignId: string
    backingId: string
    backerCustomerId: string
    amountCents: number
    reason: string
  }) {
    if (args.amountCents <= 0) {
      throw new Error("refundCampaignBackingEscrow amountCents must be > 0")
    }
    // No currency arg: a refund only routes between accounts that already
    // exist (escrow-in created them), so their currency is already fixed.
    const escrows = await this.listLedgerAccounts({
      account_type: "ESCROW",
      owner_type: "SYSTEM",
      owner_id: args.campaignId,
    })
    if (escrows.length === 0) {
      throw new Error(`No escrow account for campaign ${args.campaignId}`)
    }
    const wallets = await this.listLedgerAccounts({
      account_type: "USER_WALLET",
      owner_type: "CUSTOMER",
      owner_id: args.backerCustomerId,
    })
    if (wallets.length === 0) {
      throw new Error(`No wallet for backer ${args.backerCustomerId}`)
    }
    return this.createTransfer({
      debit_account_id: escrows[0].id,
      credit_account_id: wallets[0].id,
      amount: args.amountCents / 100,
      entry_type: "REFUND",
      reference_type: "MANUAL",
      reference_id: args.campaignId,
      idempotency_key: `campaign-refund-${args.backingId}`,
      description: `Refund campaign ${args.campaignId} backing ${args.backingId}: ${args.reason}`,
      metadata: {
        campaign_id: args.campaignId,
        backing_id: args.backingId,
        backer_customer_id: args.backerCustomerId,
        reason: args.reason,
      },
    })
  }

  /**
   * Release a funded campaign's escrow to the vendor. `amountCents` is the
   * TOTAL escrowed amount; the optional platform fee is carved out of it, so
   * the seller leg and fee leg always sum to `amountCents`.
   */
  async releaseCampaignEscrow(args: {
    campaignId: string
    vendorSellerId: string
    amountCents: number
    platformFeeCents?: number
    currencyCode?: string
  }) {
    if (args.amountCents <= 0) {
      throw new Error("releaseCampaignEscrow amountCents must be > 0")
    }
    const feeCents = args.platformFeeCents ?? 0
    if (!Number.isInteger(feeCents) || feeCents < 0 || feeCents >= args.amountCents) {
      throw new Error(
        "releaseCampaignEscrow platformFeeCents must be an integer >= 0 and < amountCents"
      )
    }
    const currency = args.currencyCode || "USD"
    const escrows = await this.listLedgerAccounts({
      account_type: "ESCROW",
      owner_type: "SYSTEM",
      owner_id: args.campaignId,
    })
    if (escrows.length === 0) {
      throw new Error(`No escrow account for campaign ${args.campaignId}`)
    }
    const sellerAccount = await this.getOrCreateSellerEarnings(
      args.vendorSellerId,
      currency
    )
    const releaseEntry = await this.createTransfer({
      debit_account_id: escrows[0].id,
      credit_account_id: sellerAccount.id,
      amount: (args.amountCents - feeCents) / 100,
      entry_type: "TRANSFER",
      reference_type: "MANUAL",
      reference_id: args.campaignId,
      idempotency_key: `campaign-release-${args.campaignId}`,
      description: `Release campaign ${args.campaignId} escrow to vendor`,
      metadata: {
        campaign_id: args.campaignId,
        vendor_seller_id: args.vendorSellerId,
        platform_fee_cents: feeCents,
      },
    })
    let feeEntry: typeof releaseEntry | null = null
    if (feeCents > 0) {
      const platformAccount = await this.getOrCreateSystemAccount("PLATFORM_FEE")
      feeEntry = await this.createTransfer({
        debit_account_id: escrows[0].id,
        credit_account_id: platformAccount.id,
        amount: feeCents / 100,
        entry_type: "COMMISSION",
        reference_type: "MANUAL",
        reference_id: args.campaignId,
        idempotency_key: `campaign-release-fee-${args.campaignId}`,
        description: `Platform fee for campaign ${args.campaignId} escrow release`,
        metadata: {
          campaign_id: args.campaignId,
          vendor_seller_id: args.vendorSellerId,
        },
      })
    }
    return { release_entry: releaseEntry, fee_entry: feeEntry }
  }

  /**
   * Consignment revenue split: fan an order's seller-side amount out of the
   * system ESCROW into the consignor's and the selling vendor's
   * SELLER_EARNINGS ("a vendor sells on behalf of a represented party;
   * revenue split is atomic at order complete" — listing-type catalog
   * `consignment`). Replaces the single escrow->seller leg of
   * processOrderPayment on the FBM_CONSIGNMENT_SPLIT_LIVE subscriber path
   * (see subscribers/hawala-order-payment.ts) — dark by default.
   *
   * `sellerAmountCents` is the post-platform-fee seller-side amount in
   * integer cents. The consignor receives floor(sellerAmountCents *
   * consignorBps / 10000) and the vendor keeps the remainder, so the legs
   * always sum to exactly `sellerAmountCents` (no rounding drift; sub-cent
   * benefit to the vendor). A zero-cent leg is skipped rather than written
   * as a zero-amount transfer. Idempotent per order via
   * `${idempotencyKey}-consignor` / `${idempotencyKey}-vendor`;
   * createTransfer amounts are major units (cents / 100).
   */
  async processConsignmentSplit(args: {
    orderId: string
    sellerAmountCents: number
    currencyCode?: string
    vendorSellerId: string
    consignorSellerId: string
    consignorBps: number
    idempotencyKey: string
  }) {
    if (!Number.isInteger(args.sellerAmountCents) || args.sellerAmountCents <= 0) {
      throw new Error(
        "processConsignmentSplit sellerAmountCents must be a positive integer"
      )
    }
    if (args.consignorSellerId === args.vendorSellerId) {
      throw new Error(
        "processConsignmentSplit consignorSellerId must differ from vendorSellerId"
      )
    }
    // Throws when consignorBps is not an integer in 0..10000.
    const { consignor_cents, vendor_cents } = splitConsignmentCents(
      args.sellerAmountCents,
      args.consignorBps
    )
    if (
      consignor_cents < 0 ||
      vendor_cents < 0 ||
      consignor_cents + vendor_cents !== args.sellerAmountCents
    ) {
      // Unreachable given the guards above; kept so the ledger can never fan
      // out more (or less) than the seller-side amount.
      throw new Error(
        "processConsignmentSplit split does not sum to sellerAmountCents"
      )
    }
    const currency = args.currencyCode || "USD"
    const escrowAccount = await this.getOrCreateSystemAccount("ESCROW")
    const sharedMetadata = {
      order_id: args.orderId,
      vendor_seller_id: args.vendorSellerId,
      consignor_seller_id: args.consignorSellerId,
      consignor_bps: args.consignorBps,
      seller_amount_cents: args.sellerAmountCents,
    }
    const entries: any[] = []
    if (consignor_cents > 0) {
      const consignorAccount = await this.getOrCreateSellerEarnings(
        args.consignorSellerId,
        currency
      )
      entries.push(
        await this.createTransfer({
          debit_account_id: escrowAccount.id,
          credit_account_id: consignorAccount.id,
          amount: consignor_cents / 100,
          entry_type: "TRANSFER",
          reference_type: "ORDER",
          reference_id: args.orderId,
          order_id: args.orderId,
          idempotency_key: `${args.idempotencyKey}-consignor`,
          correlation_id: args.idempotencyKey,
          description: `Consignment split for order ${args.orderId}: consignor share`,
          metadata: {
            ...sharedMetadata,
            split_leg: "consignor",
            split_cents: consignor_cents,
          },
        })
      )
    }
    if (vendor_cents > 0) {
      const vendorAccount = await this.getOrCreateSellerEarnings(
        args.vendorSellerId,
        currency
      )
      entries.push(
        await this.createTransfer({
          debit_account_id: escrowAccount.id,
          credit_account_id: vendorAccount.id,
          amount: vendor_cents / 100,
          entry_type: "TRANSFER",
          reference_type: "ORDER",
          reference_id: args.orderId,
          order_id: args.orderId,
          idempotency_key: `${args.idempotencyKey}-vendor`,
          correlation_id: args.idempotencyKey,
          description: `Consignment split for order ${args.orderId}: vendor share`,
          metadata: {
            ...sharedMetadata,
            split_leg: "vendor",
            split_cents: vendor_cents,
          },
        })
      )
    }
    return entries
  }

  /**
   * Reverse a previously paid creator commission (e.g. on refund). Creates a
   * new ledger entry that flows funds creator -> vendor.
   */
  async reverseCreatorCommission(args: {
    vendorSellerId: string
    creatorSellerId: string
    amountCents: number
    orderId: string
    attributionId: string
    reason: string
    currencyCode?: string
  }) {
    if (args.amountCents <= 0) {
      throw new Error("reverseCreatorCommission amountCents must be > 0")
    }

    const currency = args.currencyCode || "USD"
    const vendorAccount = await this.getOrCreateSellerEarnings(args.vendorSellerId, currency)
    const creatorAccount = await this.getOrCreateCreatorEarnings(args.creatorSellerId, currency)

    return this.createTransfer({
      debit_account_id: creatorAccount.id,
      credit_account_id: vendorAccount.id,
      amount: args.amountCents / 100,
      entry_type: "REFUND",
      reference_type: "CREATOR_ATTRIBUTION",
      reference_id: args.attributionId,
      order_id: args.orderId,
      idempotency_key: `creator-commission-reversal-${args.attributionId}`,
      correlation_id: `creator-commission-${args.attributionId}`,
      description: `Reversed creator commission for order ${args.orderId}: ${args.reason}`,
      metadata: {
        attribution_id: args.attributionId,
        reversal: true,
        reason: args.reason,
      },
    })
  }

  // ==================== DOUBLE-ENTRY TRANSFERS ====================

  /**
   * Create a double-entry transfer between accounts
   * This is the core atomic operation - always balanced
   */
  async createTransfer(data: {
    debit_account_id: string
    credit_account_id: string
    amount: number
    entry_type: string
    description?: string
    reference_type?: string
    reference_id?: string
    order_id?: string
    investment_pool_id?: string
    idempotency_key?: string
    // Lineage: entries fanned out from one economic action share a
    // correlation_id; parent_entry_id points at the entry a derived leg
    // (fee, split) hangs off. See getOrderLineage/getEntryLineage.
    correlation_id?: string
    parent_entry_id?: string
    metadata?: Record<string, any>
    // Optional pg connection. When supplied, balance mutations use the
    // atomic CAS UPDATE (updateBalancesAtomic) instead of the legacy
    // read-modify-write updateBalances. Additive/non-breaking: callers
    // that don't pass it keep the old behavior.
    pgConnection?: any
  }) {
    // Reject non-finite or negative amounts at the single money-movement
    // chokepoint. A negative amount inverts the debit/credit deltas in
    // updateBalancesAtomic (debit leg becomes a self-credit, credit leg drains
    // the counterparty), which the `balance + delta >= 0` CAS cannot catch —
    // so a caller that failed to validate could move value backwards. Zero is
    // allowed (a no-op transfer cannot move value); only < 0 and NaN/Infinity
    // are rejected here. Callers that require strictly-positive amounts (e.g.
    // payouts, withdrawals) still validate that at their own layer.
    if (!Number.isFinite(data.amount) || data.amount < 0) {
      throw new Error(
        `Invalid transfer amount: ${data.amount}. Amount must be a finite, non-negative number.`
      )
    }

    // Check idempotency
    if (data.idempotency_key) {
      const existing = await this.listLedgerEntries({
        idempotency_key: data.idempotency_key,
      })
      if (existing.length > 0) {
        return existing[0] // Return existing entry
      }
    }

    // Get accounts
    const [debitAccount, creditAccount] = await Promise.all([
      this.retrieveLedgerAccount(data.debit_account_id),
      this.retrieveLedgerAccount(data.credit_account_id),
    ])

    if (!debitAccount || !creditAccount) {
      throw new Error("Invalid account ID")
    }

    // Nonprofit-carried pools (Decision 6b, L26): a leg that names a pool, or
    // a PRODUCER_POOL account a pool owns, is refused — always for a carried
    // pool (BMC never holds pool funds), and for an uncarried pool once
    // FF_NONPROFIT_PARITY_V1 is on ("a pool with no carrier cannot accept
    // money"). Here, at the single money-movement chokepoint, before any
    // entry is written. See `./carrier.ts`. A designated pool's allowed
    // outflow (Decision 8) comes back as the pool to stamp once this leg has
    // COMPLETED; with the flag off it is always null.
    const designatedPool = await this.assertPoolLegAllowed_(data, debitAccount, creditAccount)

    // Both legs must be on the same rail. The entry's rail is derived from
    // the debit account, so without this check a CCR-debit → USD-credit
    // transfer would pass the CCR guard and inflate a USD balance —
    // closed-loop value escaping into a cash-convertible account. Rejected
    // before any entry is written or balance moves.
    if (debitAccount.currency_code !== creditAccount.currency_code) {
      throw new Error(
        `Cross-rail transfer rejected: debit account is ${debitAccount.currency_code}, ` +
          `credit account is ${creditAccount.currency_code}. Both legs must share a rail.`
      )
    }

    // Per-rail invariant guard. CCR keeps its Posture A purchase-context
    // check; HRS gets the time-bank reference check; KARMA is rejected
    // here (use karma_event); USD/USDC/GIFT are passthrough; unknown
    // currency codes throw rather than silently writing.
    // See `posture-a-guard.ts`, `rails.ts`, and `docs/POSTURE_A_COMPLIANCE.md`.
    assertRailInvariants({
      currency_code: debitAccount.currency_code,
      entry_type: data.entry_type,
      reference_type: data.reference_type ?? null,
      reference_id: data.reference_id ?? null,
      order_id: data.order_id ?? null,
      cart_id: (data.metadata as { cart_id?: string } | undefined)?.cart_id ?? null,
      debit_account_id: data.debit_account_id,
      credit_account_id: data.credit_account_id,
    })

    // Check available balance for debit account
    if (Number(debitAccount.available_balance) < data.amount) {
      throw new Error(`Insufficient balance in account ${debitAccount.account_number}`)
    }

    // Create the entry as PENDING first. The unique idempotency_key on this
    // insert still guards against a concurrent duplicate transfer moving money
    // twice (the second insert fails before any balance mutation). The entry is
    // only flipped to COMPLETED once balances have actually moved, so a failed
    // or partial balance move can never leave a phantom COMPLETED entry that
    // moved no money (B-money-4).
    const entry = await this.createLedgerEntries({
      debit_account_id: data.debit_account_id,
      credit_account_id: data.credit_account_id,
      amount: data.amount,
      currency_code: debitAccount.currency_code,
      entry_type: data.entry_type as any,
      status: "PENDING" as const,
      description: data.description,
      reference_type: data.reference_type as any,
      reference_id: data.reference_id,
      order_id: data.order_id,
      investment_pool_id: data.investment_pool_id,
      idempotency_key: data.idempotency_key,
      correlation_id: data.correlation_id,
      parent_entry_id: data.parent_entry_id,
      metadata: data.metadata,
    })

    // Move account balances. Prefer the atomic CAS path: use the caller's
    // pg connection when supplied, otherwise self-resolve one from the module
    // container so production money moves are atomic by default (the ~39
    // createTransfer call sites don't have to thread a connection). Only when
    // no connection is reachable at all (e.g. unit tests without DI) do we
    // fall back to the legacy read-modify-write updateBalances.
    //
    // The debit and credit run inside a single DB transaction so they are
    // all-or-nothing — a credit failure after a successful debit can no longer
    // leave a one-sided balance change (B-money-4).
    const pgConnection = data.pgConnection ?? this.resolvePgConnection()
    try {
      if (pgConnection) {
        if (typeof pgConnection.transaction === "function") {
          await pgConnection.transaction(async (trx: any) => {
            // Lock the two rows in a deterministic global order (by account
            // id), NOT in debit-then-credit order. Two transfers moving funds
            // in opposite directions between the same pair would otherwise
            // take the locks as A→B and B→A and deadlock, and Postgres kills
            // one of them. Ordering by id means every transaction touching a
            // given pair takes those locks in the same sequence, so the cycle
            // cannot form.
            //
            // Safe to reorder: both statements are in one transaction, so an
            // insufficient-balance failure on either leg still rolls the whole
            // thing back. Which leg runs first changes nothing observable.
            for (const leg of this.orderLegsForLocking(data)) {
              await this.updateBalancesAtomic(trx, leg.accountId, leg.delta)
            }
          })
        } else {
          await this.applyBalancePairWithCompensation(
            (delta) =>
              this.updateBalancesAtomic(pgConnection, data.debit_account_id, delta),
            (delta) =>
              this.updateBalancesAtomic(pgConnection, data.credit_account_id, delta),
            data
          )
        }
      } else {
        await this.applyBalancePairWithCompensation(
          (delta) => this.updateBalances(data.debit_account_id, delta),
          (delta) => this.updateBalances(data.credit_account_id, delta),
          data
        )
      }
    } catch (balanceError) {
      // Balances did not move (or were rolled back). Mark the entry FAILED so no
      // phantom COMPLETED row survives, then surface the original error.
      await this.updateLedgerEntries({ id: entry.id, status: "FAILED" as const }).catch(
        () => undefined
      )
      throw balanceError
    }

    // Balances moved — flip the entry to COMPLETED and record running balances.
    const [newDebitAccount, newCreditAccount] = await Promise.all([
      this.retrieveLedgerAccount(data.debit_account_id),
      this.retrieveLedgerAccount(data.credit_account_id),
    ])

    await this.updateLedgerEntries({
      id: entry.id,
      status: "COMPLETED" as const,
      debit_balance_after: newDebitAccount.balance,
      credit_balance_after: newCreditAccount.balance,
    })

    // Reflect the committed state on the returned in-memory entry (it was
    // created as PENDING above).
    ;(entry as any).status = "COMPLETED"
    ;(entry as any).debit_balance_after = newDebitAccount.balance
    ;(entry as any).credit_balance_after = newCreditAccount.balance

    // Decision 8: date the designated pool's first outflow only now that the
    // money has actually moved — a leg refused after the guard (cross-rail,
    // rail invariants, balance) never stamps. Never throws.
    if (designatedPool) await this.stampLegacyFundsDesignated_(designatedPool)

    // AUDIT: Log the transfer
    auditFinancialTransaction(
      "TRANSFER_COMPLETED",
      debitAccount.owner_id || "SYSTEM",
      (debitAccount.owner_type as any) || "SYSTEM",
      entry.id,
      data.amount,
      {
        debit_account_id: data.debit_account_id,
        credit_account_id: data.credit_account_id,
        entry_type: data.entry_type,
        description: data.description,
      }
    )

    // Balance monitors: evaluate the two touched accounts now that money
    // has moved. Fire-and-forget — monitoring must never fail, block, or
    // slow a transfer; the scheduled sweep is the backstop for anything
    // missed here.
    void this.evaluateMonitorsForAccounts([
      data.debit_account_id,
      data.credit_account_id,
    ]).catch((err: any) => {
      log.warn(
        `balance-monitor evaluation failed after transfer ${entry.id}: ${err?.message ?? err}`
      )
    })

    return entry
  }

  /**
   * Update account balances atomically with retry logic
   * 
   * SECURITY: Uses optimistic locking with version checking and retry
   * to prevent race conditions in concurrent balance updates.
   * 
   * The pattern:
   * 1. Read current balance and version
   * 2. Compute new balance
   * 3. Update only if version hasn't changed
   * 4. Retry with exponential backoff if conflict detected
   * 
   * For debits, validates sufficient balance before update.
   */
  /**
   * Resolve a raw pg connection from the module container, or undefined when
   * one isn't reachable (e.g. unit tests instantiated without Medusa DI).
   *
   * This lets money-moving methods default to the atomic CAS / atomic-SQL
   * paths in production WITHOUT every one of the ~39 createTransfer call
   * sites having to thread a connection by hand. Mirrors the proven pattern
   * in creator-attribution's `atomicIncrementAffiliateLink`. The awilix
   * container throws on an unregistered key, so the resolve is guarded.
   */
  private resolvePgConnection():
    | { raw: (sql: string, bindings?: any[]) => Promise<any> }
    | undefined {
    // MedusaService stores the module's scoped container/cradle as
    // `__container__` (NOT `container_`). Support both a container (`.resolve`)
    // and an awilix cradle (property access) so the atomic money paths actually
    // engage. The cradle throws on an unknown registration, hence the guard.
    const container = (this as any).__container__
    // 1) A registered PG_CONNECTION (knex) on the container or its cradle.
    try {
      const pg =
        container?.resolve?.(ContainerRegistrationKeys.PG_CONNECTION) ??
        container?.[ContainerRegistrationKeys.PG_CONNECTION]
      if (pg?.raw) return pg
    } catch {
      // fall through
    }
    // 2) Derive a knex from the module's MikroORM EntityManager. Some scoped
    //    containers (notably the module integration-test harness) don't register
    //    PG_CONNECTION, but the manager's PostgreSQL connection exposes a knex
    //    with `.raw`. In production path (1) resolves first, so this is a
    //    last-resort fallback.
    try {
      const em =
        (this as any).baseRepository_?.getActiveManager?.() ??
        container?.manager
      const knex = em?.getConnection?.()?.getKnex?.()
      if (knex?.raw) return knex
    } catch {
      // no reachable connection (e.g. unit tests without DI)
    }
    return undefined
  }

  /**
   * Atomically apply integer/decimal deltas to investment-pool counter
   * columns in a single `col = col + ?` UPDATE, so concurrent
   * investments/distributions don't clobber each other (read-modify-write
   * loses updates under concurrency). Returns true when the atomic UPDATE
   * ran; false when no pg connection is reachable so the caller can fall
   * back to the legacy read-modify-write.
   *
   * Column names come from a fixed allowlist and are interpolated into the
   * SQL identifier position (bindings can't bind identifiers); deltas are
   * always parameter-bound.
   */
  private async atomicPoolIncrement(
    poolId: string,
    increments: Partial<
      Record<"total_raised" | "total_investors" | "total_distributed", number>
    >
  ): Promise<boolean> {
    const pg = this.resolvePgConnection()
    if (!pg) return false

    const ALLOWED = ["total_raised", "total_investors", "total_distributed"] as const
    const cols = Object.keys(increments).filter(
      (c): c is (typeof ALLOWED)[number] =>
        (ALLOWED as readonly string[]).includes(c)
    )
    if (cols.length === 0) return true

    const setClause = cols.map((c) => `${c} = ${c} + ?`).join(", ")
    const bindings = [...cols.map((c) => increments[c] as number), poolId]
    await pg.raw(
      `UPDATE hawala_investment_pool SET ${setClause}, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
      bindings
    )
    return true
  }

  /**
   * Atomically apply a balance delta using a single conditional UPDATE.
   *
   * This is a true DB-level compare-and-swap: the `balance + ? >= 0` and
   * `available_balance + ? >= 0` predicates in the WHERE clause guarantee we
   * never overdraw and never lose a concurrent write (no read-modify-write
   * TOCTOU window). If no row is updated (`rowCount === 0`) the account is
   * missing, deleted, or has insufficient balance for a debit, so we throw.
   *
   * Both columns are guarded, not just `balance`. They move in lockstep today,
   * so the second predicate is currently equivalent — but `available_balance`
   * is modelled as `balance - pending`, and the caller's own pre-check at
   * `createTransfer` reads `available_balance`. Guarding only `balance` would
   * mean that the moment anything starts reserving funds, the CAS would happily
   * spend a reservation that the pre-check had just rejected.
   *
   * Uses the same `?` positional raw-SQL style as getMemberBalanceByMxid.
   */
  /**
   * Order a transfer's two balance legs by account id, so every transaction
   * that touches a given pair of accounts acquires their row locks in the same
   * sequence. This is what prevents AB-BA deadlocks between transfers running
   * in opposite directions across the same pair.
   */
  private orderLegsForLocking(data: {
    debit_account_id: string
    credit_account_id: string
    amount: number
  }): Array<{ accountId: string; delta: number }> {
    const legs = [
      { accountId: data.debit_account_id, delta: -data.amount },
      { accountId: data.credit_account_id, delta: data.amount },
    ]
    return legs.sort((a, b) => a.accountId.localeCompare(b.accountId))
  }

  /**
   * Move a debit and its matching credit when no DB transaction is available.
   *
   * Both fallback paths issue two independent statements, so a credit failure
   * after a successful debit left money debited and never credited — a
   * one-sided move the database cannot roll back for us. This reverses the
   * debit explicitly.
   *
   * If the reversal itself fails there is nothing more we can do inline, so it
   * is logged at error with both account ids and the amount. That is exactly
   * the drift the `hawala-balance-reconciler` job looks for; the alternative
   * (swallowing it) would leave the imbalance invisible.
   *
   * The transactional path above is still strongly preferred — this only runs
   * when the pg connection cannot open a transaction, or when none resolves at
   * all (unit tests, misconfiguration).
   */
  private async applyBalancePairWithCompensation(
    applyDebit: (delta: number) => Promise<void>,
    applyCredit: (delta: number) => Promise<void>,
    data: { debit_account_id: string; credit_account_id: string; amount: number }
  ): Promise<void> {
    await applyDebit(-data.amount)

    try {
      await applyCredit(data.amount)
    } catch (creditError) {
      try {
        await applyDebit(data.amount)
      } catch (reversalError) {
        log.error(
          `[Hawala] One-sided balance move: debited ${data.amount} from ` +
            `${data.debit_account_id} but could not credit ` +
            `${data.credit_account_id}, and reversing the debit also failed. ` +
            `Manual reconciliation required.`,
          reversalError
        )
      }
      throw creditError
    }
  }

  private async updateBalancesAtomic(
    pgConnection: any,
    accountId: string,
    delta: number
  ): Promise<void> {
    const result = await pgConnection.raw(
      `UPDATE hawala_ledger_account
         SET balance = balance + ?,
             available_balance = available_balance + ?,
             updated_at = NOW()
       WHERE id = ?
         AND deleted_at IS NULL
         AND balance + ? >= 0
         AND available_balance + ? >= 0`,
      [delta, delta, accountId, delta, delta]
    )

    // knex/pg raw returns rowCount on the result object (or nested rowCount).
    const rowCount =
      typeof result?.rowCount === "number"
        ? result.rowCount
        : typeof result?.rows?.length === "number" && result.rowCount === undefined
          ? result.rows.length
          : result?.rowCount

    if (!rowCount) {
      throw new Error("Insufficient balance in account " + accountId)
    }
  }

  private async updateBalances(accountId: string, delta: number, maxRetries = 5) {
    let attempt = 0
    
    while (attempt < maxRetries) {
      attempt++
      
      // Get current account state
      const account = await this.retrieveLedgerAccount(accountId)
      const currentBalance = Number(account.balance)
      const currentAvailable = Number(account.available_balance)
      const newBalance = currentBalance + delta
      const newAvailable = currentAvailable + delta

      // Validate balance won't go negative for debits
      if (newBalance < 0) {
        throw new Error(
          `Insufficient balance in account ${accountId}. ` +
          `Available: ${currentBalance}, Requested: ${Math.abs(delta)}`
        )
      }

      try {
        // Optimistic update: include current balance in WHERE clause
        // This ensures we don't overwrite concurrent updates
        const accounts = await this.listLedgerAccounts({ id: accountId })
        if (accounts.length === 0) {
          throw new Error(`Account ${accountId} not found`)
        }
        
        // Re-check balance hasn't changed since we read it
        const freshAccount = accounts[0]
        if (Number(freshAccount.balance) !== currentBalance) {
          // Concurrent modification detected - retry
          if (attempt < maxRetries) {
            // Exponential backoff with random jitter to de-correlate retries.
            const backoff = 10 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 10)
            await new Promise(resolve => setTimeout(resolve, backoff))
            continue
          }
          throw new Error(
            `Concurrent balance modification detected for account ${accountId}. ` +
            `Please retry the transaction.`
          )
        }

        await this.updateLedgerAccounts({
          id: accountId,
          balance: newBalance,
          available_balance: newAvailable,
        })
        
        // Success - exit retry loop
        return
      } catch (error) {
        if (attempt >= maxRetries) {
          throw error
        }
        // Exponential backoff with random jitter before retry
        const backoff = 10 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 10)
        await new Promise(resolve => setTimeout(resolve, backoff))
      }
    }
  }

  // ==================== DEPOSIT & WITHDRAWAL ====================

  /**
   * Record a deposit (fiat in via ACH)
   */
  async recordDeposit(data: {
    credit_account_id: string
    amount: number
    stripe_payment_intent_id: string
    fee?: number
    idempotency_key?: string
    metadata?: Record<string, any>
  }) {
    // Get or create reserve account (source of deposits)
    const reserveAccount = await this.getOrCreateSystemAccount("RESERVE")

    return this.createTransfer({
      debit_account_id: reserveAccount.id,
      credit_account_id: data.credit_account_id,
      amount: data.amount,
      entry_type: "DEPOSIT",
      reference_type: "STRIPE_PAYMENT",
      reference_id: data.stripe_payment_intent_id,
      idempotency_key: data.idempotency_key,
      metadata: {
        ...data.metadata,
        fee: data.fee,
      },
    })
  }

  /**
   * Record a withdrawal (fiat out via ACH)
   */
  async recordWithdrawal(data: {
    debit_account_id: string
    amount: number
    stripe_transfer_id: string
    fee?: number
    idempotency_key?: string
    metadata?: Record<string, any>
  }) {
    const reserveAccount = await this.getOrCreateSystemAccount("RESERVE")

    return this.createTransfer({
      debit_account_id: data.debit_account_id,
      credit_account_id: reserveAccount.id,
      amount: data.amount,
      entry_type: "WITHDRAWAL",
      reference_type: "STRIPE_PAYMENT",
      reference_id: data.stripe_transfer_id,
      idempotency_key: data.idempotency_key,
      metadata: {
        ...data.metadata,
        fee: data.fee,
      },
    })
  }

  // ==================== ORDER PROCESSING ====================

  /**
   * Process an order payment through the ledger
   * Splits payment between seller, platform fee, and optional producer investment
   */
  async processOrderPayment(data: {
    customer_account_id: string
    seller_account_id: string
    order_id: string
    total_amount: number
    platform_fee_amount: number
    producer_id?: string
    auto_invest_percentage?: number
    idempotency_key: string
    /**
     * Optional reference stamped on the customer→escrow leg. The renewal
     * path passes reference_type "SUBSCRIPTION_RENEWAL" + the subscription id
     * so recurring revenue is explicitly typed in the ledger instead of
     * riding the generic purchase context (ECONOMIC_REVIEW H3). The
     * reference type is already blessed by the Posture-A guard and the
     * ledger-entry enum — no vocabulary change.
     */
    reference_type?: string
    reference_id?: string
  }) {
    const entries: any[] = []

    // Get platform fee account
    const platformAccount = await this.getOrCreateSystemAccount("PLATFORM_FEE")

    // Calculate amounts
    const platformFee = data.platform_fee_amount
    let sellerAmount = data.total_amount - platformFee
    let investmentAmount = 0

    // Auto-invest if configured. With FF_NONPROFIT_PARITY_V1 on no pool
    // ledger leg can post (createTransfer refuses `no_carrier` for an
    // uncarried pool and `carried_pool` for a carried one, Decision 6b), so
    // the carve-out is not made at all: the seller leg carries the full
    // amount and no pool is created. Decided HERE, before any leg posts —
    // deciding it at step 4 would strand the carved-out amount in ESCROW
    // after the purchase, fee and seller legs had already completed. With
    // the flag off this path is unchanged.
    if (data.producer_id && data.auto_invest_percentage && !featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) {
      investmentAmount = Math.floor(sellerAmount * (data.auto_invest_percentage / 100))
      sellerAmount -= investmentAmount
    }

    // 1. Customer pays full amount to escrow first
    const escrowAccount = await this.getOrCreateSystemAccount("ESCROW")
    const purchaseEntry = await this.createTransfer({
      debit_account_id: data.customer_account_id,
      credit_account_id: escrowAccount.id,
      amount: data.total_amount,
      entry_type: "PURCHASE",
      reference_type: data.reference_type,
      reference_id: data.reference_id,
      order_id: data.order_id,
      idempotency_key: `${data.idempotency_key}-purchase`,
      correlation_id: data.idempotency_key,
    })
    entries.push(purchaseEntry)

    // 2. Platform fee from escrow to platform
    const feeEntry = await this.createTransfer({
      debit_account_id: escrowAccount.id,
      credit_account_id: platformAccount.id,
      amount: platformFee,
      entry_type: "COMMISSION",
      order_id: data.order_id,
      idempotency_key: `${data.idempotency_key}-fee`,
      correlation_id: data.idempotency_key,
      parent_entry_id: purchaseEntry?.id,
    })
    entries.push(feeEntry)

    // 3. Seller earnings from escrow
    const sellerEntry = await this.createTransfer({
      debit_account_id: escrowAccount.id,
      credit_account_id: data.seller_account_id,
      amount: sellerAmount,
      entry_type: "TRANSFER",
      order_id: data.order_id,
      idempotency_key: `${data.idempotency_key}-seller`,
      correlation_id: data.idempotency_key,
      parent_entry_id: purchaseEntry?.id,
    })
    entries.push(sellerEntry)

    // 4. Optional investment to producer pool
    if (investmentAmount > 0 && data.producer_id) {
      const producerPool = await this.getOrCreateProducerPool(data.producer_id)
      if (producerPool) {
        const investEntry = await this.createTransfer({
          debit_account_id: escrowAccount.id,
          credit_account_id: producerPool.ledger_account_id,
          amount: investmentAmount,
          entry_type: "INVESTMENT",
          order_id: data.order_id,
          investment_pool_id: producerPool.id,
          idempotency_key: `${data.idempotency_key}-invest`,
          correlation_id: data.idempotency_key,
          parent_entry_id: purchaseEntry?.id,
        })
        entries.push(investEntry)
      }
    }

    return entries
  }

  // ==================== REFUND OPERATIONS ====================

  /**
   * Process a refund for an order
   * 
   * This reverses the original payment flow:
   * 1. Find original ledger entries for the order
   * 2. Reverse seller earnings (Seller → Escrow)
   * 3. Reverse platform fee (Platform → Escrow)
   * 4. Reverse customer payment (Escrow → Customer)
   * 5. Mark all entries as REVERSED
   * 
   * @param data.order_id - The order ID to refund
   * @param data.refund_amount - Amount to refund (optional, defaults to full refund)
   * @param data.reason - Reason for refund
   * @param data.idempotency_key - Prevent duplicate refunds
   */
  async processRefund(data: {
    order_id: string
    refund_amount?: number
    reason?: string
    idempotency_key?: string
  }) {
    // Deterministic by (order, amount). The previous `Date.now()` fallback
    // defeated the duplicate check immediately below it — a timestamped key
    // can never match a stored one, so every retry re-refunded. Callers that
    // legitimately issue several identical partial refunds for one order must
    // pass an explicit `idempotency_key`.
    const idempotencyKey =
      data.idempotency_key ||
      `refund-${data.order_id}-${data.refund_amount ?? "full"}`


    // Check for existing refund with same idempotency key
    const existingRefunds = await this.listLedgerEntries({
      idempotency_key: `${idempotencyKey}-customer`,
    })
    if (existingRefunds.length > 0) {
      log.info(`[Hawala] Refund already processed for order ${data.order_id}`)
      return existingRefunds
    }

    // Find original order entries
    const originalEntries = await this.listLedgerEntries({
      order_id: data.order_id,
      status: "COMPLETED",
    })

    if (originalEntries.length === 0) {
      throw new Error(`No completed payments found for order ${data.order_id}`)
    }

    // Find the purchase entry to get the original amount
    const purchaseEntry = originalEntries.find(e => e.entry_type === "PURCHASE")
    if (!purchaseEntry) {
      throw new Error(`No purchase entry found for order ${data.order_id}`)
    }

    const originalAmount = Number(purchaseEntry.amount)
    const refundAmount = data.refund_amount || originalAmount
    
    // Validate refund amount
    if (refundAmount > originalAmount) {
      throw new Error(
        `Refund amount (${refundAmount}) exceeds original payment (${originalAmount})`
      )
    }

    // Calculate proportional refund amounts
    const refundRatio = refundAmount / originalAmount
    const roundCents = (n: number) => Math.round(n * 100) / 100

    // Fee portion (Platform → Escrow)
    const feeEntry = originalEntries.find(e => e.entry_type === "COMMISSION")
    const originalFee = feeEntry ? Number(feeEntry.amount) : 0
    const feeRefund = roundCents(originalFee * refundRatio)

    // Seller-side legs: every TRANSFER out of escrow to a non-customer account.
    // The plain path writes one (escrow -> seller); a consignment split writes
    // two (escrow -> consignor, escrow -> vendor). All must be reversed, or the
    // escrow -> customer leg overdraws escrow on the CAS. Reversed as the
    // balancing legs below.
    const sellerEntries = originalEntries.filter(e =>
      e.entry_type === "TRANSFER" && e.credit_account_id !== purchaseEntry.debit_account_id
    )

    // Auto-invest legs. Escrow originally funded each producer pool, so a refund
    // that skips these leaves escrow short by the invested amount and the
    // escrow → customer transfer fails on the balance CAS. Dormant today
    // (auto_invest_percentage is never populated) but must be reversed for
    // correctness if it is ever wired (B-money-8).
    const investmentEntries = originalEntries.filter(e => e.entry_type === "INVESTMENT")

    // Get system accounts
    const escrowAccount = await this.getOrCreateSystemAccount("ESCROW")
    const platformAccount = await this.getOrCreateSystemAccount("PLATFORM_FEE")

    const refundEntries: any[] = []
    const description = data.reason || `Refund for order ${data.order_id}`

    // 1. Reverse platform fee (Platform → Escrow)
    if (feeRefund > 0) {
      const feeRefundEntry = await this.createTransfer({
        debit_account_id: platformAccount.id,
        credit_account_id: escrowAccount.id,
        amount: feeRefund,
        entry_type: "REFUND",
        order_id: data.order_id,
        description: `${description} - platform fee reversal`,
        idempotency_key: `${idempotencyKey}-fee`,
      })
      refundEntries.push(feeRefundEntry)
    }

    // 2. Reverse auto-invest legs (Pool → Escrow)
    let investmentRefundTotal = 0
    for (let i = 0; i < investmentEntries.length; i++) {
      const inv = investmentEntries[i]
      const invRefund = roundCents(Number(inv.amount) * refundRatio)
      if (invRefund <= 0) continue
      investmentRefundTotal += invRefund
      const invRefundEntry = await this.createTransfer({
        debit_account_id: inv.credit_account_id, // producer pool ledger account
        credit_account_id: escrowAccount.id,
        amount: invRefund,
        entry_type: "REFUND",
        order_id: data.order_id,
        description: `${description} - investment reversal`,
        idempotency_key: `${idempotencyKey}-invest-${i}`,
      })
      refundEntries.push(invRefundEntry)
    }

    // 3. Reverse seller earnings (Seller → Escrow). The seller side is the
    // balancing leg: seller + fee + investment reversed INTO escrow must equal
    // the customer refund OUT of escrow, so escrow nets to exactly zero with no
    // sub-cent drift across the independently-rounded legs (B-money-8). When the
    // order was consignment-split there are two seller-side legs; split the
    // seller refund across them pro-rata to their original amounts, with the
    // last leg absorbing the remainder so the parts sum to sellerRefund exactly.
    const sellerRefund = roundCents(refundAmount - feeRefund - investmentRefundTotal)
    if (sellerEntries.length > 0 && sellerRefund > 0) {
      const sellerTotal = sellerEntries.reduce((sum, e) => sum + Number(e.amount), 0)
      let allocated = 0
      for (let i = 0; i < sellerEntries.length; i++) {
        const leg = sellerEntries[i]
        const isLast = i === sellerEntries.length - 1
        const legRefund = isLast
          ? roundCents(sellerRefund - allocated)
          : roundCents((sellerRefund * Number(leg.amount)) / (sellerTotal || 1))
        allocated += legRefund
        if (legRefund <= 0) continue
        // Preserve the single-leg key (`-seller`) so existing refunds stay
        // idempotent; multi-leg refunds key off the split leg (consignor/vendor).
        const legTag =
          sellerEntries.length > 1
            ? `-${(leg.metadata as { split_leg?: string } | null)?.split_leg ?? i}`
            : ""
        const sellerRefundEntry = await this.createTransfer({
          debit_account_id: leg.credit_account_id, // Seller / consignor / vendor account
          credit_account_id: escrowAccount.id,
          amount: legRefund,
          entry_type: "REFUND",
          order_id: data.order_id,
          description: `${description} - seller portion${legTag}`,
          idempotency_key: `${idempotencyKey}-seller${legTag}`,
        })
        refundEntries.push(sellerRefundEntry)
      }
    }

    // 4. Reverse customer payment (Escrow → Customer)
    // Note: The actual Stripe refund should be triggered separately
    const customerRefundEntry = await this.createTransfer({
      debit_account_id: escrowAccount.id,
      credit_account_id: purchaseEntry.debit_account_id, // Customer account
      amount: refundAmount,
      entry_type: "REFUND",
      order_id: data.order_id,
      description: `${description} - customer refund`,
      idempotency_key: `${idempotencyKey}-customer`,
    })
    refundEntries.push(customerRefundEntry)

    // 4. Mark original entries as REVERSED
    for (const entry of originalEntries) {
      await this.updateLedgerEntries({
        id: entry.id,
        status: "REVERSED" as const,
        metadata: {
          ...(entry.metadata as Record<string, any> || {}),
          reversed_at: new Date().toISOString(),
          reversed_reason: data.reason,
          refund_amount: refundAmount,
        },
      })
    }

    // Audit log
    auditFinancialTransaction(
      "TRANSFER_COMPLETED",
      "SYSTEM",
      "SYSTEM",
      data.order_id,
      refundAmount,
      {
        type: "REFUND",
        seller_refund: sellerRefund,
        fee_refund: feeRefund,
        reason: data.reason,
        entries_created: refundEntries.length,
        entries_reversed: originalEntries.length,
      }
    )

    log.info(
      `[Hawala] Refund processed for order ${data.order_id}: ` +
      `$${refundAmount} total ($${sellerRefund} from seller, $${feeRefund} fee reversal)`
    )

    return refundEntries
  }

  /**
   * Get or create producer investment pool
   */
  async getOrCreateProducerPool(producerId: string) {
    const existing = await this.listInvestmentPools({
      producer_id: producerId, status: "ACTIVE",
    })

    if (existing.length > 0) {
      return existing[0]
    }

    // Create ledger account for pool
    const poolAccount = await this.createAccount({
      account_type: "PRODUCER_POOL",
      owner_type: "PRODUCER",
      owner_id: producerId,
    })

    // Create investment pool
    return this.createInvestmentPools({
      name: `Producer Pool - ${producerId}`,
      producer_id: producerId,
      ledger_account_id: poolAccount.id,
      target_amount: 10000, // Default target
      minimum_investment: 1,
      roi_type: "REVENUE_SHARE" as const,
      revenue_share_percentage: 5,
      status: "ACTIVE" as const,
      auto_invest_enabled: true,
      auto_invest_percentage: 2,
    })
  }

  // ==================== INVESTMENT OPERATIONS ====================

  /**
   * Create a direct investment
   */
  async createInvestment(data: {
    pool_id: string
    investor_account_id: string
    customer_id?: string
    amount: number
    source?: string
    source_order_id?: string
    idempotency_key?: string
  }) {
    const pool = await this.retrieveInvestmentPool(data.pool_id)
    if (!pool) {
      throw new Error("Investment pool not found")
    }

    // A carried pool's contributions are collected by the carrier on its own
    // accounts and RECORDED here by `recordCarrierContribution`; a ledger
    // investment into it would put pool funds on BMC's books (Decision 6b).
    // Refused before any wallet is debited. (An uncarried pool with the flag
    // on is refused inside createTransfer with reason `no_carrier`.)
    this.refuseIfCarried_(pool, "createInvestment")

    // Create ledger transfer
    const entry = await this.createTransfer({
      debit_account_id: data.investor_account_id,
      credit_account_id: pool.ledger_account_id,
      amount: data.amount,
      entry_type: "INVESTMENT",
      investment_pool_id: data.pool_id,
      idempotency_key: data.idempotency_key,
    })

    // Create investment record
    const investment = await this.createInvestments({
      pool_id: data.pool_id,
      investor_account_id: data.investor_account_id,
      customer_id: data.customer_id,
      amount: data.amount,
      currency_code: "USD",
      status: "CONFIRMED" as const,
      source: (data.source || "DIRECT") as "DIRECT" | "AUTO_ORDER" | "GIFT",
      source_order_id: data.source_order_id,
      ledger_entry_id: entry.id,
      invested_at: new Date(),
    })

    // Update pool totals atomically (col = col + ?) so concurrent investments
    // don't clobber each other. Falls back to read-modify-write only when no
    // pg connection is reachable (e.g. unit tests without DI).
    const atomicallyUpdated = await this.atomicPoolIncrement(data.pool_id, {
      total_raised: data.amount,
      total_investors: 1,
    })
    if (!atomicallyUpdated) {
      await this.updateInvestmentPools({
        id: data.pool_id,
        total_raised: Number(pool.total_raised) + data.amount,
        total_investors: pool.total_investors + 1,
      })
    }

    return investment
  }

  /**
   * Distribute dividends to investors
   */
  async distributeDividends(data: {
    pool_id: string
    total_amount: number
  }) {
    const pool = await this.retrieveInvestmentPool(data.pool_id)
    if (!pool) {
      throw new Error("Investment pool not found")
    }

    // The carrier pays distributions from the funds it holds and allocates on
    // its own books; BMC records them via `recordCarrierDistribution`. There
    // is no BMC balance to pay from.
    this.refuseIfCarried_(pool, "distributeDividends")

    const investments = await this.listInvestments({
      pool_id: data.pool_id, status: "CONFIRMED",
    })

    const totalInvested = Number(pool.total_raised)
    const distributions: any[] = []

    for (const investment of investments) {
      // A CARRIER-settled row has no ledger account to pay into. It cannot
      // occur on an uncarried pool, and a carried pool was refused above; the
      // skip keeps the type honest rather than asserting it away.
      const investorAccountId = investment.investor_account_id
      if (!investorAccountId) continue

      // Calculate proportional share
      const share = Number(investment.amount) / totalInvested
      const dividend = Math.floor(data.total_amount * share * 100) / 100

      if (dividend > 0) {
        // Transfer dividend
        const _entry = await this.createTransfer({
          debit_account_id: pool.ledger_account_id,
          credit_account_id: investorAccountId,
          amount: dividend,
          entry_type: "DIVIDEND",
          investment_pool_id: data.pool_id,
          // Deterministic key so a re-run of the same distribution does not
          // double-pay. NOTE: if/when distinct distribution *rounds* are
          // introduced, fold a round/distribution id into this key so a
          // second legitimate round to the same investor isn't deduped away.
          idempotency_key: `div-${pool.id}-${investment.id}`,
        })

        // Update investment record
        await this.updateInvestments({
          id: investment.id,
          actual_return: Number(investment.actual_return) + dividend,
          return_distributed: Number(investment.return_distributed) + dividend,
        })

        distributions.push({ investment_id: investment.id, amount: dividend })
      }
    }

    // Update pool totals atomically (col = col + ?) so concurrent
    // distributions don't clobber each other. Falls back to read-modify-write
    // only when no pg connection is reachable (e.g. unit tests without DI).
    const distributedAtomically = await this.atomicPoolIncrement(data.pool_id, {
      total_distributed: data.total_amount,
    })
    if (!distributedAtomically) {
      await this.updateInvestmentPools({
        id: data.pool_id,
        total_distributed: Number(pool.total_distributed) + data.total_amount,
      })
    }

    return distributions
  }

  // ==================== NONPROFIT-CARRIED POOLS ====================
  //
  // docs/BMC_SURVIVAL_PROGRAMS.md Decision 6b; legal checkpoints L26, L11, L3.
  // A carried pool's funds are held and administered by a verified nonprofit
  // partner_org on ITS OWN accounts; BMC keeps the record and takes no custody.
  // The rules live here, in the service, because hooks and routes can be
  // bypassed (the same reasoning as posture-a-guard.ts). See `./carrier.ts`.

  /**
   * Generated create, with the carrier columns stripped. Three producers call
   * the generated method (getOrCreateProducerPool, the admin POST, the vendor
   * POST); none may set a carrier. `assignPoolCarrier` is the only writer and
   * reaches persistence through `writeCarrierColumns_`. The designation stamp
   * (Decision 8) is stripped too: only `stampLegacyFundsDesignated_` writes it.
   */
  // @ts-expect-error - override parent method (declared as a property on the generated base; same as subscription/service.ts)
  async createInvestmentPools(data: any, ...rest: any[]): Promise<any> {
    return this.persistInvestmentPools_("create", stripPoolDesignationFields(stripPoolCarrierFields(data)), rest)
  }

  /** Generated update, with the carrier columns and the designation stamp stripped (the two PATCH routes call this). */
  // @ts-expect-error - override parent method (declared as a property on the generated base; same as subscription/service.ts)
  async updateInvestmentPools(data: any, ...rest: any[]): Promise<any> {
    return this.persistInvestmentPools_("update", stripPoolDesignationFields(stripPoolCarrierFields(data)), rest)
  }

  /**
   * The one path to the generated persistence for pools. Named so a spec can
   * shadow exactly this and prove the strip above ran on the real prototype.
   */
  private persistInvestmentPools_(op: "create" | "update", data: any, rest: any[]): Promise<any> {
    return op === "create"
      ? super.createInvestmentPools(data, ...rest)
      : super.updateInvestmentPools(data, ...rest)
  }

  /** The only writer of `carrier_org_key` / `carrier_snapshot`. Private on purpose. */
  private writeCarrierColumns_(poolId: string, carrier: { carrier_org_key: string; carrier_snapshot: PoolCarrierSnapshot }) {
    return this.persistInvestmentPools_("update", { id: poolId, ...carrier }, [])
  }

  private refuseIfCarried_(pool: { id: string; carrier_org_key?: string | null }, operation: string): void {
    if (!isCarriedPool(pool)) return
    throw new CarrierRefusalError(
      "carried_pool",
      `${operation} refused: pool ${pool.id} is carried by ${pool.carrier_org_key}; its funds are held by the carrier, never on BMC's ledger.`,
      { pool_id: pool.id, carrier_org_key: pool.carrier_org_key, operation }
    )
  }

  private async requirePool_(poolId: string) {
    const [pool] = await this.listInvestmentPools({ id: poolId })
    if (!pool) throw new Error("Investment pool not found")
    return pool
  }

  private requireParityFlag_(operation: string): void {
    if (featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) return
    throw new CarrierRefusalError(
      "feature_disabled",
      `${operation} is dark: FF_NONPROFIT_PARITY_V1 is not enabled.`,
      { operation }
    )
  }

  /**
   * createTransfer's pool rule. Resolves the pool by `investment_pool_id`, or
   * by either account when it is a PRODUCER_POOL account a pool owns (the
   * refund reversal names no pool id). A leg that names a pool id no pool has
   * is a pool leg with no carrier. With the flag off and no pool involved
   * this reads nothing: every existing non-pool path is byte-identical.
   *
   * Designated legacy funds (Decision 8, `./designated.ts`), flag on, an
   * UNCARRIED pool whose own account holds a positive balance: a leg whose
   * DEBIT is that account (money leaving) and whose CREDIT is a contributor's
   * account is allowed — the wallet of an investor who holds a LEDGER
   * investment in THIS pool (`returnDesignatedFunds`, dividends), or the
   * system order escrow (`processRefund`'s Pool -> Escrow reversal). It
   * returns the pool, which `createTransfer` stamps
   * (`legacy_funds_designated_at`) once the leg has COMPLETED. Any other
   * destination — SELLER_EARNINGS, a stranger's wallet, a per-entity escrow
   * (subcontract, campaign: a two-hop route to earnings), PLATFORM_FEE,
   * RESERVE — is refused `designated_outbound_only`. A credit INTO the pool
   * stays `no_carrier`, as does every leg on a zero-balance uncarried pool.
   * Carried pools and orphan pool accounts are unchanged; flag off is
   * unchanged (and always returns null).
   */
  private async assertPoolLegAllowed_(
    data: { investment_pool_id?: string; debit_account_id: string; credit_account_id: string },
    debitAccount: { id: string; account_type?: string | null; balance?: unknown },
    creditAccount: { id: string; account_type?: string | null; owner_type?: string | null; owner_id?: string | null }
  ): Promise<{ id: string; legacy_funds_designated_at?: Date | string | null } | null> {
    let pool: {
      id: string
      carrier_org_key?: string | null
      ledger_account_id?: string | null
      legacy_funds_designated_at?: Date | string | null
    } | null = null
    let named = false
    if (data.investment_pool_id) {
      named = true
      const [byId] = await this.listInvestmentPools({ id: data.investment_pool_id })
      pool = byId ?? null
    }
    const poolAccountIds = [debitAccount, creditAccount]
      .filter((a) => a.account_type === "PRODUCER_POOL")
      .map((a) => a.id)
    if (!pool && poolAccountIds.length > 0) {
      const [byAccount] = await this.listInvestmentPools({ ledger_account_id: poolAccountIds })
      pool = byAccount ?? null
    }
    if (!pool && !named) {
      // A PRODUCER_POOL account no pool row owns (minted by the admin/vendor
      // pools POST before the pool insert failed, or via createAccount
      // directly) is still the custody shape: with the flag on it has no
      // carrier, so it cannot accept or release money either. Flag off: the
      // leg passes exactly as before.
      if (poolAccountIds.length > 0 && featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) {
        throw new CarrierRefusalError(
          "no_carrier",
          `ledger leg refused: PRODUCER_POOL account ${poolAccountIds.join(", ")} is owned by no pool and so has no carrier; a pool account with no carrier cannot accept money.`,
          { pool_id: null, investment_pool_id: null, pool_account_ids: poolAccountIds }
        )
      }
      return null
    }

    if (pool && isCarriedPool(pool)) {
      throw new CarrierRefusalError(
        "carried_pool",
        `ledger leg refused: pool ${pool.id} is carried by ${pool.carrier_org_key}; BMC never holds pool funds.`,
        { pool_id: pool.id, carrier_org_key: pool.carrier_org_key, investment_pool_id: data.investment_pool_id ?? null }
      )
    }
    if (featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) {
      // Decision 8: money already in an uncarried pool's own account is
      // designated — it may leave only back to the contributors. Only the
      // pool's OWN account counts (a leg naming pool A while debiting pool B's
      // account is not A's designated outflow), and only while it holds a
      // positive balance (nothing to designate otherwise).
      const designatedOutflow =
        pool !== null &&
        typeof pool.ledger_account_id === "string" &&
        data.debit_account_id === pool.ledger_account_id &&
        data.credit_account_id !== pool.ledger_account_id &&
        hasDesignatedBalance(debitAccount)
      if (pool && designatedOutflow) {
        if (await this.isDesignatedContributorAccount_(pool.id, creditAccount)) return pool
        throw new CarrierRefusalError(
          "designated_outbound_only",
          `ledger leg refused: pool ${pool.id} holds legacy ledger funds in a designated account; they may only return to the contributors (the wallet of an investor in this pool, or the system order escrow), never to ${creditAccount.account_type ?? "unknown"} account ${creditAccount.id}.`,
          {
            pool_id: pool.id,
            investment_pool_id: data.investment_pool_id ?? null,
            credit_account_type: creditAccount.account_type ?? null,
          }
        )
      }
      throw new CarrierRefusalError(
        "no_carrier",
        `ledger leg refused: pool ${pool?.id ?? data.investment_pool_id} has no carrier, and a pool with no carrier cannot accept money.`,
        { pool_id: pool?.id ?? null, investment_pool_id: data.investment_pool_id ?? null }
      )
    }
    return null
  }

  /**
   * Is this a contributor's account a designated pool may pay back into
   * (Decision 8)? The account TYPE alone is not enough: any USER_WALLET would
   * let the money leave to a stranger, and any ESCROW includes the per-entity
   * subcontract / campaign / sponsorship escrows that release into
   * SELLER_EARNINGS — a two-hop route around `designated_outbound_only`. So:
   * a USER_WALLET only when it is the `investor_account_id` of a LEDGER
   * investment in this pool; an ESCROW only when it is the system order
   * escrow (owner SYSTEM / "system"), which is where `processRefund`'s
   * reversal goes.
   */
  private async isDesignatedContributorAccount_(
    poolId: string,
    account: { id: string; account_type?: string | null; owner_type?: string | null; owner_id?: string | null }
  ): Promise<boolean> {
    if (!isDesignatedReturnAccountType(account.account_type)) return false
    if (account.account_type === "ESCROW") return isSystemEscrowAccount(account)
    const [investor] = await this.listInvestments({ pool_id: poolId, investor_account_id: account.id, settlement: "LEDGER" })
    return Boolean(investor)
  }

  /**
   * Date the first designated outflow that actually COMPLETED (Decision 8):
   * `createTransfer` calls this after the balances moved and the entry was
   * flipped to COMPLETED, never from the guard, so a leg the guard allowed but
   * a later check refused (cross-rail, rail invariants, balance) never stamps.
   * Reporting only: the direction rule reads the balance, never this column,
   * so a failure here is logged and never fails the (already completed) leg.
   * Write-once from this path (the generated create/update strip the column);
   * two legs in the same instant can both see it unset and both write, which
   * moves the date by that instant and nothing else.
   */
  private async stampLegacyFundsDesignated_(pool: { id: string; legacy_funds_designated_at?: Date | string | null }): Promise<void> {
    if (pool.legacy_funds_designated_at) return
    try {
      await this.persistInvestmentPools_("update", { id: pool.id, legacy_funds_designated_at: new Date() }, [])
    } catch (error) {
      log.warn(
        `[Hawala] could not stamp legacy_funds_designated_at on pool ${pool.id}: ${(error as Error)?.message ?? error}`
      )
    }
  }

  /**
   * The designated-funds report (Decision 8): every UNCARRIED pool that is
   * stamped or whose account still holds a positive balance, with that
   * balance, the sum of its outstanding LEDGER-settled investments, the count
   * `returnDesignatedFunds` can send back, and the delta between them (the
   * pre-existing counter drift makes it non-zero in general — surfaced, not
   * hidden). Integer cents underneath. Dark with the flag off: a read that
   * publishes is gated like the writes.
   */
  async listDesignatedPoolFunds(): Promise<DesignatedPoolFundsReport> {
    this.requireParityFlag_("listDesignatedPoolFunds")
    const pools = (await this.listInvestmentPools({})).filter((p) => !isCarriedPool(p))
    const accountIds = pools
      .map((p) => p.ledger_account_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
    const accounts = accountIds.length > 0 ? await this.listLedgerAccounts({ id: accountIds }) : []
    const accountById = new Map(accounts.map((a) => [a.id, a]))

    const designated = pools.filter(
      (p) => Boolean(p.legacy_funds_designated_at) || hasDesignatedBalance(accountById.get(p.ledger_account_id))
    )
    if (designated.length === 0) return { pools: [], totals: totalDesignatedPoolFunds([]) }

    const ledgerRows = await this.listInvestments({ pool_id: designated.map((p) => p.id), settlement: "LEDGER" })
    const rowsByPool = new Map<string, typeof ledgerRows>()
    for (const row of ledgerRows) {
      const list = rowsByPool.get(row.pool_id) ?? []
      list.push(row)
      rowsByPool.set(row.pool_id, list)
    }
    const lines = designated.map((p) =>
      summariseDesignatedPool(p, accountById.get(p.ledger_account_id), rowsByPool.get(p.id) ?? [])
    )
    return { pools: lines, totals: totalDesignatedPoolFunds(lines) }
  }

  /**
   * The wind-down primitive (Decision 8): return ONE legacy LEDGER investment
   * from its uncarried pool's designated account to the investor's own
   * account (`investment.investor_account_id`), as a REFUND leg keyed
   * `designated-return-${investment.id}` — derived from the record, never the
   * attempt — then mark the investment WITHDRAWN. Money first, record second.
   *
   *   - `feature_disabled` with the flag off, before any read;
   *   - "Investment pool not found" / "Investment not found" (the investment
   *     must belong to the named pool);
   *   - `carried_pool` for a carried pool, `not_ledger_investment` for a
   *     CARRIER row (or a LEDGER row with no account) — nothing of either is
   *     on BMC's ledger;
   *   - idempotent, and `returned` / `already_returned` ONLY on a COMPLETED
   *     entry under the key — the one state in which the money is known to
   *     have moved. A COMPLETED prior return answers `{ returned: false,
   *     reason: "already_returned" }` (repairing the WITHDRAWN mark if a crash
   *     fell between money and record). Every other entry under the key is
   *     `designated_return_unsettled` and the investment stays CONFIRMED: a
   *     FAILED one (this call's own leg, which createTransfer marks FAILED
   *     when the balance move throws, or an earlier attempt's) is never
   *     re-attempted under that key; a PENDING one is a concurrent return in
   *     flight — whether this call lost on the ledger's unique idempotency key
   *     or was handed that entry by createTransfer's own idempotency read —
   *     and a retry reads its outcome. The money moves once in every case,
   *     because the key is unique on hawala_ledger_entry;
   *   - `investment_not_confirmed` for any other status;
   *   - `insufficient_designated_balance` when the account cannot cover it.
   *
   * The leg itself still passes `createTransfer`'s guard, so the direction
   * rule applies here too: an investor account that is not a USER_WALLET is
   * refused `designated_outbound_only`. No automatic sweep; no Stripe payout
   * (the investor's wallet exit is the existing payout path). The pool's
   * historical counters (total_raised / total_investors) are not touched —
   * they are pre-existing counters, not derivations.
   */
  async returnDesignatedFunds(poolId: string, investmentId: string, input: { returned_by?: string | null } = {}) {
    this.requireParityFlag_("returnDesignatedFunds")
    const pool = await this.requirePool_(poolId)
    this.refuseIfCarried_(pool, "returnDesignatedFunds")
    const [investment] = await this.listInvestments({ id: investmentId, pool_id: poolId })
    if (!investment) throw new Error("Investment not found")
    if (investment.settlement === "CARRIER" || !investment.investor_account_id) {
      throw new CarrierRefusalError(
        "not_ledger_investment",
        `investment ${investmentId} is a ${investment.settlement} record with no ledger account; there is nothing on BMC's ledger to return.`,
        { pool_id: poolId, investment_id: investmentId, settlement: investment.settlement }
      )
    }
    const investorAccountId = investment.investor_account_id

    const key = designatedReturnKey(investment.id)
    const markWithdrawn = (entryId: string) =>
      this.updateInvestments({
        id: investment.id,
        status: "WITHDRAWN" as const,
        withdrawn_at: new Date(),
        metadata: {
          ...((investment.metadata as Record<string, unknown> | null) ?? {}),
          designated_return_entry_id: entryId,
          returned_by: input.returned_by ?? null,
        },
      })

    // The money is known to have moved only when the entry under the key is
    // COMPLETED. Anything else is refused and the investment stays CONFIRMED
    // (money first, record second): a PENDING entry is a return in flight
    // (retry to read its outcome); a FAILED one never moved money and is
    // never re-attempted under the same key (reconcile it by hand).
    const unsettled = (found: { id: string; status?: unknown }, cause?: unknown) =>
      new CarrierRefusalError(
        "designated_return_unsettled",
        found.status === "PENDING"
          ? `a return of investment ${investmentId} (entry ${found.id}) is still PENDING — another return of it is in flight; retry to read its outcome. It is never re-attempted under the same key.`
          : `a return of investment ${investmentId} (entry ${found.id}) is ${String(found.status)}, so the money is not known to have moved; it is never re-attempted under the same key — reconcile it by hand.`,
        {
          pool_id: poolId,
          investment_id: investmentId,
          entry_id: found.id,
          entry_status: found.status ?? null,
          ...(cause !== undefined ? { cause: cause instanceof Error ? cause.message : String(cause) } : {}),
        }
      )

    const [prior] = await this.listLedgerEntries({ idempotency_key: key })
    if (prior) {
      if (prior.status !== "COMPLETED") throw unsettled(prior)
      if (investment.status !== "WITHDRAWN") await markWithdrawn(prior.id)
      return { returned: false as const, reason: "already_returned" as const, investment_id: investment.id, entry_id: prior.id }
    }

    if (investment.status !== "CONFIRMED") {
      throw new CarrierRefusalError(
        "investment_not_confirmed",
        `investment ${investmentId} is ${investment.status}; only a CONFIRMED ledger investment is returned from a designated account.`,
        { pool_id: poolId, investment_id: investmentId, status: investment.status }
      )
    }

    const amountCents = toCents(investment.amount)
    const [account] = pool.ledger_account_id ? await this.listLedgerAccounts({ id: pool.ledger_account_id }) : []
    const availableCents = toCents(account?.available_balance)
    if (!account || amountCents <= 0 || availableCents < amountCents) {
      throw new CarrierRefusalError(
        "insufficient_designated_balance",
        `pool ${poolId}'s designated account holds ${availableCents / 100}; investment ${investmentId} is ${amountCents / 100}.`,
        { pool_id: poolId, investment_id: investmentId, available_balance: availableCents / 100, amount: amountCents / 100 }
      )
    }

    let entry
    try {
      entry = await this.createTransfer({
        debit_account_id: pool.ledger_account_id,
        credit_account_id: investorAccountId,
        amount: amountCents / 100,
        entry_type: "REFUND",
        investment_pool_id: pool.id,
        idempotency_key: key,
        description: `Designated return of investment ${investment.id} from pool ${pool.id} (Decision 8 wind-down)`,
        metadata: { designated_return: true, pool_id: pool.id, investment_id: investment.id },
      })
    } catch (error) {
      // Either a concurrent return won the ledger's unique idempotency key,
      // or this call's own leg failed after its PENDING entry was written
      // (createTransfer marks it FAILED and rethrows). Only a COMPLETED entry
      // means the money moved.
      const [raced] = await this.listLedgerEntries({ idempotency_key: key })
      if (!raced) throw error
      if (raced.status !== "COMPLETED") throw unsettled(raced, error)
      // The winner marks it; repair the mark only if it has not landed (the
      // read above is stale), so the winner's operator stays on the record.
      const [current] = await this.listInvestments({ id: investment.id })
      if (current?.status !== "WITHDRAWN") await markWithdrawn(raced.id)
      return { returned: false as const, reason: "already_returned" as const, investment_id: investment.id, entry_id: raced.id }
    }

    // createTransfer's own idempotency read can hand back a concurrent
    // caller's entry that has not settled yet; only COMPLETED is a return.
    if (entry.status !== "COMPLETED") throw unsettled(entry)
    const updated = await markWithdrawn(entry.id)
    return { returned: true as const, investment: updated, entry }
  }

  /**
   * Assign a verified nonprofit carrier to a pool. The admin route resolved
   * the directory, ran `partnerOrgCarrierRefusal` and built `snapshot`; this
   * validates the snapshot's shape (never trusting an unverified status) and
   * refuses:
   *
   *   - `feature_disabled` with FF_NONPROFIT_PARITY_V1 off;
   *   - `pool_has_ledger_funds` when the pool has any custody: total_raised,
   *     a non-zero ledger account balance, or a LEDGER-settled Investment row
   *     (a custody pool with funds in it cannot be relabelled as carried);
   *   - `pool_has_carrier_records` when changing the carrier of a pool that
   *     already has CARRIER-settled rows (re-freezing the SAME carrier's
   *     snapshot is allowed — that is how a newer IRS date lands).
   *
   * The pool keeps its existing `ledger_account_id`: zero-balance, dormant,
   * and unusable because createTransfer refuses every leg against it.
   */
  async assignPoolCarrier(poolId: string, snapshot: unknown) {
    this.requireParityFlag_("assignPoolCarrier")
    const carrier = assertCarrierSnapshot(snapshot)
    const pool = await this.requirePool_(poolId)

    const [ledgerRows, carrierRows, distributions, accounts] = await Promise.all([
      this.listInvestments({ pool_id: poolId, settlement: "LEDGER" }),
      this.listInvestments({ pool_id: poolId, settlement: "CARRIER" }),
      this.listPoolCarrierDistributions({ pool_id: poolId }),
      pool.ledger_account_id ? this.listLedgerAccounts({ id: pool.ledger_account_id }) : Promise.resolve([]),
    ])

    const account = accounts[0]
    const accountBalance = account ? Number(account.balance) + Number(account.pending_balance ?? 0) : 0
    if (Number(pool.total_raised) !== 0 || accountBalance !== 0 || ledgerRows.length > 0) {
      throw new CarrierRefusalError(
        "pool_has_ledger_funds",
        `pool ${poolId} holds funds on BMC's ledger (total_raised ${Number(pool.total_raised)}, account balance ${accountBalance}, ${ledgerRows.length} ledger-settled investments); a custody pool cannot be relabelled as carried.`,
        { pool_id: poolId, total_raised: Number(pool.total_raised), account_balance: accountBalance, ledger_investments: ledgerRows.length }
      )
    }

    const hasCarrierRecords = carrierRows.length > 0 || distributions.length > 0
    if (hasCarrierRecords && pool.carrier_org_key !== carrier.org_key) {
      throw new CarrierRefusalError(
        "pool_has_carrier_records",
        `pool ${poolId} already has records under carrier ${pool.carrier_org_key}; the carrier cannot change.`,
        { pool_id: poolId, carrier_org_key: pool.carrier_org_key, requested_org_key: carrier.org_key }
      )
    }

    const updated = await this.writeCarrierColumns_(poolId, {
      carrier_org_key: carrier.org_key,
      carrier_snapshot: carrier,
    })
    return Array.isArray(updated) ? updated[0] : updated
  }

  /**
   * Derive a carried pool's totals from its records and write them. Never
   * `atomicPoolIncrement`, never `+=`: for a carried pool these rows are the
   * ONLY record (no ledger balance to reconcile against), so the totals are a
   * function of the rows. `total_investors` counts distinct contributors —
   * `customer_id` when known, else the carrier's reference.
   */
  private async recomputeCarriedPoolTotals_(poolId: string) {
    // CONFIRMED rows only (Decision 7): a PENDING row is an intent the
    // processor has not yet confirmed, a CANCELLED row failed or was reversed.
    // Neither is money the carrier holds.
    const [confirmed, distributions] = await Promise.all([
      this.listInvestments({ pool_id: poolId, settlement: "CARRIER", status: "CONFIRMED" }),
      this.listPoolCarrierDistributions({ pool_id: poolId }),
    ])
    // A reversed row is never money the carrier holds, whatever its status
    // says (the transitions keep the two apart; this keeps the totals honest
    // even if a row were ever written around them).
    const rows = confirmed.filter((r) => !r.reversed_at)
    const contributors = new Set<string>()
    for (const row of rows) contributors.add(row.customer_id ? `customer:${row.customer_id}` : `ref:${row.carrier_reference}`)
    const totals = {
      total_raised: sumMajorUnits(rows.map((r) => r.amount)),
      total_investors: contributors.size,
      total_distributed: sumMajorUnits(distributions.map((d) => d.amount)),
    }
    await this.updateInvestmentPools({ id: poolId, ...totals })
    return totals
  }

  private assertCarrierRecordInput_(input: { amount: unknown; carrier_reference: unknown }): void {
    if (!isValidCarrierAmount(input.amount)) {
      throw new CarrierRefusalError(
        "invalid_carrier_record",
        `amount must be a positive, finite major-unit amount with at most two decimals; got ${String(input.amount)}.`,
        { amount: input.amount }
      )
    }
    if (typeof input.carrier_reference !== "string" || input.carrier_reference.trim().length === 0) {
      throw new CarrierRefusalError(
        "invalid_carrier_record",
        "carrier_reference is required: the record is keyed by the carrier's own reference, never by the attempt.",
        {}
      )
    }
  }

  /**
   * RECORD a contribution the carrier received on its own accounts. Writes an
   * Investment row { settlement CARRIER, investor_account_id null,
   * ledger_entry_id null, source DIRECT } under the partial unique index on
   * (pool_id, carrier_reference); a duplicate reference — a replay or a
   * concurrent second call — answers `already_recorded` after a re-read (the
   * index is the arbiter, as in collective-campaign's
   * recordParticipantContribution). No ledger leg, no account touched; totals
   * are then derived from the rows. `amount` is in the table's own unit
   * (major units).
   *
   * `status` (Decision 7): CONFIRMED — the default, what the admin route
   * records when the carrier has already received the money — counts toward
   * the pool's totals at once. PENDING is what the store checkout writes
   * after minting the intent on the carrier's account: the money has not
   * moved yet, so the row counts for nothing until the Connect webhook
   * promotes it with `confirmCarrierContribution` (Stripe's amount), cancels
   * it with `failCarrierContribution`, or — after a full refund, whether or
   * not its success arrived first — closes it for good with
   * `reverseCarrierContribution`.
   */
  async recordCarrierContribution(input: {
    pool_id: string
    amount: number
    carrier_reference: string
    customer_id?: string | null
    status?: "PENDING" | "CONFIRMED"
    metadata?: Record<string, unknown> | null
  }) {
    this.requireParityFlag_("recordCarrierContribution")
    this.assertCarrierRecordInput_(input)
    const status = input.status ?? "CONFIRMED"
    if (status !== "PENDING" && status !== "CONFIRMED") {
      throw new CarrierRefusalError(
        "invalid_carrier_record",
        `status must be PENDING or CONFIRMED; got ${String(input.status)}.`,
        { status: input.status }
      )
    }
    const pool = await this.requirePool_(input.pool_id)
    if (!isCarriedPool(pool)) {
      throw new CarrierRefusalError(
        "no_carrier",
        `pool ${input.pool_id} has no carrier; a carrier contribution can only be recorded on a carried pool.`,
        { pool_id: input.pool_id }
      )
    }
    const reference = input.carrier_reference.trim()
    const keyFilter = { pool_id: input.pool_id, carrier_reference: reference }

    const [seen] = await this.listInvestments(keyFilter)
    if (seen) {
      return { recorded: false as const, reason: "already_recorded" as const, investment_id: seen.id }
    }

    let investment
    try {
      investment = await this.createInvestments({
        pool_id: input.pool_id,
        investor_account_id: null,
        customer_id: input.customer_id ?? null,
        amount: input.amount,
        currency_code: "USD",
        status,
        source: "DIRECT" as const,
        ledger_entry_id: null,
        settlement: "CARRIER" as const,
        carrier_org_key: pool.carrier_org_key as string,
        carrier_reference: reference,
        reversed_at: null,
        invested_at: new Date(),
        metadata: input.metadata ?? null,
      })
    } catch (error) {
      // Two calls passed the read above; the unique index decided. If the row
      // exists now the other call won; otherwise this was a real failure.
      const [raced] = await this.listInvestments(keyFilter)
      if (raced) {
        return { recorded: false as const, reason: "already_recorded" as const, investment_id: raced.id }
      }
      throw error
    }

    const totals = await this.recomputeCarriedPoolTotals_(input.pool_id)
    return { recorded: true as const, investment, totals }
  }

  /**
   * The CARRIER row a carrier reference names on a carried pool, after the
   * same preconditions every carrier record has: flag on, a usable reference,
   * an existing carried pool. Null when no row carries that reference.
   */
  private async findCarrierContribution_(operation: string, poolId: string, carrierReference: unknown) {
    this.requireParityFlag_(operation)
    if (typeof carrierReference !== "string" || carrierReference.trim().length === 0) {
      throw new CarrierRefusalError(
        "invalid_carrier_record",
        "carrier_reference is required: the record is keyed by the carrier's own reference, never by the attempt.",
        { operation }
      )
    }
    const pool = await this.requirePool_(poolId)
    if (!isCarriedPool(pool)) {
      throw new CarrierRefusalError(
        "no_carrier",
        `pool ${poolId} has no carrier; ${operation} applies to carried pools only.`,
        { pool_id: poolId, operation }
      )
    }
    const [row] = await this.listInvestments({ pool_id: poolId, carrier_reference: carrierReference.trim(), settlement: "CARRIER" })
    return { pool, row: row ?? null }
  }

  /** Re-read one investment row by id (after a conditional transition). */
  private async rereadInvestment_(investmentId: string) {
    const [row] = await this.listInvestments({ id: investmentId })
    return row ?? null
  }

  /**
   * One CARRIER-row lifecycle transition (Decision 7) as a single conditional
   * UPDATE, so two processor events racing on the same intent cannot both
   * read PENDING and let whichever write lands last decide (a paid
   * contribution ending CANCELLED, or a refunded one re-confirmed): the
   * predicate — CARRIER, `status IN from`, not yet reversed — is re-checked by
   * the database at write time and exactly one matching writer succeeds.
   * Returns true when this call's write landed, false when the predicate no
   * longer held. The `casApproveOrgAdvance_` pattern: only `status` and
   * `reversed_at` (plain columns, never the bigNumber `amount`), column names
   * fixed, every value bound. With no pg connection reachable (unit tests
   * without DI) it falls back to the generated `{ selector, data }` update,
   * which is NOT atomic on a real database.
   */
  private async transitionCarrierRow_(
    investmentId: string,
    from: ReadonlyArray<"PENDING" | "CONFIRMED" | "CANCELLED">,
    to: { status: "CONFIRMED" | "CANCELLED"; reversed_at?: Date | null }
  ): Promise<boolean> {
    const reversedAt = to.reversed_at ?? null
    const pg = this.resolvePgConnection()
    if (pg) {
      const placeholders = from.map(() => "?").join(", ")
      const result = await pg.raw(
        `UPDATE hawala_investment
            SET status = ?, reversed_at = ?, updated_at = NOW()
          WHERE id = ? AND settlement = 'CARRIER' AND status IN (${placeholders}) AND reversed_at IS NULL AND deleted_at IS NULL
          RETURNING id`,
        [to.status, reversedAt, investmentId, ...from]
      )
      return Number(result?.rowCount ?? result?.rows?.length ?? 0) > 0
    }
    const updated = await this.updateInvestments({
      selector: { id: investmentId, settlement: "CARRIER" as const, status: [...from], reversed_at: null },
      data: { status: to.status, reversed_at: reversedAt },
    })
    return (Array.isArray(updated) ? updated : [updated]).filter(Boolean).length > 0
  }

  /**
   * The processor confirmed the contribution (Decision 7: `payment_intent.
   * succeeded` on the carrier's account). PENDING → CONFIRMED, and the amount
   * becomes the PROCESSOR's figure — Stripe's statement of what moved, never
   * the metadata the checkout stamped. A CANCELLED row whose intent later
   * succeeded (a failed attempt, then a good card on the same intent) is
   * confirmed too, exactly as a failed donation record recovers; a REVERSED
   * row is terminal (`already_reversed`) — including one a full refund closed
   * before this success arrived (Stripe does not order events). Idempotent: a
   * replay on a CONFIRMED row is `already_confirmed` and writes nothing.
   *
   * Stripe's figure is written FIRST (amount / customer / metadata — never
   * the status), then the status moves through `transitionCarrierRow_`: a
   * crash between the two leaves a PENDING row a retry confirms, never a
   * CONFIRMED row stuck on the checkout's amount; and a concurrent refund or
   * failure is settled by the conditional transition, not by write order.
   * Totals are re-derived.
   */
  async confirmCarrierContribution(
    poolId: string,
    carrierReference: string,
    input: { amount_from_processor: number; customer_id?: string | null; metadata?: Record<string, unknown> | null }
  ) {
    const { row } = await this.findCarrierContribution_("confirmCarrierContribution", poolId, carrierReference)
    if (!isValidCarrierAmount(input.amount_from_processor)) {
      throw new CarrierRefusalError(
        "invalid_carrier_record",
        `amount_from_processor must be a positive, finite major-unit amount with at most two decimals; got ${String(input.amount_from_processor)}.`,
        { amount_from_processor: input.amount_from_processor }
      )
    }
    if (!row) return { confirmed: false as const, reason: "not_recorded" as const }
    if (row.reversed_at) return { confirmed: false as const, reason: "already_reversed" as const, investment_id: row.id }
    if (row.status === "CONFIRMED") return { confirmed: false as const, reason: "already_confirmed" as const, investment_id: row.id }

    await this.updateInvestments({
      id: row.id,
      amount: input.amount_from_processor,
      customer_id: row.customer_id ?? input.customer_id ?? null,
      metadata: { ...((row.metadata as Record<string, unknown> | null) ?? {}), ...(input.metadata ?? {}) },
    })
    const won = await this.transitionCarrierRow_(row.id, ["PENDING", "CANCELLED"], { status: "CONFIRMED" })
    if (!won) {
      // Another event moved the row between the read and the write.
      const current = await this.rereadInvestment_(row.id)
      return current?.reversed_at
        ? { confirmed: false as const, reason: "already_reversed" as const, investment_id: row.id }
        : { confirmed: false as const, reason: "already_confirmed" as const, investment_id: row.id }
    }
    const investment = await this.rereadInvestment_(row.id)
    const totals = await this.recomputeCarriedPoolTotals_(poolId)
    return { confirmed: true as const, investment, totals }
  }

  /**
   * The processor reported the intent failed (`payment_intent.payment_failed`).
   * PENDING → CANCELLED; nothing was ever counted, so the totals do not move.
   * A late failure cannot un-confirm a CONFIRMED row (`already_confirmed`) —
   * not even one confirmed concurrently, because the transition only fires
   * while the row is still PENDING — and a second failure is
   * `already_cancelled`.
   */
  async failCarrierContribution(poolId: string, carrierReference: string) {
    const { row } = await this.findCarrierContribution_("failCarrierContribution", poolId, carrierReference)
    if (!row) return { failed: false as const, reason: "not_recorded" as const }
    if (row.status === "CONFIRMED") return { failed: false as const, reason: "already_confirmed" as const, investment_id: row.id }
    if (row.status !== "PENDING" || row.reversed_at) return { failed: false as const, reason: "already_cancelled" as const, investment_id: row.id }
    const won = await this.transitionCarrierRow_(row.id, ["PENDING"], { status: "CANCELLED" })
    if (!won) {
      const current = await this.rereadInvestment_(row.id)
      return current?.status === "CONFIRMED"
        ? { failed: false as const, reason: "already_confirmed" as const, investment_id: row.id }
        : { failed: false as const, reason: "already_cancelled" as const, investment_id: row.id }
    }
    const investment = await this.rereadInvestment_(row.id)
    return { failed: true as const, investment }
  }

  /**
   * The processor fully refunded the contribution on the carrier's account
   * (`charge.refunded` covering the gross). The row becomes CANCELLED with
   * `reversed_at` set — terminal from ANY status: a refund means the charge
   * succeeded and the money went back, so a PENDING or CANCELLED row (whose
   * success event has not arrived yet, or arrived out of order after a
   * failure) is closed too, and a success delivered later answers
   * `already_reversed` instead of confirming money the carrier returned —
   * the donation path treats `refunded` as terminal the same way.
   * `was_confirmed` says whether the row had been counted when it was read
   * (`false` is what the S14 draft answered as `not_confirmed` and left
   * open); the totals are re-derived either way, so the contribution leaves
   * them exactly once. A second full refund is `already_reversed`. This is a
   * RECORD of what the carrier's processor did; BMC moves nothing and never
   * calls `processRefund` here.
   */
  async reverseCarrierContribution(poolId: string, carrierReference: string, input: { reversed_at?: Date | null } = {}) {
    const { row } = await this.findCarrierContribution_("reverseCarrierContribution", poolId, carrierReference)
    if (!row) return { reversed: false as const, reason: "not_recorded" as const }
    if (row.reversed_at) return { reversed: false as const, reason: "already_reversed" as const, investment_id: row.id }
    const won = await this.transitionCarrierRow_(row.id, ["PENDING", "CONFIRMED", "CANCELLED"], {
      status: "CANCELLED",
      reversed_at: input.reversed_at ?? new Date(),
    })
    if (!won) return { reversed: false as const, reason: "already_reversed" as const, investment_id: row.id }
    const investment = await this.rereadInvestment_(row.id)
    const totals = await this.recomputeCarriedPoolTotals_(poolId)
    return { reversed: true as const, was_confirmed: row.status === "CONFIRMED", investment, totals }
  }

  /**
   * RECORD a distribution the carrier paid from the funds it holds. A row in
   * hawala_pool_carrier_distribution under the same partial unique index;
   * `total_distributed` is derived from these rows. BMC computes no
   * per-investor allocation — the carrier allocates on its own books. This is
   * a record, not a payment.
   */
  async recordCarrierDistribution(input: {
    pool_id: string
    amount: number
    carrier_reference: string
    distributed_at?: Date | null
    metadata?: Record<string, unknown> | null
  }) {
    this.requireParityFlag_("recordCarrierDistribution")
    this.assertCarrierRecordInput_(input)
    const pool = await this.requirePool_(input.pool_id)
    if (!isCarriedPool(pool)) {
      throw new CarrierRefusalError(
        "no_carrier",
        `pool ${input.pool_id} has no carrier; a carrier distribution can only be recorded on a carried pool.`,
        { pool_id: input.pool_id }
      )
    }
    const reference = input.carrier_reference.trim()
    const keyFilter = { pool_id: input.pool_id, carrier_reference: reference }

    const [seen] = await this.listPoolCarrierDistributions(keyFilter)
    if (seen) {
      return { recorded: false as const, reason: "already_recorded" as const, distribution_id: seen.id }
    }

    let distribution
    try {
      distribution = await this.createPoolCarrierDistributions({
        pool_id: input.pool_id,
        carrier_org_key: pool.carrier_org_key as string,
        carrier_reference: reference,
        amount: input.amount,
        distributed_at: input.distributed_at ?? new Date(),
        metadata: input.metadata ?? null,
      })
    } catch (error) {
      const [raced] = await this.listPoolCarrierDistributions(keyFilter)
      if (raced) {
        return { recorded: false as const, reason: "already_recorded" as const, distribution_id: raced.id }
      }
      throw error
    }

    const totals = await this.recomputeCarriedPoolTotals_(input.pool_id)
    return { recorded: true as const, distribution, totals }
  }

  // ==================== BALANCE QUERIES ====================

  /**
   * Get account balance with details
   */
  async getAccountBalance(accountId: string) {
    const account = await this.retrieveLedgerAccount(accountId)
    if (!account) {
      throw new Error("Account not found")
    }

    return {
      account_number: account.account_number,
      balance: Number(account.balance),
      pending_balance: Number(account.pending_balance),
      available_balance: Number(account.available_balance),
      currency_code: account.currency_code,
    }
  }

  /**
   * Get balances for multiple accounts in a single query
   *
   * OPTIMIZED: Batch fetch to avoid N+1 queries when displaying pools
   */
  async getAccountBalancesBatch(accountIds: string[]): Promise<Map<string, {
    account_number: string
    balance: number
    pending_balance: number
    available_balance: number
    currency_code: string
  }>> {
    if (accountIds.length === 0) {
      return new Map()
    }

    // Fetch all accounts in one query using id filter with array
    const accounts = await this.listLedgerAccounts({
      id: accountIds,
    })

    const balanceMap = new Map()
    for (const account of accounts) {
      balanceMap.set(account.id, {
        account_number: account.account_number,
        balance: Number(account.balance),
        pending_balance: Number(account.pending_balance),
        available_balance: Number(account.available_balance),
        currency_code: account.currency_code,
      })
    }

    return balanceMap
  }

  /**
   * Get investment pools with details for a vendor
   *
   * OPTIMIZED: Uses batch queries instead of N+1 pattern
   * Fetches all pools, their balances, and investment counts in parallel
   */
  async getVendorPoolsWithDetails(vendorId: string) {
    // Get pools for this vendor
    const pools = await this.listInvestmentPools({
      producer_id: vendorId,
    })

    if (pools.length === 0) {
      return []
    }

    // Extract all ledger account IDs and pool IDs
    const accountIds = pools.map(p => p.ledger_account_id)
    const poolIds = pools.map(p => p.id)

    // OPTIMIZATION: Fetch all balances and investments in parallel
    const [balanceMap, allInvestments] = await Promise.all([
      this.getAccountBalancesBatch(accountIds),
      this.listInvestments({
        pool_id: poolIds,
      }),
    ])

    // Group investments by pool_id. Every LEDGER row counts exactly as before;
    // a CARRIER row only once the processor confirmed it and it was not
    // reversed (Decision 7) — a PENDING checkout row (which anyone can start)
    // or a failed / refunded one is not an investor in the pool.
    const investmentsByPool = new Map<string, number>()
    for (const inv of allInvestments) {
      if (!countsTowardPool(inv)) continue
      const count = investmentsByPool.get(inv.pool_id) || 0
      investmentsByPool.set(inv.pool_id, count + 1)
    }

    // Build enriched pools
    return pools.map(pool => {
      const balance = balanceMap.get(pool.ledger_account_id)
      const progress = Number(pool.target_amount) > 0
        ? (Number(pool.total_raised) / Number(pool.target_amount)) * 100
        : 0

      // A carried pool has no BMC balance to show: the carrier holds the
      // funds. `null`, not 0 — 0 would be a claim about money BMC never held.
      const carried = isCarriedPool(pool)
      return {
        ...pool,
        carrier: projectPoolCarrier(pool),
        current_balance: carried ? null : balance?.balance || 0,
        progress_percentage: Math.min(progress, 100),
        investments_count: investmentsByPool.get(pool.id) || 0,
      }
    })
  }

  /**
   * Get transaction history for an account
   */
  async getTransactionHistory(accountId: string, options?: {
    limit?: number
    offset?: number
    entry_type?: string
  }) {
    const [debitEntries, creditEntries] = await Promise.all([
      this.listLedgerEntries({
        debit_account_id: accountId,
      }),
      this.listLedgerEntries({
        credit_account_id: accountId,
      }),
    ])

    // Combine and sort by created_at
    const allEntries = [...debitEntries, ...creditEntries].map(entry => ({
      ...entry,
      direction: entry.debit_account_id === accountId ? "DEBIT" : "CREDIT",
      signed_amount: entry.debit_account_id === accountId 
        ? -Number(entry.amount) 
        : Number(entry.amount),
    }))

    allEntries.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )

    return allEntries.slice(0, options?.limit || 50)
  }

  // ==================== REPORTING ====================

  /**
   * Get ledger summary for reporting
   */
  async getLedgerSummary(_options?: { start_date?: Date; end_date?: Date }) {
    const accounts = await this.listLedgerAccounts({})
    
    const summary = {
      total_accounts: accounts.length,
      by_type: {} as Record<string, { count: number; total_balance: number }>,
      total_balance: 0,
    }

    for (const account of accounts) {
      const type = account.account_type
      if (!summary.by_type[type]) {
        summary.by_type[type] = { count: 0, total_balance: 0 }
      }
      summary.by_type[type].count++
      summary.by_type[type].total_balance += Number(account.balance)
      summary.total_balance += Number(account.balance)
    }

    return summary
  }

  // ==================== INSTANT PAYOUTS ====================

  /**
   * Payout tier configuration with fees
   */
  private readonly PAYOUT_TIERS = {
    INSTANT: { fee_rate: 0.01, name: "Instant", speed: "30 minutes", method: "DEBIT_CARD_PUSH" },
    SAME_DAY: { fee_rate: 0.005, name: "Same-Day", speed: "End of day", method: "RTP" },
    NEXT_DAY: { fee_rate: 0.0025, name: "Next-Day", speed: "Next business day", method: "ACH" },
    WEEKLY: { fee_rate: 0, name: "Weekly", speed: "Every Friday", method: "ACH_BATCH" },
  }

  /**
   * Get available payout options for a vendor
   */
  async getPayoutOptions(vendorId: string) {
    // Get vendor's ledger account
    const accounts = await this.listLedgerAccounts({
      owner_type: "SELLER",
      owner_id: vendorId,
      account_type: "SELLER_EARNINGS",
    })

    if (accounts.length === 0) {
      throw new Error("Vendor account not found")
    }

    const account = accounts[0]
    const availableBalance = Number(account.available_balance)

    // Get payout config
    const configs = await this.listPayoutConfigs({
      vendor_id: vendorId,
    })
    const config = configs[0]

    // Build payout options
    const options = Object.entries(this.PAYOUT_TIERS).map(([tier, info]) => {
      const fee = availableBalance * info.fee_rate
      const netAmount = availableBalance - fee

      return {
        tier,
        name: info.name,
        speed: info.speed,
        method: info.method,
        fee_rate: info.fee_rate,
        fee_rate_display: `${(info.fee_rate * 100).toFixed(2)}%`,
        fee_amount: fee,
        net_amount: netAmount,
        available: tier === "INSTANT" 
          ? (config?.instant_payout_eligible ?? false)
          : true,
      }
    })

    return {
      available_balance: availableBalance,
      currency: account.currency_code,
      options,
      default_tier: config?.default_payout_tier || "WEEKLY",
      instant_payout_eligible: config?.instant_payout_eligible ?? false,
      instant_payout_daily_limit: config?.instant_payout_daily_limit ?? 10000,
      // Null-safe: coalesce unset limit/used so we never surface NaN.
      instant_payout_remaining: Math.max(
        0,
        Number(config?.instant_payout_daily_limit ?? 10000) -
          Number(config?.instant_payout_used_today ?? 0)
      ),
    }
  }

  /**
   * Request a payout
   */
  async requestPayout(data: {
    vendor_id: string
    amount: number
    payout_tier: "INSTANT" | "SAME_DAY" | "NEXT_DAY" | "WEEKLY"
    bank_account_id?: string
  }) {
    const tierConfig = this.PAYOUT_TIERS[data.payout_tier]
    if (!tierConfig) {
      throw new Error("Invalid payout tier")
    }

    // Payout amounts must be strictly positive and finite. Without this a
    // negative amount would pass the `available_balance < amount` check below
    // (a positive balance is never < a negative number), then flow into
    // createTransfer where it would credit the vendor's own earnings account
    // and debit the platform SETTLEMENT account — a fund-drain vector. The
    // chokepoint guard in createTransfer blocks the negative move as well;
    // this is the caller-layer half of that defense.
    if (!Number.isFinite(data.amount) || data.amount <= 0) {
      throw new Error("Payout amount must be a positive number")
    }

    // Get vendor account
    const accounts = await this.listLedgerAccounts({
      owner_type: "SELLER",
      owner_id: data.vendor_id,
      account_type: "SELLER_EARNINGS",
    })

    if (accounts.length === 0) {
      throw new Error("Vendor account not found")
    }

    const account = accounts[0]

    // Validate balance
    if (Number(account.available_balance) < data.amount) {
      throw new Error("Insufficient balance")
    }

    // INSTANT tier: enforce the per-vendor daily instant-payout limit using
    // a null-safe (finite) remaining value, so an unset config can't yield
    // NaN and silently pass this guard.
    if (data.payout_tier === "INSTANT") {
      const configs = await this.listPayoutConfigs({ vendor_id: data.vendor_id })
      const config = configs[0]
      const instantRemaining = Math.max(
        0,
        Number(config?.instant_payout_daily_limit ?? 10000) -
          Number(config?.instant_payout_used_today ?? 0)
      )
      if (instantRemaining < data.amount) {
        throw new Error(
          `Instant payout daily limit exceeded: requested ${data.amount}, remaining ${instantRemaining}`
        )
      }
    }

    // Calculate fees
    const feeAmount = data.amount * tierConfig.fee_rate
    const netAmount = data.amount - feeAmount

    // Get platform fee account
    const platformAccount = await this.getOrCreateSystemAccount("PLATFORM_FEE")

    // Create payout request
    const payoutRequest = await this.createPayoutRequests({
      vendor_id: data.vendor_id,
      ledger_account_id: account.id,
      bank_account_id: data.bank_account_id,
      payout_tier: data.payout_tier as "INSTANT" | "SAME_DAY" | "NEXT_DAY" | "WEEKLY",
      payout_method: tierConfig.method as any,
      gross_amount: data.amount,
      fee_amount: feeAmount,
      net_amount: netAmount,
      fee_rate: tierConfig.fee_rate,
      requested_at: new Date(),
      status: "PENDING" as const,
    })

    // Create ledger entries
    // 1. Debit vendor account for full amount
    // 2. Credit platform for fee (if any)
    // 3. Credit settlement account for net amount

    const settlementAccount = await this.getOrCreateSystemAccount("SETTLEMENT")

    // Main transfer (vendor → settlement). The idempotency keys are new
    // (the legs previously carried none, so a retried request could move
    // money twice and payout legs had no lineage handle); they double as
    // the correlation handle external reconciliation joins Stripe payout
    // records back through.
    const payoutNetEntry = await this.createTransfer({
      debit_account_id: account.id,
      credit_account_id: settlementAccount.id,
      amount: netAmount,
      entry_type: "WITHDRAWAL",
      description: `${tierConfig.name} payout`,
      reference_type: "PAYOUT_REQUEST",
      reference_id: payoutRequest.id,
      idempotency_key: `payout-${payoutRequest.id}-net`,
      correlation_id: `payout-${payoutRequest.id}`,
    })

    // Fee transfer (if applicable)
    if (feeAmount > 0) {
      await this.createTransfer({
        debit_account_id: account.id,
        credit_account_id: platformAccount.id,
        amount: feeAmount,
        entry_type: "FEE",
        description: `${tierConfig.name} payout fee`,
        reference_type: "PAYOUT_REQUEST",
        reference_id: payoutRequest.id,
        idempotency_key: `payout-${payoutRequest.id}-fee`,
        correlation_id: `payout-${payoutRequest.id}`,
        parent_entry_id: payoutNetEntry?.id,
      })
    }

    // Update status to processing
    await this.updatePayoutRequests({
      id: payoutRequest.id,
      status: "PROCESSING" as const,
    })

    return payoutRequest
  }

  // ==================== VENDOR ADVANCES ====================

  /**
   * Calculate advance eligibility for a vendor
   */
  async calculateAdvanceEligibility(vendorId: string) {
    // Get vendor's ledger account
    const accounts = await this.listLedgerAccounts({
      owner_type: "SELLER",
      owner_id: vendorId,
      account_type: "SELLER_EARNINGS",
    })

    if (accounts.length === 0) {
      return {
        eligible: false,
        reason: "No vendor account found",
        max_advance: 0,
        suggested_term_days: 0,
        daily_repayment_capacity: 0,
      }
    }

    const account = accounts[0]

    // Get last 30 days of credit entries (revenue)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const entries = await this.listLedgerEntries({
      credit_account_id: account.id,
      entry_type: "SALE",
    })

    // Calculate metrics
    const recentEntries = entries.filter(e => 
      new Date(e.created_at) >= thirtyDaysAgo
    )
    const last30DaysRevenue = recentEntries.reduce(
      (sum, e) => sum + Number(e.amount), 
      0
    )
    const avgDailyRevenue = last30DaysRevenue / 30

    // Check for existing active advances (seller advances only: a PARTNER_ORG
    // advance is never a vendor's, Phase 1b Decision 6a)
    const activeAdvances = await this.listVendorAdvances({
      vendor_id: vendorId,
      recipient_type: "SELLER",
      status: "ACTIVE",
    })

    if (activeAdvances.length > 0) {
      return {
        eligible: false,
        reason: "Active advance exists",
        max_advance: 0,
        suggested_term_days: 0,
        daily_repayment_capacity: 0,
        active_advance: activeAdvances[0],
      }
    }

    // Eligibility criteria
    const minRevenue = 500 // Minimum $500 in last 30 days
    const minDays = entries.length >= 10 // At least 10 sales

    if (last30DaysRevenue < minRevenue || !minDays) {
      return {
        eligible: false,
        reason: "Insufficient sales history",
        max_advance: 0,
        suggested_term_days: 0,
        daily_repayment_capacity: 0,
        metrics: {
          last_30_days_revenue: last30DaysRevenue,
          transaction_count: entries.length,
          avg_daily_revenue: avgDailyRevenue,
        },
      }
    }

    // Calculate advance capacity
    const repaymentCapacity = avgDailyRevenue * 0.20 // 20% of daily sales
    const maxAdvance = repaymentCapacity * 30 // ~30 days of repayment

    return {
      eligible: true,
      max_advance: Math.round(maxAdvance * 100) / 100,
      suggested_term_days: 30,
      daily_repayment_capacity: Math.round(repaymentCapacity * 100) / 100,
      fee_options: [
        { type: "FACTOR_RATE", rate: 1.08, total_repayment: maxAdvance * 1.08, apr_equivalent: "~10%" },
        { type: "FACTOR_RATE", rate: 1.12, total_repayment: maxAdvance * 1.12, apr_equivalent: "~15%" },
      ],
      metrics: {
        last_30_days_revenue: last30DaysRevenue,
        transaction_count: entries.length,
        avg_daily_revenue: avgDailyRevenue,
      },
    }
  }

  /**
   * Request a vendor advance
   */
  async requestAdvance(data: {
    vendor_id: string
    amount: number
    fee_rate: number
    term_days: number
    repayment_rate?: number
  }) {
    // Validate eligibility
    const eligibility = await this.calculateAdvanceEligibility(data.vendor_id)
    
    if (!eligibility.eligible) {
      throw new Error(`Not eligible for advance: ${eligibility.reason}`)
    }

    if (data.amount > eligibility.max_advance) {
      throw new Error(`Amount exceeds maximum eligible advance of $${eligibility.max_advance}`)
    }

    // Get vendor account
    const accounts = await this.listLedgerAccounts({
      owner_type: "SELLER",
      owner_id: data.vendor_id,
      account_type: "SELLER_EARNINGS",
    })
    const account = accounts[0]

    // Get or create reserve account for advances
    const reserveAccount = await this.getOrCreateSystemAccount("RESERVE")

    // Calculate dates
    const startDate = new Date()
    const expectedEndDate = new Date()
    expectedEndDate.setDate(expectedEndDate.getDate() + data.term_days)

    // Total owed
    const totalOwed = data.amount * data.fee_rate

    // Create the advance record
    const advance = await this.createVendorAdvances({
      vendor_id: data.vendor_id,
      ledger_account_id: account.id,
      principal_amount: data.amount,
      outstanding_balance: totalOwed,
      fee_type: "FACTOR_RATE" as const,
      fee_rate: data.fee_rate,
      repayment_method: "AUTO_DEDUCT" as const,
      repayment_rate: data.repayment_rate || 0.20,
      term_days: data.term_days,
      start_date: startDate,
      expected_end_date: expectedEndDate,
      eligibility_snapshot: eligibility.metrics,
      status: "PENDING_APPROVAL" as const,
    })

    // For now, auto-approve (in production, might want manual review)
    await this.updateVendorAdvances({
      id: advance.id,
      status: "ACTIVE" as const,
      approved_at: new Date(),
    })

    // Create ledger entry: Reserve → Vendor
    await this.createTransfer({
      debit_account_id: reserveAccount.id,
      credit_account_id: account.id,
      amount: data.amount,
      entry_type: "ADVANCE",
      description: `Vendor advance - ${data.term_days} day term`,
      reference_type: "VENDOR_ADVANCE",
      reference_id: advance.id,
    })

    return advance
  }

  /**
   * Auto-deduct advance repayment from a sale
   */
  async processAdvanceRepayment(data: {
    vendor_id: string
    order_id: string
    sale_amount: number
  }) {
    // Get active advance
    const advances = await this.listVendorAdvances({
      vendor_id: data.vendor_id,
      status: "ACTIVE",
    })

    if (advances.length === 0) {
      return null // No active advance
    }

    const advance = advances[0]
    const repaymentRate = Number(advance.repayment_rate)
    const outstandingBalance = Number(advance.outstanding_balance)

    // Calculate repayment (percentage of sale, capped at outstanding)
    let repaymentAmount = data.sale_amount * repaymentRate
    repaymentAmount = Math.min(repaymentAmount, outstandingBalance)

    if (repaymentAmount <= 0) {
      return null
    }

    // Get accounts
    const vendorAccounts = await this.listLedgerAccounts({
      owner_type: "SELLER",
      owner_id: data.vendor_id,
      account_type: "SELLER_EARNINGS",
    })
    const vendorAccount = vendorAccounts[0]
    const reserveAccount = await this.getOrCreateSystemAccount("RESERVE")

    // Create ledger entry: Vendor → Reserve
    const entry = await this.createTransfer({
      debit_account_id: vendorAccount.id,
      credit_account_id: reserveAccount.id,
      amount: repaymentAmount,
      entry_type: "ADVANCE_REPAYMENT",
      description: `Advance repayment from order ${data.order_id}`,
      reference_type: "VENDOR_ADVANCE",
      reference_id: advance.id,
      order_id: data.order_id,
    })

    // Update advance balance
    const newBalance = outstandingBalance - repaymentAmount
    const newTotalRepaid = Number(advance.total_repaid) + repaymentAmount

    // Split the payment between principal and fee. A factor-rate advance owes
    // principal * fee_rate, so each payment retires both components pro-rata.
    // See `advance-repayment-split.ts` for why, and for why the closing
    // payment is trued up rather than computed.
    const priorRepayments = await this.listAdvanceRepayments({
      advance_id: advance.id,
    })
    const priorPrincipalRepaid = priorRepayments.reduce(
      (sum, r) => sum + Number(r.principal_amount ?? 0),
      0
    )

    const split = splitAdvanceRepayment({
      repayment_amount: repaymentAmount,
      fee_rate: Number(advance.fee_rate),
      principal_amount: Number(advance.principal_amount),
      prior_principal_repaid: priorPrincipalRepaid,
      is_final: newBalance <= 0,
    })

    await this.updateVendorAdvances({
      id: advance.id,
      outstanding_balance: newBalance,
      total_repaid: newTotalRepaid,
      // Fee revenue was previously never recorded on the advance at all.
      total_fee_charged:
        Number(advance.total_fee_charged ?? 0) + split.fee_amount,
      status: newBalance <= 0 ? ("REPAID" as const) : ("ACTIVE" as const),
      actual_end_date: newBalance <= 0 ? new Date() : undefined,
    })

    // Record the repayment
    await this.createAdvanceRepayments({
      advance_id: advance.id,
      ledger_entry_id: entry.id,
      order_id: data.order_id,
      principal_amount: split.principal_amount,
      fee_amount: split.fee_amount,
      total_amount: repaymentAmount,
      outstanding_balance_after: newBalance,
      repayment_type: "AUTO_DEDUCT" as const,
      status: "COMPLETED" as const,
    })

    return {
      repayment_amount: repaymentAmount,
      outstanding_balance: newBalance,
      advance_repaid: newBalance <= 0,
    }
  }

  // ==================== ORG ADVANCES (Phase 1b, Decision 6a) ====================
  // A verified nonprofit partner_org as a VendorAdvance recipient. The row is a
  // RECORD of an advance disbursed and repaid OUTSIDE the hawala ledger: the
  // org has no ledger account and never gets one; RESERVE is never debited;
  // no hawala_ledger_entry is written. The rules live here, in the service,
  // because routes and hooks can be bypassed. See `./org-advance.ts`.

  private requireOrgAdvanceFlag_(operation: string): void {
    if (featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) return
    throw new OrgAdvanceRefusalError(
      "feature_disabled",
      `${operation} is dark: FF_NONPROFIT_PARITY_V1 is not enabled.`,
      { operation }
    )
  }

  private async requireOrgAdvance_(advanceId: string) {
    const [advance] = await this.listVendorAdvances({ id: advanceId })
    if (!advance) throw new Error("Vendor advance not found")
    if (!isOrgAdvance(advance)) {
      throw new OrgAdvanceRefusalError(
        "not_org_advance",
        `advance ${advanceId} is a ${advance.recipient_type} advance; this operation is for PARTNER_ORG advances only.`,
        { advance_id: advanceId, recipient_type: advance.recipient_type }
      )
    }
    return advance
  }

  /**
   * Request an advance for a verified nonprofit partner_org. The admin route
   * resolved the directory, ran `partnerOrgCarrierRefusal` and built
   * `recipient_snapshot`; this validates the snapshot's shape (never trusting
   * an unverified status), records the OPERATOR's eligibility statement, and
   * writes a PENDING_APPROVAL row:
   *
   *   - `feature_disabled` with FF_NONPROFIT_PARITY_V1 off, before any read;
   *   - `invalid_recipient_snapshot` / `invalid_eligibility` / `invalid_terms`;
   *   - `over_limit` when amount > the operator's approved_limit;
   *   - `open_advance_exists` when the org already has a pending / approved /
   *     active advance (the seller path's "Active advance exists" rule).
   *
   * `calculateAdvanceEligibility` is NOT called: it reads sales metrics an org
   * does not have, and BMC does not fabricate eligibility. No auto-approve;
   * no ledger account; no ledger entry. `repayment_method` is MANUAL
   * (AUTO_DEDUCT is impossible: the org's inflows never touch BMC's ledger)
   * and `repayment_rate` is 0. Amounts are in the table's own unit (major
   * units); total owed = principal * fee_rate (the seller path's FACTOR_RATE).
   */
  async requestOrgAdvance(input: {
    partner_org_key: string
    recipient_snapshot: unknown
    amount: number
    fee_rate: number
    term_days: number
    eligibility: unknown
    requested_by?: string | null
    metadata?: Record<string, unknown> | null
  }) {
    this.requireOrgAdvanceFlag_("requestOrgAdvance")
    const now = new Date()
    const recipient = assertOrgAdvanceRecipient(input.recipient_snapshot, input.partner_org_key)
    const terms = assertOrgAdvanceTerms(input)
    const eligibility = assertOrgAdvanceEligibility(input.eligibility, input.requested_by ?? null, now)
    if (terms.amount > eligibility.approved_limit) {
      throw new OrgAdvanceRefusalError(
        "over_limit",
        `requested ${terms.amount} exceeds the operator-approved limit ${eligibility.approved_limit} for ${recipient.org_key}.`,
        { amount: terms.amount, approved_limit: eligibility.approved_limit, partner_org_key: recipient.org_key }
      )
    }

    const open = await this.listVendorAdvances({
      recipient_type: "PARTNER_ORG",
      partner_org_key: recipient.org_key,
      status: [...OPEN_ADVANCE_STATUSES],
    })
    if (open.length > 0) {
      throw new OrgAdvanceRefusalError(
        "open_advance_exists",
        `${recipient.org_key} already has an open advance (${open[0].id}, ${open[0].status}).`,
        { partner_org_key: recipient.org_key, advance_id: open[0].id, status: open[0].status }
      )
    }

    const expectedEnd = new Date(now)
    expectedEnd.setDate(expectedEnd.getDate() + terms.term_days)

    // The read above is not atomic with the insert; the partial unique index
    // UQ_hawala_vendor_advance_org_open (one open PARTNER_ORG advance per
    // partner_org_key) is the arbiter when two requests race. A violation is
    // re-read and answered as `open_advance_exists`, like a serial second
    // request.
    try {
      return await this.createVendorAdvances(
        this.orgAdvanceRow_(recipient, terms, eligibility, now, expectedEnd, input.metadata ?? null)
      )
    } catch (error) {
      const [raced] = await this.listVendorAdvances({
        recipient_type: "PARTNER_ORG",
        partner_org_key: recipient.org_key,
        status: [...OPEN_ADVANCE_STATUSES],
      })
      if (raced) {
        throw new OrgAdvanceRefusalError(
          "open_advance_exists",
          `${recipient.org_key} already has an open advance (${raced.id}, ${raced.status}).`,
          { partner_org_key: recipient.org_key, advance_id: raced.id, status: raced.status }
        )
      }
      throw error
    }
  }

  private orgAdvanceRow_(
    recipient: ReturnType<typeof assertOrgAdvanceRecipient>,
    terms: ReturnType<typeof assertOrgAdvanceTerms>,
    eligibility: ReturnType<typeof assertOrgAdvanceEligibility>,
    now: Date,
    expectedEnd: Date,
    metadata: Record<string, unknown> | null
  ) {
    return {
      recipient_type: "PARTNER_ORG" as const,
      vendor_id: null,
      ledger_account_id: null,
      partner_org_key: recipient.org_key,
      recipient_snapshot: recipient,
      disbursement_reference: null,
      principal_amount: terms.amount,
      outstanding_balance: totalOwedMajorUnits(terms.amount, terms.fee_rate),
      total_repaid: 0,
      fee_type: "FACTOR_RATE" as const,
      fee_rate: terms.fee_rate,
      total_fee_charged: 0,
      repayment_method: "MANUAL" as const,
      repayment_rate: 0,
      term_days: terms.term_days,
      // The term starts when the operator disburses; these are re-stamped on
      // approval. The model requires both at creation.
      start_date: now,
      expected_end_date: expectedEnd,
      eligibility_snapshot: eligibility,
      status: "PENDING_APPROVAL" as const,
      metadata,
    }
  }

  /**
   * Explicit operator approval: PENDING_APPROVAL -> ACTIVE, stamping
   * approved_at / approved_by and the external `disbursement_reference` (the
   * operator's reference for the money that moved from BMC's own balance to
   * the org's connected account, outside the ledger). Idempotent on that
   * reference: an ACTIVE advance approved again with the same reference is a
   * no-op answer `{ approved: false, reason: "already_approved" }`; a
   * different reference is refused (`reference_mismatch`); any other status
   * is `invalid_state`.
   *
   * Two concurrent approvals are settled IN THE DATABASE: a single
   * `UPDATE ... WHERE id = ? AND status = 'PENDING_APPROVAL' RETURNING id`
   * through `resolvePgConnection()` (the `atomicPoolIncrement` pattern). The
   * generated `updateVendorAdvances({ selector, data })` is NOT a CAS —
   * Medusa's internal service implements it as a find-by-selector followed by
   * an update of the found ids, two statements with no predicate on the
   * write — so on Postgres both approvals could read PENDING_APPROVAL and the
   * later one would overwrite the earlier disbursement reference. The
   * generated path is kept only as the fallback when no connection is
   * reachable (unit tests without DI); a zero-row CAS re-reads and answers by
   * reference.
   */
  async approveOrgAdvance(advanceId: string, input: { approved_by: string; disbursement_reference: string }) {
    this.requireOrgAdvanceFlag_("approveOrgAdvance")
    const approvedBy = requireReference(input.approved_by, "approved_by", "invalid_state")
    const reference = requireReference(input.disbursement_reference, "disbursement_reference", "invalid_state")
    const advance = await this.requireOrgAdvance_(advanceId)

    const alreadyApproved = (row: typeof advance) => {
      if (row.disbursement_reference === reference) {
        return { approved: false as const, reason: "already_approved" as const, advance: row }
      }
      throw new OrgAdvanceRefusalError(
        "reference_mismatch",
        `advance ${advanceId} was already approved under disbursement reference ${row.disbursement_reference}; a second reference cannot be recorded.`,
        { advance_id: advanceId, disbursement_reference: row.disbursement_reference, requested_reference: reference }
      )
    }

    if (advance.status === "ACTIVE") return alreadyApproved(advance)
    if (advance.status !== "PENDING_APPROVAL") {
      throw new OrgAdvanceRefusalError(
        "invalid_state",
        `advance ${advanceId} is ${advance.status}; only a PENDING_APPROVAL advance can be approved.`,
        { advance_id: advanceId, status: advance.status }
      )
    }

    const now = new Date()
    const expectedEnd = new Date(now)
    expectedEnd.setDate(expectedEnd.getDate() + Number(advance.term_days))
    const patch = {
      status: "ACTIVE" as const,
      approved_at: now,
      approved_by: approvedBy,
      disbursement_reference: reference,
      start_date: now,
      expected_end_date: expectedEnd,
    }

    const won = await this.casApproveOrgAdvance_(advanceId, patch)
    if (won === false) {
      // Another approval won the CAS; answer from its result.
      const [current] = await this.listVendorAdvances({ id: advanceId })
      if (!current) throw new Error("Vendor advance not found")
      return alreadyApproved(current)
    }
    if (won === true) {
      const [current] = await this.listVendorAdvances({ id: advanceId })
      if (!current) throw new Error("Vendor advance not found")
      return { approved: true as const, advance: current }
    }

    // No pg connection reachable: the generated conditional update. Not a
    // CAS on a real database (see the doc comment); unit tests without DI
    // land here, where the in-memory shadow settles it in one tick.
    const updated = await this.updateVendorAdvances({
      selector: { id: advanceId, status: "PENDING_APPROVAL" },
      data: patch,
    })
    const rows = Array.isArray(updated) ? updated : [updated]
    if (rows.length === 0) {
      const [current] = await this.listVendorAdvances({ id: advanceId })
      if (!current) throw new Error("Vendor advance not found")
      return alreadyApproved(current)
    }
    return { approved: true as const, advance: rows[0] }
  }

  /**
   * The PENDING_APPROVAL -> ACTIVE transition as one conditional UPDATE, so
   * exactly one of N concurrent approvals writes and every other sees zero
   * rows. Returns `true` when this call won, `false` when the predicate
   * matched nothing (someone else won, or the status moved), `undefined`
   * when no pg connection is reachable so the caller can fall back. Column
   * names are a fixed list in identifier position; every value is bound.
   */
  private async casApproveOrgAdvance_(
    advanceId: string,
    patch: {
      status: "ACTIVE"
      approved_at: Date
      approved_by: string
      disbursement_reference: string
      start_date: Date
      expected_end_date: Date
    }
  ): Promise<boolean | undefined> {
    const pg = this.resolvePgConnection()
    if (!pg) return undefined
    const result = await pg.raw(
      `UPDATE hawala_vendor_advance
         SET status = ?, approved_at = ?, approved_by = ?, disbursement_reference = ?,
             start_date = ?, expected_end_date = ?, updated_at = NOW()
       WHERE id = ? AND status = 'PENDING_APPROVAL' AND deleted_at IS NULL
       RETURNING id`,
      [
        patch.status,
        patch.approved_at,
        patch.approved_by,
        patch.disbursement_reference,
        patch.start_date,
        patch.expected_end_date,
        advanceId,
      ]
    )
    const rowCount: number = Number(result?.rowCount ?? result?.rows?.length ?? 0)
    return rowCount > 0
  }

  /**
   * RECORD a repayment the org made outside the ledger. Writes an
   * AdvanceRepayment { repayment_type MANUAL, status COMPLETED,
   * external_reference, ledger_entry_id null } under the partial unique index
   * on (advance_id, external_reference); a duplicate reference — a replay or a
   * concurrent second call — answers `already_recorded` after a re-read (the
   * index is the arbiter, as in S12's recordCarrierContribution). The
   * advance's outstanding_balance / total_repaid / total_fee_charged are then
   * DERIVED from its COMPLETED rows (never `+=`), and it goes REPAID (the
   * status enum's terminal value) when the derived outstanding reaches 0.
   * Only an ACTIVE advance takes a new repayment; a repayment above the
   * derived outstanding is refused so the books close exactly.
   */
  async recordOrgAdvanceRepayment(
    advanceId: string,
    input: { amount: number; external_reference: string; repaid_at?: Date | null; recorded_by?: string | null; metadata?: Record<string, unknown> | null }
  ) {
    this.requireOrgAdvanceFlag_("recordOrgAdvanceRepayment")
    if (!isValidCarrierAmount(input.amount)) {
      throw new OrgAdvanceRefusalError(
        "invalid_repayment",
        `amount must be a positive, finite major-unit amount with at most two decimals; got ${String(input.amount)}.`,
        { amount: input.amount }
      )
    }
    const reference = requireReference(input.external_reference, "external_reference", "invalid_repayment")
    const advance = await this.requireOrgAdvance_(advanceId)
    const keyFilter = { advance_id: advanceId, external_reference: reference }

    const [seen] = await this.listAdvanceRepayments(keyFilter)
    if (seen) {
      return { recorded: false as const, reason: "already_recorded" as const, repayment_id: seen.id }
    }
    if (advance.status !== "ACTIVE") {
      throw new OrgAdvanceRefusalError(
        "invalid_state",
        `advance ${advanceId} is ${advance.status}; repayments are recorded against an ACTIVE advance only.`,
        { advance_id: advanceId, status: advance.status }
      )
    }

    const completedBefore = await this.listAdvanceRepayments({ advance_id: advanceId, status: "COMPLETED" })
    const before = deriveOrgAdvancePosition(advance, completedBefore)
    if (input.amount > before.outstanding_balance) {
      throw new OrgAdvanceRefusalError(
        "invalid_repayment",
        `repayment ${input.amount} exceeds the outstanding balance ${before.outstanding_balance} on advance ${advanceId}.`,
        { advance_id: advanceId, amount: input.amount, outstanding_balance: before.outstanding_balance }
      )
    }
    const outstandingAfter = Math.round((before.outstanding_balance - input.amount) * 100) / 100
    const split = splitAdvanceRepayment({
      repayment_amount: input.amount,
      fee_rate: Number(advance.fee_rate),
      principal_amount: Number(advance.principal_amount),
      prior_principal_repaid: before.principal_repaid,
      is_final: outstandingAfter <= 0,
    })

    let repayment
    try {
      repayment = await this.createAdvanceRepayments({
        advance_id: advanceId,
        ledger_entry_id: null,
        order_id: null,
        external_reference: reference,
        principal_amount: split.principal_amount,
        fee_amount: split.fee_amount,
        total_amount: input.amount,
        outstanding_balance_after: outstandingAfter,
        repayment_type: "MANUAL" as const,
        status: "COMPLETED" as const,
        metadata: {
          ...(input.metadata ?? {}),
          repaid_at: (input.repaid_at ?? new Date()).toISOString(),
          recorded_by: input.recorded_by ?? null,
        },
      })
    } catch (error) {
      // Two calls passed the read above; the unique index decided. If the row
      // exists now the other call won; otherwise this was a real failure.
      const [raced] = await this.listAdvanceRepayments(keyFilter)
      if (raced) {
        return { recorded: false as const, reason: "already_recorded" as const, repayment_id: raced.id }
      }
      throw error
    }

    const position = await this.recomputeOrgAdvancePosition_(advanceId, advance)
    return { recorded: true as const, repayment, position }
  }

  /** Derive an org advance's position from its rows and write it. Never `+=`. */
  private async recomputeOrgAdvancePosition_(advanceId: string, advance: { principal_amount: unknown; fee_rate: unknown }) {
    const completed = await this.listAdvanceRepayments({ advance_id: advanceId, status: "COMPLETED" })
    const position = deriveOrgAdvancePosition(advance, completed)
    const repaid = position.outstanding_balance <= 0
    await this.updateVendorAdvances({
      id: advanceId,
      outstanding_balance: position.outstanding_balance,
      total_repaid: position.total_repaid,
      total_fee_charged: position.fee_repaid,
      status: repaid ? ("REPAID" as const) : ("ACTIVE" as const),
      actual_end_date: repaid ? new Date() : null,
    })
    return position
  }

  // ==================== VENDOR-TO-VENDOR PAYMENTS ====================

  /**
   * Create a vendor-to-vendor payment (internal transfer)
   */
  async createVendorToVendorPayment(data: {
    payer_vendor_id: string
    payee_vendor_id: string
    amount: number
    payment_type: string
    invoice_number?: string
    purchase_order_number?: string
    reference_note?: string
  }) {
    // Get both vendor accounts
    const [payerAccounts, payeeAccounts] = await Promise.all([
      this.listLedgerAccounts({
        owner_type: "SELLER",
        owner_id: data.payer_vendor_id,
        account_type: "SELLER_EARNINGS",
      }),
      this.listLedgerAccounts({
        owner_type: "SELLER",
        owner_id: data.payee_vendor_id,
        account_type: "SELLER_EARNINGS",
      }),
    ])

    if (payerAccounts.length === 0 || payeeAccounts.length === 0) {
      throw new Error("One or both vendor accounts not found")
    }

    const payerAccount = payerAccounts[0]
    const payeeAccount = payeeAccounts[0]

    // Validate balance
    if (Number(payerAccount.available_balance) < data.amount) {
      throw new Error("Insufficient balance")
    }

    // Create ledger transfer
    const entry = await this.createTransfer({
      debit_account_id: payerAccount.id,
      credit_account_id: payeeAccount.id,
      amount: data.amount,
      entry_type: "VENDOR_PAYMENT",
      description: data.reference_note || `Vendor payment: ${data.payment_type}`,
      reference_type: "VENDOR_PAYMENT",
    })

    // Create vendor payment record
    const payment = await this.createVendorPayments({
      payer_vendor_id: data.payer_vendor_id,
      payer_ledger_account_id: payerAccount.id,
      payee_vendor_id: data.payee_vendor_id,
      payee_ledger_account_id: payeeAccount.id,
      amount: data.amount,
      payment_type: data.payment_type as any,
      invoice_number: data.invoice_number,
      purchase_order_number: data.purchase_order_number,
      reference_note: data.reference_note,
      ledger_entry_id: entry.id,
      status: "COMPLETED" as const,
    })

    return payment
  }

  // ==================== VENDOR DASHBOARD ====================

  /**
   * Get comprehensive vendor financial dashboard data
   *
   * OPTIMIZED: Uses parallel queries via Promise.all to reduce latency
   * Previously made 5 sequential DB calls, now executes them concurrently
   */
  async getVendorDashboard(vendorId: string) {
    // Get vendor account using direct filters (not wrapped in filters object)
    const accounts = await this.listLedgerAccounts({
      owner_type: "SELLER",
      owner_id: vendorId,
      account_type: "SELLER_EARNINGS",
    })

    if (accounts.length === 0) {
      throw new Error("Vendor account not found")
    }

    const account = accounts[0]

    // Get date ranges
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(todayStart)
    weekStart.setDate(weekStart.getDate() - 7)
    const monthStart = new Date(todayStart)
    monthStart.setDate(monthStart.getDate() - 30)

    // OPTIMIZATION: Execute all independent queries in parallel
    // This reduces dashboard load time from O(n) sequential to O(1) parallel
    const [
      entries,
      pendingEntries,
      activeAdvances,
      payoutConfigs,
      pools,
    ] = await Promise.all([
      // Get transaction history
      this.getTransactionHistory(account.id, { limit: 1000 }),
      // Get pending orders (entries in PENDING status)
      this.listLedgerEntries({
        credit_account_id: account.id,
        status: "PENDING",
      }),
      // Get active advance (seller advances only; an org advance never
      // surfaces on a vendor surface)
      this.listVendorAdvances({
        vendor_id: vendorId,
        recipient_type: "SELLER",
        status: "ACTIVE",
      }),
      // Get payout config
      this.listPayoutConfigs({
        vendor_id: vendorId,
      }),
      // Get investment pools
      this.listInvestmentPools({
        producer_id: vendorId,
      }),
    ])

    // Calculate metrics
    const todayEntries = entries.filter(e => new Date(e.created_at) >= todayStart)
    const weekEntries = entries.filter(e => new Date(e.created_at) >= weekStart)
    const monthEntries = entries.filter(e => new Date(e.created_at) >= monthStart)

    const calcRevenue = (items: typeof entries) =>
      items.filter(e => e.direction === "CREDIT" && e.entry_type === "PURCHASE")
           .reduce((sum, e) => sum + Number(e.amount), 0)

    const todayRevenue = calcRevenue(todayEntries)
    const weekRevenue = calcRevenue(weekEntries)
    const monthRevenue = calcRevenue(monthEntries)

    const pendingAmount = pendingEntries.reduce((sum, e) => sum + Number(e.amount), 0)

    // Calculate daily average for projection
    const avgDailyRevenue = monthRevenue / 30

    return {
      // Balances
      available_balance: Number(account.available_balance),
      pending_balance: pendingAmount,
      total_balance: Number(account.balance),
      currency: account.currency_code,

      // Revenue metrics
      today: {
        revenue: todayRevenue,
        transaction_count: todayEntries.filter(e => e.direction === "CREDIT").length,
      },
      week: {
        revenue: weekRevenue,
        transaction_count: weekEntries.filter(e => e.direction === "CREDIT").length,
      },
      month: {
        revenue: monthRevenue,
        transaction_count: monthEntries.filter(e => e.direction === "CREDIT").length,
      },

      // Projections
      projections: {
        avg_daily_revenue: avgDailyRevenue,
        projected_week: avgDailyRevenue * 7,
        projected_month: avgDailyRevenue * 30,
      },

      // Recent activity
      recent_transactions: entries.slice(0, 10).map(e => ({
        id: e.id,
        amount: Number(e.amount),
        direction: e.direction,
        entry_type: e.entry_type,
        description: e.description,
        created_at: e.created_at,
      })),

      // Advance status - simplified
      advance: activeAdvances.length > 0 ? {
        has_active: true,
        principal: Number(activeAdvances[0].principal_amount || 0),
        outstanding: Number(activeAdvances[0].outstanding_balance || 0),
        repaid: Number(activeAdvances[0].total_repaid || 0),
      } : {
        has_active: false,
      },

      // Payout settings - simplified
      payout: payoutConfigs.length > 0 ? {
        default_tier: payoutConfigs[0].default_payout_tier || "WEEKLY",
        auto_enabled: payoutConfigs[0].auto_payout_enabled || false,
      } : null,

      // Investment pools — quiescent under Posture A unless
      // FF_INVESTMENT_POOLS_V1 is set (docs/POSTURE_A_COMPLIANCE.md, and
      // docs/TRANSMUTATION_STRATEGY.md §7.2). Gated here rather than only at
      // the route because this dashboard is not one of the flagged matchers,
      // and the service layer is where this repo puts boundaries that must
      // not be routed around.
      investment_pools: !featureFlagState.isEnabled("INVESTMENT_POOLS_V1")
        ? []
        : pools.map((p) => ({
            id: p.id,
            name: p.name,
            target: Number(p.target_amount || 0),
            raised: Number(p.total_raised || 0),
            status: p.status,
            carrier: projectPoolCarrier(p),
          })),
    }
  }

  // ==================== SPLIT PAYOUTS ====================

  /**
   * Get or create payout config for a vendor
   */
  async getOrCreatePayoutConfig(vendorId: string, ledgerAccountId: string) {
    const existing = await this.listPayoutConfigs({
      vendor_id: vendorId,
    })

    if (existing.length > 0) {
      return existing[0]
    }

    return this.createPayoutConfigs({
      vendor_id: vendorId,
      ledger_account_id: ledgerAccountId,
      default_payout_tier: "WEEKLY" as const,
      auto_payout_enabled: true,
      auto_payout_threshold: 50,
      instant_payout_eligible: false,
      split_payout_enabled: false,
      status: "ACTIVE" as const,
    })
  }

  /**
   * Update payout configuration
   */
  async updatePayoutConfiguration(vendorId: string, updates: {
    default_payout_tier?: "INSTANT" | "SAME_DAY" | "NEXT_DAY" | "WEEKLY"
    auto_payout_enabled?: boolean
    auto_payout_threshold?: number
    split_payout_enabled?: boolean
  }) {
    const configs = await this.listPayoutConfigs({
      vendor_id: vendorId,
    })

    if (configs.length === 0) {
      throw new Error("Payout config not found")
    }

    return this.updatePayoutConfigs({
      id: configs[0].id,
      ...updates,
    })
  }

  /**
   * Add or update a split rule
   */
  async upsertSplitRule(data: {
    vendor_id: string
    payout_config_id: string
    destination_type: string
    percentage: number
    destination_ledger_account_id?: string
    destination_bank_account_id?: string
    label?: string
  }) {
    // Check if rule exists for this destination type
    const existing = await this.listPayoutSplitRules({
      payout_config_id: data.payout_config_id,
      destination_type: data.destination_type,
    })

    if (existing.length > 0) {
      return this.updatePayoutSplitRules({
        id: existing[0].id,
        percentage: data.percentage,
        destination_ledger_account_id: data.destination_ledger_account_id,
        destination_bank_account_id: data.destination_bank_account_id,
        label: data.label,
      })
    }

    return this.createPayoutSplitRules({
      payout_config_id: data.payout_config_id,
      vendor_id: data.vendor_id,
      destination_type: data.destination_type as any,
      percentage: data.percentage,
      destination_ledger_account_id: data.destination_ledger_account_id,
      destination_bank_account_id: data.destination_bank_account_id,
      label: data.label,
      is_active: true,
    })
  }

  /**
   * Process split payouts for incoming revenue
   */
  async processSplitPayout(vendorId: string, grossAmount: number, orderId?: string) {
    const configs = await this.listPayoutConfigs({
      vendor_id: vendorId, split_payout_enabled: true,
    })

    if (configs.length === 0) {
      return null // No split config, all goes to main account
    }

    const config = configs[0]

    // Get split rules
    const rules = await this.listPayoutSplitRules({
      payout_config_id: config.id,
      is_active: true,
    })

    if (rules.length === 0) {
      return null
    }

    // Validate rules sum to 100%
    const totalPercentage = rules.reduce((sum, r) => sum + Number(r.percentage), 0)
    if (Math.abs(totalPercentage - 100) > 0.01) {
      log.warn(`Split rules for vendor ${vendorId} do not sum to 100%: ${totalPercentage}`)
    }

    const splits: Array<{ destination: string; amount: number; ledger_entry_id?: string }> = []

    // Process each rule
    for (const rule of rules) {
      const amount = grossAmount * (Number(rule.percentage) / 100)
      
      if (amount > 0 && rule.destination_ledger_account_id) {
        // Create internal transfer to sub-account
        const entry = await this.createTransfer({
          debit_account_id: config.ledger_account_id,
          credit_account_id: rule.destination_ledger_account_id,
          amount,
          entry_type: "SPLIT_PAYOUT",
          description: rule.label || `Split to ${rule.destination_type}`,
          reference_type: "ORDER",
          reference_id: orderId,
        })

        splits.push({
          destination: rule.destination_type,
          amount,
          ledger_entry_id: entry.id,
        })
      }
    }

    return { splits, total_split: grossAmount }
  }

  // ==================== ECONOMIC STANDING (§5.1) ====================

  /**
   * Aggregate Coalition Credits standing for an MXID per the §2.5
   * entitlements contract. Sums available + pending balances across the
   * customer's USER_WALLET, the seller's SELLER_EARNINGS, and (if any)
   * CREATOR_EARNINGS accounts.
   *
   * `seller_id` resolution comes from `seller_metadata.mxid` (added by
   * Migration202607AddMxidToSellerMetadata). `customer_id` resolution
   * uses Medusa customer.metadata.mxid as the conventional slot — the
   * customer-side metadata is a JSONB blob so the lookup is a single
   * indexed query in production-sized installs.
   *
   * Returns null totals (rather than throwing) when the MXID resolves to
   * no accounts; this is the expected state for new MXIDs that haven't
   * transacted yet.
   */
  async getEconomicStandingByMxid(args: {
    mxid: string
    pgConnection?: { raw: (sql: string, bindings?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>> }> }
  }): Promise<{
    mxid: string
    available: number
    pending: number
    currency: string
    last_settlement_at: string | null
    sources: Array<{
      account_id: string
      account_type: string
      owner_type: string | null
      available: number
      pending: number
    }>
  }> {
    const { mxid } = args
    const ownerIds: string[] = []
    let currency = "USD"

    if (args.pgConnection) {
      try {
        const sellerLookup = await args.pgConnection.raw(
          `SELECT seller_id FROM seller_metadata WHERE mxid = ? AND deleted_at IS NULL LIMIT 1`,
          [mxid]
        )
        const sellerId = sellerLookup?.rows?.[0]?.seller_id
        if (typeof sellerId === "string") ownerIds.push(sellerId)
      } catch {
        // schema not yet migrated; treat as no match
      }

      try {
        const customerLookup = await args.pgConnection.raw(
          `SELECT id FROM customer WHERE metadata->>'mxid' = ? AND deleted_at IS NULL LIMIT 1`,
          [mxid]
        )
        const customerId = customerLookup?.rows?.[0]?.id
        if (typeof customerId === "string") ownerIds.push(customerId)
      } catch {
        // customer table not present in this scope; ignore
      }
    }

    if (ownerIds.length === 0) {
      return {
        mxid,
        available: 0,
        pending: 0,
        currency,
        last_settlement_at: null,
        sources: [],
      }
    }

    const accounts = await this.listLedgerAccounts({
      owner_id: ownerIds,
    })

    let available = 0
    let pending = 0
    const sources: Array<{
      account_id: string
      account_type: string
      owner_type: string | null
      available: number
      pending: number
    }> = []

    for (const account of accounts) {
      const accountAvailable = Number(account.available_balance ?? 0)
      const accountPending = Number(account.pending_balance ?? 0)
      available += accountAvailable
      pending += accountPending
      currency = account.currency_code || currency
      sources.push({
        account_id: account.id,
        account_type: String(account.account_type),
        owner_type: account.owner_type ? String(account.owner_type) : null,
        available: accountAvailable,
        pending: accountPending,
      })
    }

    let last_settlement_at: string | null = null
    if (accounts.length > 0) {
      const accountIds = accounts.map((a) => a.id)
      const recent = await this.listLedgerEntries({
        credit_account_id: accountIds,
      })
      const settlement = recent
        .filter((e) => String((e as unknown as { entry_type?: string }).entry_type ?? "") === "SETTLEMENT")
        .sort((a, b) => {
          const at = new Date((a as unknown as { created_at?: string }).created_at ?? 0).getTime()
          const bt = new Date((b as unknown as { created_at?: string }).created_at ?? 0).getTime()
          return bt - at
        })[0]
      const settlementCreatedAt = (settlement as unknown as { created_at?: string } | undefined)?.created_at
      if (settlementCreatedAt) {
        last_settlement_at = new Date(settlementCreatedAt).toISOString()
      }
    }

    return { mxid, available, pending, currency, last_settlement_at, sources }
  }

  // ==================== KARMA EVENT LOG (W4) ====================
  //
  // The canonical reputation write path (decision D7). All system writers
  // go through recordKarmaEvent — validated against the source registry in
  // karma.ts, idempotent per (source_module, source_id) with the partial
  // unique index as the concurrency backstop, and stamped with a
  // tamper-evidence attestation (signed when the marketplace signing key
  // is configured). The generated create/update/delete methods remain for
  // framework plumbing but are not the write path; nothing should call
  // them for karma directly.

  /**
   * Record one karma event. Returns the (possibly pre-existing) event and
   * whether this call created it. Throws on validation failure — writers
   * are expected to pass registered sources and well-formed reasons.
   */
  async recordKarmaEvent(
    input: KarmaEventInput
  ): Promise<{ event: { id: string }; created: boolean }> {
    const issues = validateKarmaEventInput(input)
    if (issues.length > 0) {
      throw new Error(
        `[hawala-ledger] invalid karma event: ${issues.join("; ")}`
      )
    }

    const sourceModule = input.source_module ?? null
    const sourceId = input.source_id ?? null

    if (sourceModule && sourceId) {
      const existing = await this.listKarmaEvents({
        source_module: sourceModule,
        source_id: sourceId,
      })
      if (existing.length > 0) {
        return { event: existing[0], created: false }
      }
    }

    const occurredAt = input.occurred_at
      ? new Date(input.occurred_at)
      : new Date()
    const attestation = buildKarmaAttestation(input, occurredAt.toISOString())

    try {
      const event = await this.createKarmaEvents({
        member_id: input.member_id,
        delta: input.delta,
        reason: input.reason,
        source_module: sourceModule,
        source_id: sourceId,
        occurred_at: occurredAt,
        metadata: input.metadata ?? null,
        attestation: attestation as unknown as Record<string, unknown>,
      })
      return { event, created: true }
    } catch (error) {
      // Concurrency race on the partial unique index: another writer won.
      if (isKarmaUniqueViolation(error) && sourceModule && sourceId) {
        const existing = await this.listKarmaEvents({
          source_module: sourceModule,
          source_id: sourceId,
        })
        if (existing.length > 0) {
          return { event: existing[0], created: false }
        }
      }
      throw error
    }
  }

  /**
   * A member's karma at now: the signed sum of their event log. Kept as a
   * simple fold — projections that need point-in-time or per-reason views
   * read the log themselves.
   */
  async sumKarmaForMember(memberId: string): Promise<number> {
    const events = (await this.listKarmaEvents(
      { member_id: memberId },
      { select: ["delta"], take: null as unknown as number }
    )) as Array<{ delta: number }>
    return events.reduce((sum, e) => sum + Number(e.delta ?? 0), 0)
  }

  // ==================== EXTERNAL RECONCILIATION ====================
  //
  // Matching external money records (Stripe payouts/charges, bank
  // statement lines, Stellar payments) against ledger entries. Distinct
  // from reconciler.ts, which checks the internal cache-vs-entries
  // invariant. Engine semantics live in external-reconciliation.ts.

  /**
   * Idempotently ingest a batch of external records. Re-ingesting the
   * same (upload_id, external_id) pair is a counted no-op — enforced by
   * the partial unique index — so statement re-uploads and overlapping
   * ingest-job windows are safe.
   */
  async ingestExternalRecords(
    records: Array<{
      external_id: string
      source: string
      amount_cents: number
      currency_code?: string
      reference?: string | null
      description?: string | null
      occurred_at: string | Date
      raw?: Record<string, any> | null
    }>,
    uploadId?: string
  ) {
    const upload_id =
      uploadId ?? `upload-${new Date().toISOString().slice(0, 10)}-${Date.now()}`
    let ingested = 0
    let skipped_duplicates = 0
    const errors: Array<{ external_id: string; error: string }> = []

    for (const record of records) {
      if (!record.external_id || !Number.isInteger(record.amount_cents)) {
        errors.push({
          external_id: record.external_id ?? "(missing)",
          error: "external_id and integer amount_cents are required",
        })
        continue
      }
      const occurredAt = new Date(record.occurred_at)
      if (Number.isNaN(occurredAt.getTime())) {
        errors.push({ external_id: record.external_id, error: "invalid occurred_at" })
        continue
      }
      try {
        const existing = await this.listExternalRecords({
          upload_id,
          external_id: record.external_id,
        })
        if (existing.length > 0) {
          skipped_duplicates++
          continue
        }
        await this.createExternalRecords({
          upload_id,
          external_id: record.external_id,
          source: record.source as any,
          amount_cents: record.amount_cents,
          currency_code: record.currency_code ?? "USD",
          reference: record.reference ?? null,
          description: record.description ?? null,
          occurred_at: occurredAt,
          raw: record.raw ?? null,
          status: "UNMATCHED" as const,
        })
        ingested++
      } catch (err: any) {
        // The partial unique index backstops the pre-check race: a
        // concurrent duplicate insert lands here and is counted, not fatal.
        if (String(err?.message ?? err).toLowerCase().includes("duplicate")) {
          skipped_duplicates++
        } else {
          errors.push({ external_id: record.external_id, error: String(err?.message ?? err) })
        }
      }
    }

    return { upload_id, ingested, skipped_duplicates, errors }
  }

  /**
   * Run reconciliation over one upload batch. Sequential by design (at
   * this scale a loop with an indexed candidate query per record is
   * simpler and fast enough). Dry runs compute and report counts but
   * persist no matches and flip no record statuses.
   */
  async runExternalReconciliation(options: {
    upload_id: string
    rule_ids?: string[]
    dry_run?: boolean
  }) {
    const pgConnection = this.resolvePgConnection()
    if (!pgConnection) {
      throw new Error(
        "External reconciliation requires a database connection (none resolvable from the module container)"
      )
    }

    const dryRun = options.dry_run ?? false
    const run = await this.createReconciliationRuns({
      upload_id: options.upload_id,
      status: "IN_PROGRESS" as const,
      is_dry_run: dryRun,
      // JSONB column; the generated type only admits objects, but a JSON
      // array is the natural shape for an ordered rule list.
      rule_ids: (options.rule_ids ?? null) as any,
      started_at: new Date(),
    })

    try {
      const ruleRows = options.rule_ids?.length
        ? await this.listMatchingRules({ id: options.rule_ids })
        : await this.listMatchingRules({ is_active: true })
      if (ruleRows.length === 0) {
        throw new Error("No matching rules to apply (create one or pass rule_ids)")
      }
      const rules: MatchingRuleInput[] = ruleRows.map((r: any) => ({
        id: r.id,
        criteria: validateCriteria(r.criteria),
      }))

      const externalRows = await this.listExternalRecords(
        { upload_id: options.upload_id, status: "UNMATCHED" },
        { take: 10000 }
      )
      const externals: ExternalRecordInput[] = externalRows.map((r: any) => ({
        id: r.id,
        external_id: r.external_id,
        amount_cents: Number(r.amount_cents),
        currency_code: r.currency_code,
        reference: r.reference ?? null,
        occurred_at: r.occurred_at,
      }))

      // Prefetch candidates per record via the rule-derived SQL bounds,
      // then let the pure engine do exact evaluation and claiming.
      const candidateCache = new Map<string, EntryCandidate[]>()
      for (const external of externals) {
        const bounds = deriveCandidateBounds(rules, external)
        const conditions: string[] = [
          `"deleted_at" IS NULL`,
          `"status" IN ('COMPLETED', 'SETTLED')`,
        ]
        const bindings: any[] = []
        if (bounds.min_cents !== null && bounds.max_cents !== null) {
          conditions.push(`ROUND("amount" * 100) BETWEEN ? AND ?`)
          bindings.push(bounds.min_cents, bounds.max_cents)
        }
        if (bounds.date_from !== null && bounds.date_to !== null) {
          conditions.push(`"created_at" >= ? AND "created_at" <= ?`)
          bindings.push(bounds.date_from.toISOString(), bounds.date_to.toISOString())
        }
        const result = await pgConnection.raw(
          `SELECT "id", "amount", "currency_code", "reference_id", "idempotency_key", "correlation_id", "created_at"
           FROM "hawala_ledger_entry"
           WHERE ${conditions.join(" AND ")}
           ORDER BY "created_at" ASC
           LIMIT 200`,
          bindings
        )
        const rows: any[] = result?.rows ?? (Array.isArray(result) ? result : [])
        candidateCache.set(
          external.id,
          rows.map((row) => ({
            id: row.id,
            amount_cents: dollarsToCents(row.amount),
            currency_code: row.currency_code,
            reference_id: row.reference_id ?? null,
            idempotency_key: row.idempotency_key ?? null,
            correlation_id: row.correlation_id ?? null,
            created_at: row.created_at,
          }))
        )
      }

      const outcome = reconcileRecords(externals, rules, (ext) => candidateCache.get(ext.id) ?? [])

      if (!dryRun) {
        for (const match of outcome.matches) {
          await this.createReconciliationMatches({
            run_id: run.id,
            external_record_id: match.external_record_id,
            ledger_entry_id: match.ledger_entry_id,
            matched_by_rule_id: match.matched_by_rule_id,
            amount_delta_cents: match.amount_delta_cents,
          })
          await this.updateExternalRecords({
            id: match.external_record_id,
            status: "MATCHED" as const,
          })
        }
      }

      await this.updateReconciliationRuns({
        id: run.id,
        status: "COMPLETED" as const,
        matched_count: outcome.matches.length,
        unmatched_count: outcome.unmatched_external_ids.length,
        completed_at: new Date(),
      })

      return {
        run_id: run.id,
        is_dry_run: dryRun,
        matched_count: outcome.matches.length,
        unmatched_count: outcome.unmatched_external_ids.length,
        matches: outcome.matches,
        unmatched_external_ids: outcome.unmatched_external_ids,
      }
    } catch (err: any) {
      await this.updateReconciliationRuns({
        id: run.id,
        status: "FAILED" as const,
        error_message: String(err?.message ?? err),
        completed_at: new Date(),
      }).catch(() => undefined)
      throw err
    }
  }

  // ==================== BALANCE MONITORS ====================

  /**
   * Create a monitor with normalized operator and validated field.
   * Thresholds are integer cents; zero is a valid threshold.
   */
  async createBalanceMonitor(data: {
    account_id: string
    field?: string
    operator: string
    threshold_cents: number
    severity?: "low" | "medium" | "high" | "critical"
    description?: string
    metadata?: Record<string, any>
  }) {
    const field = data.field ?? "balance"
    if (!isMonitorField(field)) {
      throw new Error(
        `Unknown monitor field ${JSON.stringify(field)} (expected balance, available_balance or pending_balance)`
      )
    }
    if (!Number.isInteger(data.threshold_cents)) {
      throw new Error("threshold_cents must be an integer (cents)")
    }
    // Validates the account exists before storing a monitor on it.
    await this.retrieveLedgerAccount(data.account_id)
    return this.createBalanceMonitors({
      account_id: data.account_id,
      field: field as any,
      operator: normalizeOperator(data.operator),
      threshold_cents: data.threshold_cents,
      severity: data.severity ?? ("high" as const),
      description: data.description ?? null,
      metadata: data.metadata ?? null,
    })
  }

  /**
   * Evaluate all active monitors on the given accounts. Edge-triggered:
   * a breach row + observability incident is emitted only on the
   * false→true transition; clears reset the stored state silently (with
   * a metric). Per-monitor failures are logged and never thrown — this
   * runs fire-and-forget after transfers and from the sweep job.
   */
  async evaluateMonitorsForAccounts(
    accountIds: string[],
    options?: {
      /** Test seam / custom sink. Defaults to the module event bus when resolvable. */
      emit?: (eventName: string, data: Record<string, any>) => Promise<void> | void
      now?: Date
    }
  ) {
    const now = options?.now ?? new Date()
    const emit = options?.emit ?? this.resolveEventEmitter()
    const summary = { evaluated: 0, breaches: 0, cleared: 0 }
    if (accountIds.length === 0) return summary

    const monitors = await this.listBalanceMonitors({
      account_id: accountIds,
      is_active: true,
    })

    for (const monitor of monitors as any[]) {
      try {
        const account = await this.retrieveLedgerAccount(monitor.account_id)
        const observedCents = dollarsToCents(
          Number((account as any)[monitor.field] ?? 0)
        )
        const met = conditionMet(
          observedCents,
          normalizeOperator(monitor.operator),
          Number(monitor.threshold_cents)
        )
        const transition = monitorTransition(Boolean(monitor.was_breached), met)
        summary.evaluated++

        await this.updateBalanceMonitors({
          id: monitor.id,
          was_breached: met,
          last_evaluated_at: now,
          ...(transition === "breach" ? { last_breached_at: now } : {}),
        })

        if (transition === "breach") {
          summary.breaches++
          const incident_key = `hawala-monitor-${monitor.id}`
          await this.createMonitorBreaches({
            monitor_id: monitor.id,
            account_id: monitor.account_id,
            observed_cents: observedCents,
            threshold_cents: Number(monitor.threshold_cents),
            operator: monitor.operator,
            field: monitor.field,
            incident_key,
            occurred_at: now,
          })
          if (emit) {
            await emit("observability.incident.triggered", {
              provider: "hawala-ledger",
              severity: monitor.severity ?? "high",
              service: "hawala-ledger",
              incident_key,
              details: {
                monitor_id: monitor.id,
                account_id: monitor.account_id,
                field: monitor.field,
                operator: monitor.operator,
                threshold_cents: Number(monitor.threshold_cents),
                observed_cents: observedCents,
                description: monitor.description ?? null,
                occurred_at: now.toISOString(),
              },
            })
            await emit("observability.metric.recorded", {
              name: "hawala.balance_monitor.breach",
              value: observedCents,
              labels: { monitor_id: monitor.id, account_id: monitor.account_id },
            })
          }
        } else if (transition === "clear") {
          summary.cleared++
          if (emit) {
            await emit("observability.metric.recorded", {
              name: "hawala.balance_monitor.clear",
              value: observedCents,
              labels: { monitor_id: monitor.id, account_id: monitor.account_id },
            })
          }
        }
      } catch (err: any) {
        log.warn(
          `balance monitor ${monitor?.id ?? "?"} evaluation failed: ${err?.message ?? err}`
        )
      }
    }

    return summary
  }

  /**
   * Resolve the Medusa event bus as an emit callback, or undefined when
   * unreachable (unit tests, degraded container). Alerts still persist as
   * breach rows either way; only the push notification is skipped.
   */
  private resolveEventEmitter():
    | ((eventName: string, data: Record<string, any>) => Promise<void>)
    | undefined {
    const container = (this as any).__container__
    try {
      const eventBus =
        container?.resolve?.("event_bus") ?? container?.["event_bus"]
      if (eventBus?.emit) {
        return async (name, data) => {
          await eventBus.emit({ name, data })
        }
      }
    } catch {
      // fall through — no event bus in this context
    }
    return undefined
  }

  // ==================== LINEAGE & POINT-IN-TIME ====================

  /**
   * All ledger entries belonging to one order's economic action, grouped
   * by correlation, plus the sibling records that point back at them.
   * Pure auto-CRUD reads — no raw SQL — so it works in every context.
   */
  async getOrderLineage(orderId: string) {
    const direct = await this.listLedgerEntries({ order_id: orderId })
    const correlationIds = [
      ...new Set(
        (direct as any[])
          .map((e) => e.correlation_id)
          .filter((c): c is string => typeof c === "string" && c.length > 0)
      ),
    ]
    const correlated = correlationIds.length
      ? await this.listLedgerEntries({ correlation_id: correlationIds })
      : []

    const byId = new Map<string, any>()
    for (const entry of [...(direct as any[]), ...(correlated as any[])]) {
      byId.set(entry.id, entry)
    }
    const entries = [...byId.values()].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    const entryIds = entries.map((e) => e.id)

    const [achTransactions, payoutRequests, vendorPayments] = await Promise.all([
      entryIds.length ? this.listAchTransactions({ ledger_entry_id: entryIds }) : [],
      entryIds.length ? this.listPayoutRequests({ ledger_entry_id: entryIds }) : [],
      entryIds.length ? this.listVendorPayments({ ledger_entry_id: entryIds }) : [],
    ])

    const groups: Record<string, string[]> = {}
    for (const entry of entries) {
      const key = entry.correlation_id ?? "(uncorrelated)"
      ;(groups[key] ??= []).push(entry.id)
    }

    return {
      order_id: orderId,
      entries,
      groups,
      ach_transactions: achTransactions,
      payout_requests: payoutRequests,
      vendor_payments: vendorPayments,
      settlement_batch_ids: [
        ...new Set(entries.map((e) => e.settlement_batch_id).filter(Boolean)),
      ],
    }
  }

  /**
   * The family of one entry: its correlation group when it has one, its
   * order lineage when it only has an order, otherwise the immediate
   * parent/children by parent_entry_id.
   */
  async getEntryLineage(entryId: string) {
    const entry: any = await this.retrieveLedgerEntry(entryId)

    if (entry.correlation_id) {
      const family = await this.listLedgerEntries({
        correlation_id: entry.correlation_id,
      })
      return {
        entry_id: entryId,
        correlation_id: entry.correlation_id,
        entries: (family as any[]).sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
      }
    }

    if (entry.order_id) {
      const lineage = await this.getOrderLineage(entry.order_id)
      return { entry_id: entryId, correlation_id: null, ...lineage }
    }

    const children = await this.listLedgerEntries({ parent_entry_id: entryId })
    const parent = entry.parent_entry_id
      ? await this.retrieveLedgerEntry(entry.parent_entry_id).catch(() => null)
      : null
    return {
      entry_id: entryId,
      correlation_id: null,
      entries: [
        ...(parent ? [parent] : []),
        entry,
        ...(children as any[]),
      ],
    }
  }

  /**
   * The account's balance as of a timestamp, replayed from the entry
   * log — no snapshot table needed at current scale (one indexed SUM per
   * side; the (account, created_at) indexes already exist). Status set
   * matches reconciler.ts: COMPLETED, SETTLED and REVERSED all moved the
   * cached balance (a reversal posts its own offsetting COMPLETED row).
   * Returns dollars (the ledger's native NUMERIC unit) plus a drift
   * cross-check against the cached balance when `at` is now-or-later.
   */
  async getBalanceAt(accountId: string, at: Date | string) {
    const asOf = at instanceof Date ? at : new Date(at)
    if (Number.isNaN(asOf.getTime())) {
      throw new Error(
        `Invalid timestamp ${JSON.stringify(at)} — use ISO 8601 (e.g. 2026-08-01T00:00:00Z)`
      )
    }
    const pgConnection = this.resolvePgConnection()
    if (!pgConnection) {
      throw new Error(
        "getBalanceAt requires a database connection (none resolvable from the module container)"
      )
    }

    const result = await pgConnection.raw(
      `SELECT
         COALESCE(SUM(CASE WHEN "credit_account_id" = ? THEN "amount" ELSE 0 END), 0) AS credits,
         COALESCE(SUM(CASE WHEN "debit_account_id" = ? THEN "amount" ELSE 0 END), 0) AS debits,
         COUNT(*) AS entries_considered
       FROM "hawala_ledger_entry"
       WHERE ("debit_account_id" = ? OR "credit_account_id" = ?)
         AND "created_at" <= ?
         AND "status" IN ('COMPLETED', 'SETTLED', 'REVERSED')
         AND "deleted_at" IS NULL`,
      [accountId, accountId, accountId, accountId, asOf.toISOString()]
    )
    const row = (result?.rows ?? result)?.[0] ?? {}
    const credits = Number(row.credits ?? 0)
    const debits = Number(row.debits ?? 0)
    const balance = credits - debits

    let drift_vs_cached: number | null = null
    if (asOf.getTime() >= Date.now() - 1000) {
      const account: any = await this.retrieveLedgerAccount(accountId)
      drift_vs_cached = Number(account.balance) - balance
    }

    return {
      account_id: accountId,
      as_of: asOf.toISOString(),
      balance,
      credits,
      debits,
      entries_considered: Number(row.entries_considered ?? 0),
      drift_vs_cached,
    }
  }
}

export default HawalaLedgerModuleService

import { createLogger } from "../../shared/logger"
const log = createLogger("modules/hawala-ledger/service")
import { MedusaService, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { auditFinancialTransaction } from "./audit-logger"
import { assertRailInvariants } from "./posture-a-guard"
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
    const existing = await this.listLedgerAccounts({
      account_type: accountType,
      owner_type: "SYSTEM",
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
    currencyCode?: string
  }) {
    if (args.amountCents <= 0) {
      throw new Error("refundCampaignBackingEscrow amountCents must be > 0")
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
            await this.updateBalancesAtomic(trx, data.debit_account_id, -data.amount)
            await this.updateBalancesAtomic(trx, data.credit_account_id, data.amount)
          })
        } else {
          await this.updateBalancesAtomic(pgConnection, data.debit_account_id, -data.amount)
          await this.updateBalancesAtomic(pgConnection, data.credit_account_id, data.amount)
        }
      } else {
        await this.updateBalances(data.debit_account_id, -data.amount)
        await this.updateBalances(data.credit_account_id, data.amount)
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
   * This is a true DB-level compare-and-swap: the `balance + ? >= 0`
   * predicate in the WHERE clause guarantees we never overdraw and never
   * lose a concurrent write (no read-modify-write TOCTOU window). If no
   * row is updated (`rowCount === 0`) the account is missing, deleted, or
   * has insufficient balance for a debit, so we throw.
   *
   * Uses the same `?` positional raw-SQL style as getMemberBalanceByMxid.
   */
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
         AND balance + ? >= 0`,
      [delta, delta, accountId, delta]
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
  }) {
    const entries: any[] = []

    // Get platform fee account
    const platformAccount = await this.getOrCreateSystemAccount("PLATFORM_FEE")

    // Calculate amounts
    const platformFee = data.platform_fee_amount
    let sellerAmount = data.total_amount - platformFee
    let investmentAmount = 0

    // Auto-invest if configured
    if (data.producer_id && data.auto_invest_percentage) {
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
      order_id: data.order_id,
      idempotency_key: `${data.idempotency_key}-purchase`,
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
    const idempotencyKey = data.idempotency_key || `refund-${data.order_id}-${Date.now()}`
    
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

    // Seller entry (reversed last, as the balancing leg — see below)
    const sellerEntry = originalEntries.find(e =>
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

    // 3. Reverse seller earnings (Seller → Escrow). Seller is the balancing leg:
    // seller + fee + investment reversed INTO escrow must equal the customer
    // refund OUT of escrow, so escrow nets to exactly zero and cannot accrue
    // sub-cent drift across the independently-rounded legs (B-money-8).
    const sellerRefund = roundCents(refundAmount - feeRefund - investmentRefundTotal)
    if (sellerEntry && sellerRefund > 0) {
      const sellerRefundEntry = await this.createTransfer({
        debit_account_id: sellerEntry.credit_account_id, // Seller account
        credit_account_id: escrowAccount.id,
        amount: sellerRefund,
        entry_type: "REFUND",
        order_id: data.order_id,
        description: `${description} - seller portion`,
        idempotency_key: `${idempotencyKey}-seller`,
      })
      refundEntries.push(sellerRefundEntry)
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

    const investments = await this.listInvestments({
      pool_id: data.pool_id, status: "CONFIRMED",
    })

    const totalInvested = Number(pool.total_raised)
    const distributions: any[] = []

    for (const investment of investments) {
      // Calculate proportional share
      const share = Number(investment.amount) / totalInvested
      const dividend = Math.floor(data.total_amount * share * 100) / 100

      if (dividend > 0) {
        // Transfer dividend
        const _entry = await this.createTransfer({
          debit_account_id: pool.ledger_account_id,
          credit_account_id: investment.investor_account_id,
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

    // Group investments by pool_id
    const investmentsByPool = new Map<string, number>()
    for (const inv of allInvestments) {
      const count = investmentsByPool.get(inv.pool_id) || 0
      investmentsByPool.set(inv.pool_id, count + 1)
    }

    // Build enriched pools
    return pools.map(pool => {
      const balance = balanceMap.get(pool.ledger_account_id)
      const progress = Number(pool.target_amount) > 0
        ? (Number(pool.total_raised) / Number(pool.target_amount)) * 100
        : 0

      return {
        ...pool,
        current_balance: balance?.balance || 0,
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

    // Main transfer (vendor → settlement)
    await this.createTransfer({
      debit_account_id: account.id,
      credit_account_id: settlementAccount.id,
      amount: netAmount,
      entry_type: "WITHDRAWAL",
      description: `${tierConfig.name} payout`,
      reference_type: "PAYOUT_REQUEST",
      reference_id: payoutRequest.id,
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

    // Check for existing active advances
    const activeAdvances = await this.listVendorAdvances({
      vendor_id: vendorId,
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

    await this.updateVendorAdvances({
      id: advance.id,
      outstanding_balance: newBalance,
      total_repaid: newTotalRepaid,
      status: newBalance <= 0 ? ("REPAID" as const) : ("ACTIVE" as const),
      actual_end_date: newBalance <= 0 ? new Date() : undefined,
    })

    // Record the repayment
    await this.createAdvanceRepayments({
      advance_id: advance.id,
      ledger_entry_id: entry.id,
      order_id: data.order_id,
      principal_amount: repaymentAmount, // Simplified - in reality split principal/fee
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
      // Get active advance
      this.listVendorAdvances({
        vendor_id: vendorId,
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

      // Investment pools - simplified
      investment_pools: pools.map(p => ({
        id: p.id,
        name: p.name,
        target: Number(p.target_amount || 0),
        raised: Number(p.total_raised || 0),
        status: p.status,
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
}

export default HawalaLedgerModuleService

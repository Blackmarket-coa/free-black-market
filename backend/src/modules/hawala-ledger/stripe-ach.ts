import { createLogger } from "../../shared/logger"
const log = createLogger("modules/hawala-ledger/stripe-ach")
import Stripe from "stripe"

export interface AchConfig {
  stripeSecretKey: string
  stripeWebhookSecret: string
  platformFeePercentage: number // 0.008 = 0.8%
  platformFeeMax: number // $5 cap
}

export interface BankAccountData {
  customerId: string
  accountHolderName: string
  accountHolderType: "individual" | "company"
  routingNumber: string
  accountNumber: string
  accountType?: "checking" | "savings"
}

export interface AchDepositResult {
  paymentIntentId: string
  status: string
  amount: number
  fee: number
  netAmount: number
}

/**
 * Stripe ACH Service
 * Handles bank account linking and ACH transfers
 * Fee: 0.8% capped at $5
 */
export class StripeAchService {
  private stripe: Stripe
  private config: AchConfig

  constructor(config: AchConfig) {
    this.stripe = new Stripe(config.stripeSecretKey)
    this.config = config
  }

  /**
   * Calculate ACH fee (0.8% capped at $5)
   */
  calculateFee(amount: number): number {
    const percentageFee = amount * this.config.platformFeePercentage
    return Math.min(percentageFee, this.config.platformFeeMax)
  }

  /**
   * Create or get Stripe customer
   */
  async getOrCreateCustomer(data: {
    customerId: string
    email: string
    name?: string
    metadata?: Record<string, string>
  }): Promise<string> {
    // Search for existing customer by metadata
    const existing = await this.stripe.customers.search({
      query: `metadata['medusa_customer_id']:'${data.customerId}'`,
    })

    if (existing.data.length > 0) {
      return existing.data[0].id
    }

    // Create new customer
    const customer = await this.stripe.customers.create({
      email: data.email,
      name: data.name,
      metadata: {
        medusa_customer_id: data.customerId,
        ...data.metadata,
      },
    })

    return customer.id
  }

  /**
   * Create a Financial Connections session for bank account linking
   * This uses Stripe's secure bank linking flow
   */
  async createBankLinkSession(data: {
    stripeCustomerId: string
    returnUrl: string
  }): Promise<{
    clientSecret: string
    sessionId: string
  }> {
    const session = await this.stripe.financialConnections.sessions.create({
      account_holder: {
        type: "customer",
        customer: data.stripeCustomerId,
      },
      permissions: ["payment_method", "balances"],
      filters: {
        countries: ["US"],
      },
    })

    return {
      clientSecret: session.client_secret!,
      sessionId: session.id,
    }
  }

  /**
   * Create bank account using Financial Connections linked account
   */
  async createBankAccountFromConnection(data: {
    stripeCustomerId: string
    financialConnectionsAccountId: string
  }): Promise<{
    paymentMethodId: string
    bankName: string
    last4: string
  }> {
    const paymentMethod = await this.stripe.paymentMethods.create({
      type: "us_bank_account",
      us_bank_account: {
        financial_connections_account: data.financialConnectionsAccountId,
      },
    })

    // Attach to customer
    await this.stripe.paymentMethods.attach(paymentMethod.id, {
      customer: data.stripeCustomerId,
    })

    return {
      paymentMethodId: paymentMethod.id,
      bankName: paymentMethod.us_bank_account?.bank_name || "Unknown",
      last4: paymentMethod.us_bank_account?.last4 || "****",
    }
  }

  /**
   * Create manual bank account (requires micro-deposit verification)
   * Note: In production, use Stripe.js to tokenize bank account details
   */
  async createManualBankAccount(data: {
    stripeCustomerId: string
    accountHolderName: string
    accountHolderType: "individual" | "company"
    routingNumber: string
    accountNumber: string
  }): Promise<{
    bankAccountId: string
    verificationStatus: string
  }> {
    // Create a SetupIntent for us_bank_account
    const setupIntent = await this.stripe.setupIntents.create({
      customer: data.stripeCustomerId,
      payment_method_types: ["us_bank_account"],
      payment_method_data: {
        type: "us_bank_account",
        billing_details: {
          name: data.accountHolderName,
        },
        us_bank_account: {
          account_holder_type: data.accountHolderType,
          routing_number: data.routingNumber,
          account_number: data.accountNumber,
        },
      },
    })

    return {
      bankAccountId: setupIntent.payment_method as string || setupIntent.id,
      verificationStatus: setupIntent.status || "requires_action",
    }
  }

  /**
   * Verify bank account with micro-deposits
   */
  async verifyBankAccount(data: {
    stripeCustomerId: string
    bankAccountId: string
    amounts: [number, number] // Two micro-deposit amounts in cents
  }): Promise<{ verified: boolean }> {
    try {
      await this.stripe.customers.verifySource(
        data.stripeCustomerId,
        data.bankAccountId,
        { amounts: data.amounts }
      )
      return { verified: true }
    } catch (_error) {
      return { verified: false }
    }
  }

  /**
   * Create ACH deposit (pull funds from bank to platform)
   */
  async createAchDeposit(data: {
    stripeCustomerId: string
    paymentMethodId: string
    amount: number // In dollars
    ledgerAccountId: string
    idempotencyKey: string
    // Client IP + user agent captured at the request edge for the NACHA
    // mandate authorization record. Falls back to documented sentinels when
    // the request context genuinely can't supply them.
    ipAddress?: string
    userAgent?: string
  }): Promise<AchDepositResult> {
    const amountCents = Math.round(data.amount * 100)
    const fee = this.calculateFee(data.amount)
    const netAmount = data.amount - fee

    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        customer: data.stripeCustomerId,
        payment_method: data.paymentMethodId,
        payment_method_types: ["us_bank_account"],
        confirm: true,
        mandate_data: {
          customer_acceptance: {
            type: "online",
            online: {
              // Real client IP is required for the NACHA mandate record; the
              // deposit route threads it from x-forwarded-for / req.ip. The
              // "0.0.0.0" sentinel only survives when no IP is resolvable.
              ip_address: data.ipAddress || "0.0.0.0",
              user_agent: data.userAgent || "hawala-ledger",
            },
          },
        },
        metadata: {
          ledger_account_id: data.ledgerAccountId,
          fee: fee.toString(),
          net_amount: netAmount.toString(),
          type: "ach_deposit",
        },
      },
      { idempotencyKey: data.idempotencyKey }
    )

    return {
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
      amount: data.amount,
      fee,
      netAmount,
    }
  }

  /**
   * Create ACH payout (push funds from platform to bank)
   * Requires Stripe Connect for actual payouts
   */
  async createAchPayout(data: {
    stripeAccountId?: string // For Connect accounts
    amount: number
    destination: string // Bank account ID
    ledgerAccountId: string
    idempotencyKey: string
  }): Promise<{
    payoutId: string
    status: string
    amount: number
    arrivalDate: Date
  }> {
    // For platform payouts
    const payout = await this.stripe.payouts.create(
      {
        amount: Math.round(data.amount * 100),
        currency: "usd",
        destination: data.destination,
        method: "standard", // 'instant' for instant payouts
        metadata: {
          ledger_account_id: data.ledgerAccountId,
          type: "ach_payout",
        },
      },
      {
        idempotencyKey: data.idempotencyKey,
        stripeAccount: data.stripeAccountId,
      }
    )

    return {
      payoutId: payout.id,
      status: payout.status,
      amount: data.amount,
      arrivalDate: new Date(payout.arrival_date * 1000),
    }
  }

  /**
   * Create transfer to Connect account
   */
  async createConnectTransfer(data: {
    destinationAccountId: string
    amount: number
    ledgerAccountId: string
    idempotencyKey: string
  }): Promise<{
    transferId: string
    amount: number
  }> {
    const transfer = await this.stripe.transfers.create(
      {
        amount: Math.round(data.amount * 100),
        currency: "usd",
        destination: data.destinationAccountId,
        metadata: {
          ledger_account_id: data.ledgerAccountId,
          type: "connect_transfer",
        },
      },
      { idempotencyKey: data.idempotencyKey }
    )

    return {
      transferId: transfer.id,
      amount: data.amount,
    }
  }

  /**
   * Get payment intent status
   */
  async getPaymentStatus(paymentIntentId: string): Promise<{
    status: string
    amount: number
    metadata: Record<string, string>
  }> {
    const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId)
    return {
      status: pi.status,
      amount: pi.amount / 100,
      metadata: pi.metadata as Record<string, string>,
    }
  }

  /**
   * Handle webhook events
   */
  async handleWebhook(
    payload: Buffer,
    signature: string
  ): Promise<{
    type: string
    data: any
  }> {
    const event = this.stripe.webhooks.constructEvent(
      payload,
      signature,
      this.config.stripeWebhookSecret
    )

    return {
      type: event.type,
      data: event.data.object,
    }
  }

  /**
   * List customer's bank accounts
   */
  async listBankAccounts(stripeCustomerId: string): Promise<Array<{
    id: string
    bankName: string
    last4: string
    status: string
    type: string
  }>> {
    const paymentMethods = await this.stripe.paymentMethods.list({
      customer: stripeCustomerId,
      type: "us_bank_account",
    })

    return paymentMethods.data.map(pm => ({
      id: pm.id,
      bankName: pm.us_bank_account?.bank_name || "Unknown",
      last4: pm.us_bank_account?.last4 || "****",
      status: pm.us_bank_account?.financial_connections_account ? "verified" : "pending",
      type: pm.us_bank_account?.account_type || "checking",
    }))
  }

  /**
   * Delete bank account
   */
  async deleteBankAccount(data: {
    stripeCustomerId: string
    paymentMethodId: string
  }): Promise<{ deleted: boolean }> {
    await this.stripe.paymentMethods.detach(data.paymentMethodId)
    return { deleted: true }
  }

  /**
   * List payouts as external-reconciliation records. Pages forward with
   * Stripe's cursor (`starting_after`); pass the cursor persisted in
   * `hawala_ingest_cursor` and store `next_cursor` back. Amounts are the
   * signed integer cents Stripe reports.
   */
  async listPayoutsForReconciliation(options?: {
    startingAfter?: string
    limit?: number
  }): Promise<{
    records: Array<{
      external_id: string
      source: "STRIPE_PAYOUT"
      amount_cents: number
      currency_code: string
      reference: string | null
      description: string | null
      occurred_at: Date
      raw: Record<string, any>
    }>
    next_cursor: string | null
    has_more: boolean
  }> {
    const payouts = await this.stripe.payouts.list({
      limit: Math.min(options?.limit ?? 100, 100),
      ...(options?.startingAfter ? { starting_after: options.startingAfter } : {}),
    })
    const records = payouts.data.map((payout) => ({
      external_id: payout.id,
      source: "STRIPE_PAYOUT" as const,
      amount_cents: payout.amount,
      currency_code: payout.currency.toUpperCase(),
      reference: payout.statement_descriptor ?? payout.id,
      description: payout.description ?? null,
      occurred_at: new Date((payout.arrival_date || payout.created) * 1000),
      raw: { id: payout.id, status: payout.status, created: payout.created },
    }))
    const last = payouts.data[payouts.data.length - 1]
    return {
      records,
      next_cursor: payouts.has_more && last ? last.id : null,
      has_more: payouts.has_more,
    }
  }

  /**
   * List balance transactions (charges, refunds, fees, payouts as Stripe
   * itemizes them) as external-reconciliation records — the closest thing
   * Stripe has to a bank statement.
   */
  async listBalanceTransactionsForReconciliation(options?: {
    startingAfter?: string
    limit?: number
  }): Promise<{
    records: Array<{
      external_id: string
      source: "STRIPE_BALANCE_TXN"
      amount_cents: number
      currency_code: string
      reference: string | null
      description: string | null
      occurred_at: Date
      raw: Record<string, any>
    }>
    next_cursor: string | null
    has_more: boolean
  }> {
    const txns = await this.stripe.balanceTransactions.list({
      limit: Math.min(options?.limit ?? 100, 100),
      ...(options?.startingAfter ? { starting_after: options.startingAfter } : {}),
    })
    const records = txns.data.map((txn) => ({
      external_id: txn.id,
      source: "STRIPE_BALANCE_TXN" as const,
      amount_cents: txn.amount,
      currency_code: txn.currency.toUpperCase(),
      reference: typeof txn.source === "string" ? txn.source : (txn.source?.id ?? null),
      description: txn.description ?? txn.type,
      occurred_at: new Date(txn.created * 1000),
      raw: { id: txn.id, type: txn.type, status: txn.status, fee: txn.fee, net: txn.net },
    }))
    const last = txns.data[txns.data.length - 1]
    return {
      records,
      next_cursor: txns.has_more && last ? last.id : null,
      has_more: txns.has_more,
    }
  }
}

/**
 * Create configured ACH service
 */
export function createStripeAchService(): StripeAchService {
  const config: AchConfig = {
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
    platformFeePercentage: 0.008, // 0.8%
    platformFeeMax: 5, // $5 cap
  }

  if (!config.stripeSecretKey) {
    log.warn("STRIPE_SECRET_KEY not configured - ACH features disabled")
  }

  return new StripeAchService(config)
}

/**
 * True when outbound ACH payouts (customer withdrawals) are fully wired.
 *
 * Real payouts push platform funds to a customer's bank via Stripe Connect /
 * external accounts, which requires both a Stripe secret key AND an explicit
 * operator opt-in (`ACH_PAYOUTS_ENABLED=true`) once the Connect payout
 * destination mapping is provisioned. Until then the withdraw route must
 * fail closed rather than debit a customer's ledger with no payout executed.
 *
 * Mirrors the graceful-degradation config gates in
 * `shared/site-provisioning.ts` (`isLaunchConfigured`,
 * `isDeployCallbackConfigured`).
 */
export function isAchPayoutConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
    process.env.ACH_PAYOUTS_ENABLED === "true",
  )
}

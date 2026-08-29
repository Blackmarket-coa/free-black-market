import { createLogger } from "../../shared/logger"
const log = createLogger("modules/hawala-ledger/stellar-settlement")
import {
  Keypair,
  Horizon,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
} from "@stellar/stellar-sdk"
import { createHash } from "crypto"

export interface StellarConfig {
  networkPassphrase: string
  horizonUrl: string
  signerSecretKey: string
  usdcIssuer: string
  /**
   * Retry configuration for Horizon submissions. Defaults to 3 attempts
   * with exponential backoff (250ms, 500ms, 1000ms). Inline today;
   * candidate to swap for `p-retry` (MIT) once a dependency bump lands.
   */
  retry?: {
    maxAttempts?: number
    baseDelayMs?: number
  }
}

/**
 * Lightweight metric counters with a structured-log fallback. When
 * `prom-client` (Apache-2.0) lands in deps, swap the implementation for
 * a `Counter`/`Histogram` registry. Until then, every increment writes a
 * one-line JSON log on stderr so operators can grep counts.
 */
export const stellarMetrics = {
  inc(name: string, labels: Record<string, string | number> = {}) {
    const payload = { metric: name, labels, ts: new Date().toISOString() }
     
    log.warn(JSON.stringify(payload))
  },
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts: number; baseDelayMs: number; metricLabels: Record<string, string> }
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const result = await fn()
      if (attempt > 1) {
        stellarMetrics.inc("stellar.submit.retry_recovered", {
          ...opts.metricLabels,
          attempt,
        })
      }
      return result
    } catch (err) {
      lastErr = err
      stellarMetrics.inc("stellar.submit.retry", {
        ...opts.metricLabels,
        attempt,
        is_final: attempt === opts.maxAttempts ? "true" : "false",
      })
      if (attempt === opts.maxAttempts) break
      const delay = opts.baseDelayMs * Math.pow(2, attempt - 1)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
}

export interface SettlementData {
  batchId: string
  entries: Array<{
    id: string
    amount: number
    debit_account_id: string
    credit_account_id: string
    created_at: Date
  }>
  periodStart: Date
  periodEnd: Date
}

/**
 * Stellar Settlement Service
 * Handles blockchain anchoring and USDC settlements
 */
export class StellarSettlementService {
  private server: Horizon.Server
  private keypair: Keypair
  private networkPassphrase: string
  private usdcAsset: Asset
  private retryConfig: { maxAttempts: number; baseDelayMs: number }

  constructor(config: StellarConfig) {
    this.server = new Horizon.Server(config.horizonUrl)
    this.keypair = Keypair.fromSecret(config.signerSecretKey)
    this.networkPassphrase = config.networkPassphrase
    this.usdcAsset = new Asset("USDC", config.usdcIssuer)
    this.retryConfig = {
      maxAttempts: config.retry?.maxAttempts ?? 3,
      baseDelayMs: config.retry?.baseDelayMs ?? 250,
    }
  }

  /**
   * Compute Merkle root for a batch of entries
   * This provides cryptographic proof of the ledger state
   */
  computeMerkleRoot(entries: Array<{ id: string; amount: number; created_at: Date }>): string {
    if (entries.length === 0) {
      return createHash("sha256").update("empty").digest("hex")
    }

    // Create leaf hashes from entries
    let hashes = entries.map(entry => {
      const data = `${entry.id}:${entry.amount}:${entry.created_at.toISOString()}`
      return createHash("sha256").update(data).digest()
    })

    // Build Merkle tree
    while (hashes.length > 1) {
      const newLevel: Buffer[] = []
      for (let i = 0; i < hashes.length; i += 2) {
        const left = hashes[i]
        const right = hashes[i + 1] || left // Duplicate last if odd
        const combined = Buffer.concat([left as Buffer, right as Buffer])
        newLevel.push(createHash("sha256").update(combined).digest())
      }
      hashes = newLevel as any
    }

    return hashes[0].toString("hex")
  }

  /**
   * Submit settlement batch to Stellar
   * Anchors Merkle root and batch metadata on-chain
   */
  async submitSettlementBatch(data: SettlementData): Promise<{
    txHash: string
    ledgerSequence: number
    feePaid: number
    merkleRoot: string
  }> {
    // Compute Merkle root
    const merkleRoot = this.computeMerkleRoot(data.entries)

    // Get account
    const account = await this.server.loadAccount(this.keypair.publicKey())

    // Build transaction with memo containing batch info
    const memoData = JSON.stringify({
      batch: data.batchId,
      root: merkleRoot.substring(0, 16), // First 16 chars fit in memo
      count: data.entries.length,
    })

    const transaction = new TransactionBuilder(account, {
      fee: "1000", // 0.0001 XLM base fee
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.manageData({
          name: `hawala_batch_${data.batchId}`,
          value: merkleRoot,
        })
      )
      .addMemo(Memo.text(memoData.substring(0, 28))) // Max 28 bytes for text memo
      .setTimeout(30)
      .build()

    // Sign and submit (with retry/backoff on transient Horizon failures)
    transaction.sign(this.keypair)
    let result: { hash: string; ledger: number }
    try {
      result = await withRetry(
        () => this.server.submitTransaction(transaction) as unknown as Promise<{ hash: string; ledger: number }>,
        {
          ...this.retryConfig,
          metricLabels: { op: "submit_settlement_batch", batch_id: data.batchId },
        }
      )
      stellarMetrics.inc("stellar.submit.success", {
        op: "submit_settlement_batch",
        batch_id: data.batchId,
      })
    } catch (err) {
      stellarMetrics.inc("stellar.submit.failure", {
        op: "submit_settlement_batch",
        batch_id: data.batchId,
      })
      throw err
    }

    // Extract fee from result - SDK v13 uses result_xdr for detailed info
    const feeCharged = (result as { fee_charged?: string; feeCharged?: string }).fee_charged ?? (result as { fee_charged?: string; feeCharged?: string }).feeCharged ?? '0'

    return {
      txHash: result.hash,
      ledgerSequence: result.ledger,
      feePaid: parseInt(feeCharged) / 10000000, // Convert stroops to XLM
      merkleRoot,
    }
  }

  /**
   * Process USDC payment on Stellar
   * For actual value transfer between Stellar accounts
   */
  async processUsdcPayment(data: {
    destinationAddress: string
    amount: string
    memo?: string
  }): Promise<{ txHash: string; ledgerSequence: number }> {
    const account = await this.server.loadAccount(this.keypair.publicKey())

    const transactionBuilder = new TransactionBuilder(account, {
      fee: "1000",
      networkPassphrase: this.networkPassphrase,
    }).addOperation(
      Operation.payment({
        destination: data.destinationAddress,
        asset: this.usdcAsset,
        amount: data.amount,
      })
    )

    if (data.memo) {
      transactionBuilder.addMemo(Memo.text(data.memo.substring(0, 28)))
    }

    const transaction = transactionBuilder.setTimeout(30).build()
    transaction.sign(this.keypair)

    let result: { hash: string; ledger: number }
    try {
      result = await withRetry(
        () => this.server.submitTransaction(transaction) as unknown as Promise<{ hash: string; ledger: number }>,
        {
          ...this.retryConfig,
          metricLabels: { op: "process_usdc_payment", destination: data.destinationAddress },
        }
      )
      stellarMetrics.inc("stellar.submit.success", {
        op: "process_usdc_payment",
        destination: data.destinationAddress,
      })
    } catch (err) {
      stellarMetrics.inc("stellar.submit.failure", {
        op: "process_usdc_payment",
        destination: data.destinationAddress,
      })
      throw err
    }

    return {
      txHash: result.hash,
      ledgerSequence: result.ledger,
    }
  }

  /**
   * Create a new Stellar account for a user/producer
   * Returns the new keypair (secret should be encrypted and stored securely)
   */
  async createStellarAccount(): Promise<{
    publicKey: string
    secretKey: string
  }> {
    const newKeypair = Keypair.random()

    // Fund account with minimum balance (in production, use friendbot for testnet)
    const account = await this.server.loadAccount(this.keypair.publicKey())

    const transaction = new TransactionBuilder(account, {
      fee: "1000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.createAccount({
          destination: newKeypair.publicKey(),
          startingBalance: "2", // Minimum balance for trustlines
        })
      )
      .setTimeout(30)
      .build()

    transaction.sign(this.keypair)
    await this.server.submitTransaction(transaction)

    return {
      publicKey: newKeypair.publicKey(),
      secretKey: newKeypair.secret(),
    }
  }

  /**
   * Add USDC trustline to an account
   * Required before receiving USDC payments
   */
  async addUsdcTrustline(secretKey: string): Promise<{ txHash: string }> {
    const userKeypair = Keypair.fromSecret(secretKey)
    const account = await this.server.loadAccount(userKeypair.publicKey())

    const transaction = new TransactionBuilder(account, {
      fee: "1000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.changeTrust({
          asset: this.usdcAsset,
          limit: "1000000", // Max trust limit
        })
      )
      .setTimeout(30)
      .build()

    transaction.sign(userKeypair)
    const result = await this.server.submitTransaction(transaction)

    return { txHash: result.hash }
  }

  /**
   * Verify a settlement batch on-chain
   * Returns the stored Merkle root for verification
   */
  async verifySettlementBatch(batchId: string): Promise<{
    found: boolean
    merkleRoot?: string
  }> {
    try {
      const account = await this.server.loadAccount(this.keypair.publicKey())
      const dataKey = `hawala_batch_${batchId}`
      
      if (account.data_attr && account.data_attr[dataKey]) {
        const merkleRoot = Buffer.from(account.data_attr[dataKey], "base64").toString("utf-8")
        return { found: true, merkleRoot }
      }
      
      return { found: false }
    } catch (_error) {
      return { found: false }
    }
  }

  /**
   * Get current XLM balance for gas fees
   */
  async getXlmBalance(): Promise<number> {
    const account = await this.server.loadAccount(this.keypair.publicKey())
    const xlmBalance = account.balances.find(b => b.asset_type === "native")
    return xlmBalance ? parseFloat(xlmBalance.balance) : 0
  }

  /**
   * Get USDC balance
   */
  async getUsdcBalance(): Promise<number> {
    const account = await this.server.loadAccount(this.keypair.publicKey())
    const usdcBalance = account.balances.find(
      b => b.asset_type === "credit_alphanum4" &&
           b.asset_code === "USDC" &&
           b.asset_issuer === this.usdcAsset.getIssuer()
    )
    return usdcBalance ? parseFloat(usdcBalance.balance) : 0
  }

  /**
   * List payments on the signer account as external-reconciliation
   * records — the "Stellar ledger extract" side of external
   * reconciliation. Pages forward with Horizon's paging_token; pass the
   * token persisted in `hawala_ingest_cursor` and store `next_cursor`
   * back. Amounts are converted to signed integer cents (positive when
   * the signer account received funds, negative when it sent them).
   */
  async listAccountPayments(options?: { cursor?: string; limit?: number }): Promise<{
    records: Array<{
      external_id: string
      source: "STELLAR_PAYMENT"
      amount_cents: number
      currency_code: string
      reference: string | null
      description: string | null
      occurred_at: Date
      raw: Record<string, any>
    }>
    next_cursor: string | null
  }> {
    const publicKey = this.keypair.publicKey()
    let builder = this.server
      .payments()
      .forAccount(publicKey)
      .order("asc")
      .limit(Math.min(options?.limit ?? 100, 200))
      .join("transactions")
    if (options?.cursor) {
      builder = builder.cursor(options.cursor)
    }
    const page = await builder.call()

    const records: Array<{
      external_id: string
      source: "STELLAR_PAYMENT"
      amount_cents: number
      currency_code: string
      reference: string | null
      description: string | null
      occurred_at: Date
      raw: Record<string, any>
    }> = []
    let lastToken: string | null = null

    for (const op of page.records as any[]) {
      lastToken = op.paging_token ?? lastToken
      if (op.type !== "payment") continue
      const outbound = op.from === publicKey
      const cents = Math.round(parseFloat(op.amount) * 100) * (outbound ? -1 : 1)
      const assetCode = op.asset_type === "native" ? "XLM" : (op.asset_code ?? "UNKNOWN")
      // The 28-byte tx memo is a weak key (truncated batch JSON); the
      // transaction hash is the strong one and lands in `reference`.
      records.push({
        external_id: op.id,
        source: "STELLAR_PAYMENT",
        amount_cents: cents,
        currency_code: assetCode,
        reference: op.transaction_hash ?? null,
        description: op.transaction?.memo ?? null,
        occurred_at: new Date(op.created_at),
        raw: {
          id: op.id,
          transaction_hash: op.transaction_hash,
          from: op.from,
          to: op.to,
          asset_code: assetCode,
        },
      })
    }

    return { records, next_cursor: lastToken }
  }
}

/**
 * Create configured settlement service
 */
export function createStellarSettlementService(): StellarSettlementService {
  // Fail fast rather than silently anchoring/settling real value against
  // Stellar TESTNET (and the testnet Circle USDC issuer) in production. When
  // on-chain settlement is enabled in a production deploy, the network MUST be
  // mainnet and the USDC issuer MUST be set explicitly. Mirrors the fail-closed
  // posture in `shared/config.ts`.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_STELLAR_SETTLEMENT === "true"
  ) {
    if (process.env.STELLAR_NETWORK !== "mainnet") {
      throw new Error(
        "Stellar settlement is enabled in production but STELLAR_NETWORK is not 'mainnet' — refusing to settle against testnet",
      )
    }
    if (!process.env.STELLAR_USDC_ISSUER) {
      throw new Error(
        "Stellar settlement is enabled in production but STELLAR_USDC_ISSUER is not set — refusing to fall back to the testnet issuer",
      )
    }
  }

  // Use environment variables for configuration
  const config: StellarConfig = {
    networkPassphrase: process.env.STELLAR_NETWORK === "mainnet" 
      ? Networks.PUBLIC 
      : Networks.TESTNET,
    horizonUrl: process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org",
    signerSecretKey: process.env.STELLAR_SIGNER_SECRET || "",
    usdcIssuer: process.env.STELLAR_USDC_ISSUER || 
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", // Circle USDC on testnet
  }

  if (!config.signerSecretKey) {
    log.warn("STELLAR_SIGNER_SECRET not configured - settlement features disabled")
  }

  return new StellarSettlementService(config)
}

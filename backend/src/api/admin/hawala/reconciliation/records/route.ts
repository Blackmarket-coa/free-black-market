import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/admin/hawala/reconciliation/records")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"

const CSV_HEADER = [
  "external_id",
  "source",
  "amount_cents",
  "currency_code",
  "reference",
  "description",
  "occurred_at",
]

/**
 * Minimal strict CSV: the exact header above, comma-separated, no quoted
 * fields. JSON is the recommended ingest shape; this exists so a bank
 * export can be pasted after a header rename. Per-row failures are
 * reported, not fatal.
 */
function parseCsvRecords(csv: string): {
  records: Array<Record<string, unknown>>
  errors: Array<{ line: number; error: string }>
} {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const errors: Array<{ line: number; error: string }> = []
  if (lines.length < 2) {
    return { records: [], errors: [{ line: 1, error: "CSV needs a header row and at least one data row" }] }
  }
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase())
  if (CSV_HEADER.some((h, i) => header[i] !== h)) {
    return {
      records: [],
      errors: [{ line: 1, error: `CSV header must be exactly: ${CSV_HEADER.join(",")}` }],
    }
  }
  const records: Array<Record<string, unknown>> = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('"')) {
      errors.push({ line: i + 1, error: "quoted fields are not supported — use the JSON body shape" })
      continue
    }
    const cols = line.split(",").map((c) => c.trim())
    if (cols.length !== CSV_HEADER.length) {
      errors.push({ line: i + 1, error: `expected ${CSV_HEADER.length} columns, got ${cols.length}` })
      continue
    }
    const amount = Number(cols[2])
    if (!Number.isInteger(amount)) {
      errors.push({ line: i + 1, error: "amount_cents must be an integer" })
      continue
    }
    records.push({
      external_id: cols[0],
      source: cols[1],
      amount_cents: amount,
      currency_code: cols[3] || "USD",
      reference: cols[4] || null,
      description: cols[5] || null,
      occurred_at: cols[6],
    })
  }
  return { records, errors }
}

/**
 * POST /admin/hawala/reconciliation/records
 * Ingest external records for reconciliation. Body: either
 * `{ upload_id?, records: [...] }` (JSON, recommended) or
 * `{ upload_id?, csv: "..." }` (strict CSV, see parseCsvRecords).
 * Idempotent per (upload_id, external_id).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const body = req.body as {
    upload_id?: string
    records?: Array<Record<string, unknown>>
    csv?: string
  }

  let records = Array.isArray(body.records) ? body.records : []
  let csvErrors: Array<{ line: number; error: string }> = []
  if (!records.length && typeof body.csv === "string") {
    const parsed = parseCsvRecords(body.csv)
    records = parsed.records
    csvErrors = parsed.errors
  }
  if (!records.length && !csvErrors.length) {
    return res.status(400).json({ error: "Provide records[] or csv" })
  }

  try {
    const result = await hawalaService.ingestExternalRecords(
      records as unknown as Parameters<HawalaLedgerModuleService["ingestExternalRecords"]>[0],
      body.upload_id
    )
    res.status(201).json({ ...result, csv_errors: csvErrors })
  } catch (error) {
    log.error("Error ingesting external records:", error)
    const message = error instanceof Error ? error.message : "Failed to ingest records"
    res.status(400).json({ error: message })
  }
}

/**
 * GET /admin/hawala/reconciliation/records
 * List external records (filters: upload_id, source, status).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const { upload_id, source, status, limit = "50", offset = "0" } = req.query

  const filters: Record<string, unknown> = {}
  if (upload_id) filters.upload_id = upload_id
  if (source) filters.source = source
  if (status) filters.status = status

  const take = Math.min(Math.max(parseInt(limit as string) || 50, 1), 200)
  const skip = Math.max(parseInt(offset as string) || 0, 0)

  const records = await hawalaService.listExternalRecords(filters, { take, skip })
  res.json({ records, count: records.length, limit: take, offset: skip })
}

import { createLogger } from "../../../shared/logger"
const log = createLogger("api/vendor/invoices")
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ulid } from "ulid"
import { invoiceSchema } from "../../../shared/phase0-contracts"
import { runQueueConsumer } from "../../../shared/queue-runtime"
import { requeueWithBackoff } from "../../../shared/queue-requeue-adapter"
import {
  createSellerMetadataRecord,
  updateSellerMetadataRecord,
} from "../../../modules/seller-extension/metadata-service"

type InvoiceLifecycleState = "draft" | "sent" | "paid" | "void"

type InvoiceRecord = {
  id: string
  order_id: string
  status: InvoiceLifecycleState
  total: number
  currency_code: string
  issued_at: string | null
  due_at: string | null
  memo?: string
  created_at: string
  updated_at: string
}


export const isAllowedInvoiceTransition = (
  from: InvoiceLifecycleState,
  to: InvoiceLifecycleState
) => {
  if (from === to) return true
  const transitions: Record<InvoiceLifecycleState, InvoiceLifecycleState[]> = {
    draft: ["sent", "void"],
    sent: ["paid", "void"],
    paid: [],
    void: [],
  }
  return transitions[from].includes(to)
}

const getSellerId = (req: MedusaRequest) =>
  (req as unknown as { auth_context?: { actor_id?: string } }).auth_context?.actor_id

async function readInvoiceStore(req: MedusaRequest, sellerId: string): Promise<{ metadataId: string | null; invoices: InvoiceRecord[] }> {
  const query = req.scope.resolve("query")
  const { data } = await query.graph({
    entity: "seller_metadata",
    fields: ["id", "metadata"],
    filters: { seller_id: sellerId },
    pagination: { take: 1 },
  })

  const record = data?.[0] as { id: string; metadata?: Record<string, unknown> } | undefined
  const raw = record?.metadata?.invoices_v1
  const invoices = Array.isArray(raw) ? (raw as InvoiceRecord[]) : []

  return {
    metadataId: record?.id ?? null,
    invoices,
  }
}

async function writeInvoiceStore(req: MedusaRequest, sellerId: string, metadataId: string | null, invoices: InvoiceRecord[]) {
  const sellerExtensionModule = req.scope.resolve("sellerExtension")

  if (metadataId) {
    await updateSellerMetadataRecord(sellerExtensionModule as any, [{
      id: metadataId,
      metadata: { invoices_v1: invoices },
    }])
  } else {
    await createSellerMetadataRecord(sellerExtensionModule as any, [{
      seller_id: sellerId,
      metadata: { invoices_v1: invoices },
    }])
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const { invoices } = await readInvoiceStore(req, sellerId)
  return res.json({ invoices })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const body = req.body as Record<string, unknown>

  if (typeof body.invoice_id === "string") {
    const payload = invoiceSchema.parse(body)
    const result = await runQueueConsumer({
      topicKey: "invoice_issuance",
      payload,
      idempotencyKey: payload.invoice_id,
      handler: async () => undefined,
      publishToDlq: async (message) => {
        log.error("[POST /vendor/invoices][DLQ]", JSON.stringify(message))
      },
      requeue: async (message, delaySeconds) => {
        await requeueWithBackoff(message, delaySeconds)
      },
    })
    return res.status(202).json({ result, topic: "invoice.issuance.v1" })
  }

  const status = (body.status as InvoiceLifecycleState | undefined) ?? "draft"
  if (!["draft", "sent", "paid", "void"].includes(status)) {
    return res.status(400).json({ message: "Invalid invoice status" })
  }

  const now = new Date().toISOString()
  const invoice: InvoiceRecord = {
    id: ulid(),
    order_id: String(body.order_id || ""),
    status,
    total: Number(body.total || 0),
    currency_code: String(body.currency_code || "USD").toUpperCase(),
    issued_at: status === "sent" || status === "paid" ? now : null,
    due_at: body.due_at ? String(body.due_at) : null,
    memo: typeof body.memo === "string" ? body.memo : undefined,
    created_at: now,
    updated_at: now,
  }

  if (!invoice.order_id || !Number.isFinite(invoice.total) || invoice.total < 0) {
    return res.status(400).json({ message: "order_id and non-negative total are required" })
  }

  const store = await readInvoiceStore(req, sellerId)
  const next = [invoice, ...store.invoices]
  await writeInvoiceStore(req, sellerId, store.metadataId, next)

  return res.status(201).json({ invoice })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const body = req.body as { id?: string; status?: InvoiceLifecycleState }
  if (!body.id || !body.status) {
    return res.status(400).json({ message: "id and status are required" })
  }

  const store = await readInvoiceStore(req, sellerId)
  const index = store.invoices.findIndex((i) => i.id === body.id)
  if (index === -1) return res.status(404).json({ message: "Invoice not found" })

  const current = store.invoices[index]
  if (!isAllowedInvoiceTransition(current.status, body.status)) {
    return res.status(400).json({ message: `Invalid transition ${current.status} -> ${body.status}` })
  }

  const nextRecord: InvoiceRecord = {
    ...current,
    status: body.status,
    issued_at: body.status === "sent" && !current.issued_at ? new Date().toISOString() : current.issued_at,
    updated_at: new Date().toISOString(),
  }

  const invoices = [...store.invoices]
  invoices[index] = nextRecord
  await writeInvoiceStore(req, sellerId, store.metadataId, invoices)

  return res.json({ invoice: nextRecord })
}

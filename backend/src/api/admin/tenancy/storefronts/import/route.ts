import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { TENANCY_MODULE } from "../../../../../modules/tenancy"
import TenancyModuleService from "../../../../../modules/tenancy/service"

type Body = {
  csv: string
  mapping?: Record<string, string>
  preset?: "shopify" | "custom"
}

const SHOPIFY_PRESET: Record<string, string> = {
  title: "Title",
  handle: "Handle",
  price: "Variant Price",
  description: "Body (HTML)",
  sku: "Variant SKU",
}

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const body = req.validatedBody || req.body

  const { headers, rows } = service.parseCsvRows(body.csv || "")
  const mapping = body.preset === "shopify" ? SHOPIFY_PRESET : (body.mapping || {})
  const { errors, preview } = service.validateMappedRows(headers, rows, mapping)

  return res.status(200).json({
    headers,
    mapping,
    total_rows: rows.length,
    valid_rows: rows.length - errors.length,
    errors,
    preview: preview.slice(0, 20),
  })
}

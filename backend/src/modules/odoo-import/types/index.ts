import { InferTypeOf } from "@medusajs/framework/types"
import OdooConnection from "../models/odoo-connection"
import OdooImportLog from "../models/odoo-import-log"

export enum OdooImportStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export type OdooCredentials = {
  url: string
  db_name: string
  username: string
  api_key: string
}

/** Subset of the Odoo product.template fields we read for import. */
export type OdooProduct = {
  id: number
  name: string
  display_name?: string
  list_price?: number
  description_sale?: string | false
  description?: string | false
  default_code?: string | false
  barcode?: string | false
  qty_available?: number
  currency_id?: [number, string] | false
  image_1920?: string | false
  is_published?: boolean
}

export interface OdooImportResult {
  imported: number
  updated: number
  failed: number
  skipped: number
  errors: Array<{
    product_name: string
    odoo_product_id: number
    error: string
  }>
}

export interface OdooImportPreview {
  total_products: number
  store_name: string
  url: string
  currency: string
}

export type OdooConnectionType = InferTypeOf<typeof OdooConnection>
export type OdooImportLogType = InferTypeOf<typeof OdooImportLog>

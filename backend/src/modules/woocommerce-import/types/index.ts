import { InferTypeOf } from "@medusajs/framework/types"
import WooCommerceConnection from "../models/woocommerce-connection"
import WooCommerceImportLog from "../models/woocommerce-import-log"

export enum ImportStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export enum SyncStatus {
  IDLE = "idle",
  SYNCING = "syncing",
  FAILED = "failed",
}

export type WooCommerceConnectionType = InferTypeOf<typeof WooCommerceConnection>
export type WooCommerceImportLogType = InferTypeOf<typeof WooCommerceImportLog>

// WooCommerce API response types
export interface WooProduct {
  id: number
  name: string
  slug: string
  permalink: string
  date_created: string
  date_modified: string
  type: "simple" | "grouped" | "external" | "variable"
  status: "draft" | "pending" | "private" | "publish"
  featured: boolean
  description: string
  short_description: string
  sku: string
  price: string
  regular_price: string
  sale_price: string
  on_sale: boolean
  manage_stock: boolean
  stock_quantity: number | null
  stock_status: "instock" | "outofstock" | "onbackorder"
  backorders: string
  backorders_allowed: boolean
  weight: string
  dimensions: {
    length: string
    width: string
    height: string
  }
  images: Array<{
    id: number
    src: string
    name: string
    alt: string
  }>
  categories: Array<{
    id: number
    name: string
    slug: string
  }>
  tags: Array<{
    id: number
    name: string
    slug: string
  }>
  attributes: Array<{
    id: number
    name: string
    position: number
    visible: boolean
    variation: boolean
    options: string[]
  }>
  variations: number[]
  meta_data: Array<{
    id: number
    key: string
    value: any
  }>
}

export interface WooVariation {
  id: number
  sku: string
  price: string
  regular_price: string
  sale_price: string
  on_sale: boolean
  stock_quantity: number | null
  stock_status: string
  manage_stock: boolean
  backorders_allowed: boolean
  weight: string
  dimensions: {
    length: string
    width: string
    height: string
  }
  image: {
    id: number
    src: string
    name: string
    alt: string
  } | null
  attributes: Array<{
    id: number
    name: string
    option: string
  }>
}

export interface WooCategory {
  id: number
  name: string
  slug: string
  parent: number
  count: number
}

export interface ImportPreview {
  total_products: number
  simple_products: number
  variable_products: number
  skipped_products: number
  categories: WooCategory[]
  store_name: string
  store_url: string
  currency: string
}

export interface ImportResult {
  imported: number
  updated: number
  failed: number
  skipped: number
  errors: Array<{
    product_name: string
    woo_product_id: number
    error: string
  }>
}

export interface SyncReport {
  synced_at: string
  products_checked: number
  variants_updated: number
  out_of_stock: string[]
  errors: Array<{
    product: string
    error: string
  }>
}

export interface WooCredentials {
  url: string
  consumer_key: string
  consumer_secret: string
}

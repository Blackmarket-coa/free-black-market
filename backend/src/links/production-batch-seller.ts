import { defineLink } from "@medusajs/framework/utils"
import ProductionLedgerModule from "../modules/production-ledger"
import { loadSellerModule, hasLinkable } from "./utils/load-seller-module"

/**
 * Link: Seller ↔ Production Batch (1:many)
 *
 * Lets a vendor's production batches be queried alongside the seller. Seller
 * module resolved via loadSellerModule() (MercurJS 1.5.0 compat).
 */
const { SellerModule } = loadSellerModule("production-batch-seller")

let productionBatchSellerLink: ReturnType<typeof defineLink> | null = null

if (
  hasLinkable(SellerModule, "seller") &&
  hasLinkable(ProductionLedgerModule, "productionBatch")
) {
  productionBatchSellerLink = defineLink(
    { linkable: SellerModule.linkable.seller, isList: false },
    { linkable: ProductionLedgerModule.linkable.productionBatch, isList: true }
  )
}

export default productionBatchSellerLink

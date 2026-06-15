import { defineLink } from "@medusajs/framework/utils"
import ProducerModule from "../modules/producer"
import { loadSellerModule, hasLinkable } from "./utils/load-seller-module"

/**
 * Link: Seller ↔ Producer (1:1)
 *
 * Links the MercurJS seller to our producer (farm profile) module so farm
 * story, location, and other producer-specific fields can be queried alongside
 * the seller. Only applicable for sellers with vendor_type="producer".
 *
 * The seller module is resolved via loadSellerModule() — under MercurJS 1.5.0
 * `@mercurjs/framework` no longer exports `SellerModule`, so the module must be
 * loaded from `@mercurjs/b2c-core`. The hasLinkable() guards ensure we never
 * register a link with an undefined target (which corrupts the MikroORM graph).
 */

const { SellerModule } = loadSellerModule("producer-seller")

let producerSellerLink: ReturnType<typeof defineLink> | null = null

if (hasLinkable(SellerModule, "seller") && hasLinkable(ProducerModule, "producer")) {
  producerSellerLink = defineLink(
    { linkable: SellerModule.linkable.seller, isList: false },
    { linkable: ProducerModule.linkable.producer, isList: false }
  )
}

export default producerSellerLink

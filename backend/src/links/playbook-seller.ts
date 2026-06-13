import { createLogger } from "../shared/logger"
const log = createLogger("links/playbook-seller")
import { defineLink } from "@medusajs/framework/utils"
import PlaybookModule from "../modules/playbook"

/**
 * Link: Seller ↔ PlaybookAssignment (1:1)
 *
 * Links the MercurJS seller to their playbook assignment (the cooperative-
 * economic shape they picked at setup). A seller has at most one current
 * playbook assignment; re-running the picker updates the assignment row
 * in place.
 *
 * See `docs/PLAYBOOK_SYSTEM.md` and `backend/src/links/producer-seller.ts`
 * for the defensive loader pattern this mirrors.
 */

const LOG_PREFIX = "[Link: playbook-seller]"

let SellerModule: any = null

try {
  SellerModule = require("@mercurjs/framework").SellerModule
  log.info(`${LOG_PREFIX} Loaded SellerModule from @mercurjs/framework`)
} catch (frameworkError: any) {
  try {
    SellerModule = require("@mercurjs/b2c-core/modules/seller").default
    log.info(`${LOG_PREFIX} Loaded SellerModule from @mercurjs/b2c-core/modules/seller`)
  } catch (b2cError: any) {
    log.error(`${LOG_PREFIX} Failed to load SellerModule:`)
    log.error(`${LOG_PREFIX}   @mercurjs/framework: ${frameworkError.message}`)
    log.error(`${LOG_PREFIX}   @mercurjs/b2c-core/modules/seller: ${b2cError.message}`)
    log.error(`${LOG_PREFIX} playbook link will NOT be created`)
  }
}

let playbookSellerLink: ReturnType<typeof defineLink> | null = null

if (SellerModule) {
  try {
    if (!SellerModule.linkable?.seller) {
      throw new Error("SellerModule.linkable.seller is undefined")
    }
    if (!PlaybookModule.linkable?.playbookAssignment) {
      throw new Error("PlaybookModule.linkable.playbookAssignment is undefined")
    }

    playbookSellerLink = defineLink(
      {
        linkable: SellerModule.linkable.seller,
        isList: false,
      },
      {
        linkable: PlaybookModule.linkable.playbookAssignment,
        isList: false,
      }
    )
    log.info(`${LOG_PREFIX} Link defined successfully: seller ↔ playbook_assignment`)
  } catch (linkError: any) {
    log.error(`${LOG_PREFIX} Failed to define link: ${linkError.message}`)
    playbookSellerLink = null
  }
}

export default playbookSellerLink

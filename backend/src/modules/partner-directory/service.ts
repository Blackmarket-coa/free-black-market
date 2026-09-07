import { getPartner, listPartners, partnerLinks } from "./catalog"
import type { PartnerEntry, PartnerFilters } from "./types"

/**
 * Partner directory module service.
 *
 * The directory is code, not rows: `catalog.ts` is the source of truth and
 * this service is the container-resolvable face of it, so routes read it the
 * way they read every other module (`req.scope.resolve(PARTNER_DIRECTORY_MODULE)`)
 * and a later table-backed version can replace these three methods without
 * touching a caller. No models, no migrations, no state.
 */
class PartnerDirectoryModuleService {
  list(filters: PartnerFilters = {}): PartnerEntry[] {
    return listPartners(filters)
  }

  get(key: string): PartnerEntry | null {
    return getPartner(key)
  }

  /** Gatekeeper links for a quest definition: `{ label, url }` in directory order. */
  links(filters: PartnerFilters = {}): { label: string; url: string }[] {
    return partnerLinks(filters)
  }
}

export default PartnerDirectoryModuleService

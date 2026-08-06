import { MedusaService } from "@medusajs/framework/utils"
import MutualAidRequest, { AidRequestStatus } from "./models/mutual-aid-request"
import MutualAidOffer, { AidOfferStatus } from "./models/mutual-aid-offer"
import { isWithinReach, distanceKm } from "../../lib/aid-location"

class MutualAidModuleService extends MedusaService({
  MutualAidRequest,
  MutualAidOffer,
}) {
  /**
   * Offers that could serve a request, nearest first.
   *
   * Matching is done in memory rather than in SQL. A great-circle filter is not
   * expressible as a plain indexed predicate without PostGIS, which this
   * project does not have, and mutual aid volume is small and local by nature —
   * the honest trade is simplicity now over a spatial index for a table that
   * will hold hundreds of rows per city, not millions. If that stops being true
   * this is the seam to replace.
   */
  async findOffersForRequest(requestId: string, limit = 20) {
    const requests = await this.listMutualAidRequests({ id: requestId })
    if (requests.length === 0) {
      throw new Error("Aid request not found")
    }
    const request = requests[0]

    const candidates = await this.listMutualAidOffers({
      status: AidOfferStatus.AVAILABLE,
      ...(request.category ? { category: request.category } : {}),
    })

    return candidates
      .filter((offer) =>
        isWithinReach(
          { latitude: request.latitude, longitude: request.longitude },
          {
            latitude: offer.latitude,
            longitude: offer.longitude,
            service_radius_km: offer.service_radius_km,
          }
        )
      )
      .map((offer) => ({
        offer,
        distance_km: distanceKm(
          { latitude: request.latitude, longitude: request.longitude },
          { latitude: offer.latitude, longitude: offer.longitude }
        ),
      }))
      .sort((a, b) => {
        // Unknown distance sorts last rather than first: a match we can
        // confirm is nearby is more useful than one we cannot place at all.
        if (a.distance_km === null) return 1
        if (b.distance_km === null) return -1
        return a.distance_km - b.distance_km
      })
      .slice(0, limit)
  }

  /**
   * A helper commits to a request.
   *
   * First-come, and guarded so two helpers cannot both believe they have it.
   * The guard matters more here than in an ordinary marketplace: a person
   * waiting on aid who is told twice that help is coming, and then gets none,
   * is worse off than one who was never matched.
   *
   * A requester cannot fill their own request — that would let someone quietly
   * close a request off the public board while appearing fulfilled.
   */
  async matchRequest(input: {
    request_id: string
    offer_id?: string | null
    helper_id: string
  }) {
    const requests = await this.listMutualAidRequests({ id: input.request_id })
    if (requests.length === 0) {
      throw new Error("Aid request not found")
    }
    const request = requests[0]

    if (request.requester_id === input.helper_id) {
      throw new Error("A requester cannot fulfil their own request")
    }
    if (request.status !== AidRequestStatus.OPEN) {
      throw new Error(
        `Cannot match a request with status "${request.status}"`
      )
    }

    const pg = this.resolvePgConnection()
    if (pg) {
      // The `status = 'OPEN'` predicate is what actually decides the race; the
      // read above only reports what was true a moment ago.
      const result = await pg.raw(
        `UPDATE mutual_aid_request
            SET status = 'MATCHED',
                matched_offer_id = ?,
                matched_helper_id = ?,
                matched_at = NOW(),
                updated_at = NOW()
          WHERE id = ?
            AND deleted_at IS NULL
            AND status = 'OPEN'
        RETURNING id`,
        [input.offer_id ?? null, input.helper_id, input.request_id]
      )
      if (!result?.rows?.[0]) {
        throw new Error("This request has already been matched")
      }
    } else {
      // Fallback for environments with no reachable connection (unit tests).
      await this.updateMutualAidRequests({
        id: input.request_id,
        status: AidRequestStatus.MATCHED,
        matched_offer_id: input.offer_id ?? null,
        matched_helper_id: input.helper_id,
        matched_at: new Date(),
      })
    }

    if (input.offer_id) {
      await this.updateMutualAidOffers({
        id: input.offer_id,
        status: AidOfferStatus.COMMITTED,
      })
    }

    const [updated] = await this.listMutualAidRequests({ id: input.request_id })
    return updated
  }

  /**
   * The requester confirms the help arrived.
   *
   * Only the requester may close this. A helper marking their own good deed
   * complete is exactly the self-attestation that makes a reputation score
   * worthless — and this feeds progression XP, so it has to be the person who
   * actually received something who says so.
   */
  async confirmFulfilled(requestId: string, requesterId: string) {
    const requests = await this.listMutualAidRequests({ id: requestId })
    if (requests.length === 0) {
      throw new Error("Aid request not found")
    }
    const request = requests[0]

    if (request.requester_id !== requesterId) {
      throw new Error("Only the requester can confirm fulfilment")
    }
    if (request.status !== AidRequestStatus.MATCHED) {
      throw new Error(
        `Only a matched request can be confirmed; this one is "${request.status}"`
      )
    }

    await this.updateMutualAidRequests({
      id: requestId,
      status: AidRequestStatus.FULFILLED,
      fulfilled_at: new Date(),
    })

    if (request.matched_offer_id) {
      await this.updateMutualAidOffers({
        id: request.matched_offer_id as string,
        status: AidOfferStatus.SPENT,
      })
    }

    const [updated] = await this.listMutualAidRequests({ id: requestId })
    return updated
  }

  /**
   * Resolve a raw pg connection, mirroring the guarded helper in demand-pool.
   * Returns undefined when none is registered so callers can fall back.
   */
  private resolvePgConnection(): { raw: (sql: string, bindings?: unknown[]) => Promise<any> } | undefined {
    try {
      const container = (this as unknown as { __container__?: Record<string, unknown> })
        .__container__
      const conn = container?.["pgConnection"] as
        | { raw: (sql: string, bindings?: unknown[]) => Promise<any> }
        | undefined
      return typeof conn?.raw === "function" ? conn : undefined
    } catch {
      return undefined
    }
  }
}

export default MutualAidModuleService

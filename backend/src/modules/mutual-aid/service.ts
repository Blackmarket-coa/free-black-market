import { MedusaService, ContainerRegistrationKeys } from "@medusajs/framework/utils"
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
    // A helper committing to a need whose date has already passed is worse
    // than a helper who never saw it: the requester gets a notification that
    // help is coming for something they needed weeks ago. The sweep flips
    // these to EXPIRED, but a request posted between two runs of it would
    // still be matchable without this, and the sweep is not a lock.
    if (request.needed_by && new Date(request.needed_by as never) < new Date()) {
      throw new Error("Cannot match a request whose needed-by date has passed")
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
   * The asker takes their request back down.
   *
   * The board had no way to do this at all: `WITHDRAWN` was declared on both
   * enums and written by nothing, so a need that had already been met off the
   * platform — or posted in a moment someone would rather undo — stayed open
   * forever and kept attracting helpers.
   *
   * Withdrawing a *matched* request releases the offer that took it on. Without
   * that the offer sits `COMMITTED` against a request nobody will ever confirm,
   * which quietly removes a willing helper from the board.
   */
  async withdrawRequest(requestId: string, requesterId: string) {
    const requests = await this.listMutualAidRequests({ id: requestId })
    if (requests.length === 0) {
      throw new Error("Aid request not found")
    }
    const request = requests[0]

    if (request.requester_id !== requesterId) {
      throw new Error("Only the requester can withdraw this request")
    }
    if (
      request.status !== AidRequestStatus.OPEN &&
      request.status !== AidRequestStatus.MATCHED
    ) {
      throw new Error(
        `Cannot withdraw a request with status "${request.status}"`
      )
    }

    // Read before the write. The update clears these columns, and whether the
    // row object in hand is the same instance the data layer mutated is not
    // something this method should depend on.
    const committedOfferId = request.matched_offer_id as string | null

    await this.updateMutualAidRequests({
      id: requestId,
      status: AidRequestStatus.WITHDRAWN,
      matched_offer_id: null,
      matched_helper_id: null,
      matched_at: null,
    })

    if (committedOfferId) {
      await this.updateMutualAidOffers({
        id: committedOfferId,
        status: AidOfferStatus.AVAILABLE,
      })
    }

    const [updated] = await this.listMutualAidRequests({ id: requestId })
    return updated
  }

  /**
   * The offerer takes their offer back down.
   *
   * Only from `AVAILABLE`. A `COMMITTED` offer is a promise already made to a
   * specific person who is waiting on it; letting it vanish silently is exactly
   * the failure `matchRequest` guards against from the other direction. The
   * helper's way out of a commitment is the requester withdrawing above, which
   * releases the offer and leaves a trace on the request.
   */
  async withdrawOffer(offerId: string, offererId: string) {
    const offers = await this.listMutualAidOffers({ id: offerId })
    if (offers.length === 0) {
      throw new Error("Aid offer not found")
    }
    const offer = offers[0]

    if (offer.offerer_id !== offererId) {
      throw new Error("Only the offerer can withdraw this offer")
    }
    if (offer.status !== AidOfferStatus.AVAILABLE) {
      throw new Error(`Cannot withdraw an offer with status "${offer.status}"`)
    }

    await this.updateMutualAidOffers({
      id: offerId,
      status: AidOfferStatus.WITHDRAWN,
    })

    const [updated] = await this.listMutualAidOffers({ id: offerId })
    return updated
  }

  /**
   * Retire requests and offers whose stated date has passed.
   *
   * `needed_by` and `available_until` were write-only columns: both routes
   * accepted them, the models stored them, and nothing ever read them back. The
   * public board filters on `status` alone, so a need dated last spring still
   * reads as OPEN and a helper can still commit to it.
   *
   * A null date means "no stated deadline" and is never swept — `$lt` does not
   * match NULL, which is the behaviour wanted here rather than an accident.
   * Only pre-terminal statuses are touched: a FULFILLED request that ran past
   * its date was still fulfilled.
   */
  async expireStaleAid(
    now: Date,
    /**
     * Called once per expired request so the Blackout mirror can close its
     * copy (§3.8). Injected rather than resolved from a container so this stays
     * unit-testable, matching `expireOverduePools`. A failing announcement must
     * never abort the sweep — the status transition is the job's real work.
     */
    onRequestExpired?: (requestId: string) => Promise<void>
  ) {
    const requests = await this.listMutualAidRequests({
      status: AidRequestStatus.OPEN,
      needed_by: { $lt: now },
    })
    for (const request of requests) {
      await this.updateMutualAidRequests({
        id: request.id,
        status: AidRequestStatus.EXPIRED,
      })
      if (onRequestExpired) {
        try {
          await onRequestExpired(request.id as string)
        } catch {
          /* announcement is best-effort */
        }
      }
    }

    const offers = await this.listMutualAidOffers({
      status: AidOfferStatus.AVAILABLE,
      available_until: { $lt: now },
    })
    for (const offer of offers) {
      await this.updateMutualAidOffers({
        id: offer.id,
        status: AidOfferStatus.EXPIRED,
      })
    }

    return { requests_expired: requests.length, offers_expired: offers.length }
  }

  /**
   * Resolve a raw pg connection, matching `demand-pool`'s helper exactly.
   *
   * The shape matters more than it looks. An awilix container exposes its
   * registrations through `resolve()` (or the cradle proxy), not through plain
   * property access, and the key is `ContainerRegistrationKeys.PG_CONNECTION`
   * rather than a hardcoded string. Getting either wrong returns undefined
   * rather than throwing — so `matchRequest` would quietly fall back to the
   * non-atomic read-modify-write path and the `status = 'OPEN'` race guard
   * would never actually run, in production, with unit tests still green
   * because they stub this method.
   *
   * Returns undefined only when nothing is genuinely reachable, which is the
   * case the fallback exists for.
   */
  private resolvePgConnection():
    | { raw: (sql: string, bindings?: any[]) => Promise<any> }
    | undefined {
    const container = (this as any).__container__
    try {
      const pg =
        container?.resolve?.(ContainerRegistrationKeys.PG_CONNECTION) ??
        container?.[ContainerRegistrationKeys.PG_CONNECTION]
      if (pg?.raw) return pg
    } catch {
      // fall through
    }
    try {
      const em =
        (this as any).baseRepository_?.getActiveManager?.() ?? container?.manager
      const knex = em?.getConnection?.()?.getKnex?.()
      if (knex?.raw) return knex
    } catch {
      // no reachable connection
    }
    return undefined
  }
}

export default MutualAidModuleService

import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import jwt from "jsonwebtoken"
import {
  HypeProfileType,
  PredictionMarketState,
  PredictionMode,
  VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE,
} from "../../src/modules/vendor-hype-operations-prediction"
import type VendorHypeOperationsPredictionService from "../../src/modules/vendor-hype-operations-prediction/service"
import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"

jest.setTimeout(120 * 1000)

/**
 * Prediction-market authorization through the real HTTP stack: Medusa's
 * /admin auth, the community-write matcher on /store/vendor-hype/markets, the
 * registered module, and Postgres.
 *
 * Before this: any signed-in account could create a market under any profile,
 * walk any market through its state machine to SETTLED (with no settlement
 * record) at POST /store/vendor-hype/markets/:id/state, and place a position
 * by sending `age_verified: true`. The public listing also showed drafts and
 * the creating account's id.
 */

// Tokens are minted with the server's JWT_SECRET, as helpers/seller-auth.ts
// does, so the test does not depend on an auth provider's registration flow.
const tokenFor = (actorType: "customer" | "user", actorId: string) => {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error("JWT_SECRET is not set in the test env")
  return jwt.sign(
    { actor_id: actorId, actor_type: actorType, auth_identity_id: `authid_${actorId}`, app_metadata: {} },
    secret,
    { expiresIn: "1h" }
  )
}

const withBearer = (base: { headers: Record<string, string> }, token: string) => ({
  headers: { ...base.headers, authorization: `Bearer ${token}` },
})

const marketBody = (profileId: string) => ({
  profile_id: profileId,
  title: "Ships 500 boxes by June",
  jurisdiction_code: "ROW",
  oracle_config_id: "oracle_1",
  starts_at: new Date(Date.now() + 60_000).toISOString(),
  locks_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
})

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const service = () =>
      getContainer().resolve<VendorHypeOperationsPredictionService>(
        VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
      )

    let pak: ReturnType<typeof pakHeaders>
    let profileId: string
    const ownerId = "cus_hype_owner"
    const strangerId = "cus_hype_stranger"

    beforeEach(async () => {
      pak = pakHeaders(await createPublishableKeyToken(getContainer))
      // The profile row is inserted directly, not through createHypeProfile:
      // on a database built from the migrations that insert fails with
      // `column "raw_capital_need_amount" of relation "hype_profile" does not
      // exist` (the model's bigNumber companion column was never migrated).
      // That drift is a separate, pre-existing defect; the route under test
      // only reads the profile, and reads work.
      profileId = `hp_${Math.random().toString(36).slice(2)}`
      const pg = getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION)
      await pg("hype_profile").insert({
        id: profileId,
        profile_type: HypeProfileType.VENDOR,
        owner_id: ownerId,
        slug: profileId,
        display_name: "Owner Co",
        mission: "Make boxes",
      })
    })

    it("lets only the profile owner create a market, and only in DRAFT", async () => {
      const stranger = await api
        .post("/store/vendor-hype/markets", marketBody(profileId), withBearer(pak, tokenFor("customer", strangerId)))
        .catch((e) => e.response)
      expect(stranger.status).toBe(403)
      expect(await service().listPredictionMarkets({ profile_id: profileId })).toHaveLength(0)

      const missing = await api
        .post("/store/vendor-hype/markets", marketBody("hp_does_not_exist"), withBearer(pak, tokenFor("customer", strangerId)))
        .catch((e) => e.response)
      expect(missing.status).toBe(403)
      expect(missing.data).toEqual(stranger.data)

      const owner = await api.post(
        "/store/vendor-hype/markets",
        marketBody(profileId),
        withBearer(pak, tokenFor("customer", ownerId))
      )
      expect(owner.status).toBe(201)
      expect(owner.data.market).toEqual(
        expect.objectContaining({ profile_id: profileId, created_by: ownerId, state: PredictionMarketState.DRAFT })
      )
    })

    it("serves state transitions to admin users only, and no longer under /store", async () => {
      const market = await service().createPredictionMarket({
        ...marketBody(profileId),
        starts_at: new Date(Date.now() + 60_000),
        locks_at: new Date(Date.now() + 7 * 86_400_000),
        created_by: ownerId,
      })

      // Even the profile's owner cannot reach the old store route: it is gone.
      // DRAFT -> SCHEDULED is a legal transition, so before the fix this
      // request succeeded rather than failing on the state machine.
      const storeRoute = await api
        .post(
          `/store/vendor-hype/markets/${market.id}/state`,
          { state: PredictionMarketState.SCHEDULED },
          withBearer(pak, tokenFor("customer", ownerId))
        )
        .catch((e) => e.response)
      expect(storeRoute.status).toBe(404)

      const asCustomer = await api
        .post(
          `/admin/vendor-hype/markets/${market.id}/state`,
          { state: PredictionMarketState.SCHEDULED },
          withBearer({ headers: {} }, tokenFor("customer", ownerId))
        )
        .catch((e) => e.response)
      expect(asCustomer.status).toBe(401)

      let [current] = await service().listPredictionMarkets({ id: market.id })
      expect(current.state).toBe(PredictionMarketState.DRAFT)

      // A draft is not public until an operator publishes it.
      const publicIds = async () => {
        const list = await api.get("/store/vendor-hype/markets", pak)
        expect(list.status).toBe(200)
        return list.data.markets as Array<Record<string, unknown>>
      }
      expect((await publicIds()).map((m) => m.id)).not.toContain(market.id)

      const asAdmin = await api.post(
        `/admin/vendor-hype/markets/${market.id}/state`,
        { state: PredictionMarketState.SCHEDULED },
        withBearer({ headers: {} }, tokenFor("user", "user_hype_operator"))
      )
      expect(asAdmin.status).toBe(200)
      ;[current] = await service().listPredictionMarkets({ id: market.id })
      expect(current.state).toBe(PredictionMarketState.SCHEDULED)

      // Published now, and without the creating account's id.
      const listed = (await publicIds()).find((m) => m.id === market.id)
      expect(listed).toEqual(expect.objectContaining({ state: PredictionMarketState.SCHEDULED }))
      expect(listed).not.toHaveProperty("created_by")
    })

    it("answers operator mistakes with 4xx and never settles a market through the state route", async () => {
      const market = await service().createPredictionMarket({
        ...marketBody(profileId),
        starts_at: new Date(Date.now() + 60_000),
        locks_at: new Date(Date.now() + 7 * 86_400_000),
        created_by: ownerId,
      })
      const operator = withBearer({ headers: {} }, tokenFor("user", "user_hype_operator"))
      const setState = (id: string, body: unknown) =>
        api.post(`/admin/vendor-hype/markets/${id}/state`, body, operator).catch((e) => e.response)

      for (const state of [
        PredictionMarketState.SCHEDULED,
        PredictionMarketState.OPEN,
        PredictionMarketState.LOCKED,
        PredictionMarketState.IN_REVIEW,
      ]) {
        expect((await setState(market.id, { state })).status).toBe(200)
      }

      // in_review -> settled is in the lifecycle, but only settlement may do
      // it. Through the old store route any customer could, leaving a settled
      // market with no settlement record and no payouts.
      const settle = await setState(market.id, { state: PredictionMarketState.SETTLED })
      expect(settle.status).toBe(400)
      let [current] = await service().listPredictionMarkets({ id: market.id })
      expect(current.state).toBe(PredictionMarketState.IN_REVIEW)
      expect(await service().listPredictionSettlements({ market_id: market.id })).toHaveLength(0)

      // Each of these used to be a 500 (and so a Sentry event).
      expect((await setState(market.id, { state: PredictionMarketState.OPEN })).status).toBe(400)
      expect((await setState(market.id, { state: "bogus" })).status).toBe(400)
      expect((await setState("pm_does_not_exist", { state: PredictionMarketState.SCHEDULED })).status).toBe(404)
      ;[current] = await service().listPredictionMarkets({ id: market.id })
      expect(current.state).toBe(PredictionMarketState.IN_REVIEW)
    })

    it("refuses a position on an open market even when the body claims age_verified", async () => {
      const market = await service().createPredictionMarket({
        ...marketBody(profileId),
        starts_at: new Date(Date.now() + 60_000),
        locks_at: new Date(Date.now() + 7 * 86_400_000),
        created_by: ownerId,
      })
      await service().transitionPredictionMarketState(market.id, PredictionMarketState.SCHEDULED)
      await service().transitionPredictionMarketState(market.id, PredictionMarketState.OPEN)

      const res = await api
        .post(
          `/store/vendor-hype/markets/${market.id}/positions`,
          {
            outcome_option_key: "YES",
            stake_amount: 1,
            idempotency_key: "idem_age_claim",
            disclosure_acknowledged: true,
            age_verified: true,
            self_excluded: false,
          },
          withBearer(pak, tokenFor("customer", strangerId))
        )
        .catch((e) => e.response)

      expect(res.status).toBe(403)
      expect(res.data.code).toBe("PREDICTION_AGE_VERIFICATION_REQUIRED")
      expect(await service().listPredictionPositions({ market_id: market.id })).toHaveLength(0)
    })

    // SD-76 follow-up. A policy refusal at creation used to be a plain Error,
    // which the framework answers 500 "An unknown error occurred." (and, in
    // production, reports to Sentry), so the creator never saw the reason.
    it("refuses a mode the jurisdiction's profile does not allow with a coded 403, and writes nothing", async () => {
      const owner = withBearer(pak, tokenFor("customer", ownerId))
      for (const [mode, jurisdiction_code] of [
        [PredictionMode.SWEEPSTAKES, "US-CA"],
        [PredictionMode.SWEEPSTAKES, "US"],
        [PredictionMode.REGULATED_CASH, "US-NV"],
      ]) {
        const res = await api
          .post("/store/vendor-hype/markets", { ...marketBody(profileId), mode, jurisdiction_code }, owner)
          .catch((e) => e.response)
        expect(res.status).toBe(403)
        expect(res.data).toEqual(
          expect.objectContaining({
            type: "policy_denied",
            code: "PREDICTION_MODE_NOT_PERMITTED",
            message: `${mode} markets are not permitted for US (profile US-RESTRICTED)`,
          })
        )
      }
      expect(await service().listPredictionMarkets({ profile_id: profileId })).toHaveLength(0)
    })

    it("records the rules that admitted a market, not a label the caller sends", async () => {
      const res = await api.post(
        "/store/vendor-hype/markets",
        {
          ...marketBody(profileId),
          policy_version: "attacker_v9",
          metadata: { campaign: "spring", policy_decision: { profile: "US-REGULATED-CASH" } },
        },
        withBearer(pak, tokenFor("customer", ownerId))
      )
      expect(res.status).toBe(201)

      const [stored] = await service().listPredictionMarkets({ id: res.data.market.id })
      const current = service().getPolicyDecision(PredictionMode.NON_CASH, "ROW")
      expect(stored.policy_version).toMatch(/^matrix-1\.0\.0@2026-01-01\+map:[0-9a-f]{12}$/)
      expect(stored.policy_version).toBe(current.policy_version)
      // The decision is stored with the market so it can be replayed: no
      // mapping matched ROW, so the unmapped default decided.
      expect(stored.metadata).toEqual({
        campaign: "spring",
        policy_decision: {
          policy_version: current.policy_version,
          mode: PredictionMode.NON_CASH,
          jurisdiction_code: "ROW",
          matched: null,
          profile: "ROW-NONCASH",
          allowed_modes: [PredictionMode.NON_CASH],
        },
      })
    })

    // Markets admitted under the old block list (sweepstakes in the US was
    // allowed before 316f01b) were never re-checked: an operator could still
    // publish and open one. The row is inserted directly, as such a row was.
    it("re-checks the current policy before a market is published, opened or bet on, and still lets an operator void it", async () => {
      const operator = withBearer({ headers: {} }, tokenFor("user", "user_hype_operator"))
      const legacy = async (state: PredictionMarketState) => {
        const [row] = await service().createPredictionMarkets([
          {
            profile_id: profileId,
            title: "Legacy sweepstakes",
            mode: PredictionMode.SWEEPSTAKES,
            jurisdiction_code: "US",
            policy_version: "phase_b_v1",
            oracle_config_id: "oracle_1",
            starts_at: new Date(Date.now() + 60_000),
            locks_at: new Date(Date.now() + 7 * 86_400_000),
            created_by: ownerId,
            state,
          },
        ])
        return row
      }
      const setState = (id: string, state: PredictionMarketState) =>
        api.post(`/admin/vendor-hype/markets/${id}/state`, { state }, operator).catch((e) => e.response)
      const stateOf = async (id: string) => (await service().listPredictionMarkets({ id }))[0].state

      const draft = await legacy(PredictionMarketState.DRAFT)
      const publish = await setState(draft.id, PredictionMarketState.SCHEDULED)
      expect(publish.status).toBe(403)
      expect(publish.data).toEqual(
        expect.objectContaining({ type: "policy_denied", code: "PREDICTION_MODE_NOT_PERMITTED" })
      )
      expect(await stateOf(draft.id)).toBe(PredictionMarketState.DRAFT)

      const scheduled = await legacy(PredictionMarketState.SCHEDULED)
      expect((await setState(scheduled.id, PredictionMarketState.OPEN)).status).toBe(403)
      expect(await stateOf(scheduled.id)).toBe(PredictionMarketState.SCHEDULED)

      // Voiding is how an operator retires such a market, so it stays open to them.
      expect((await setState(draft.id, PredictionMarketState.VOIDED)).status).toBe(200)
      expect(await stateOf(draft.id)).toBe(PredictionMarketState.VOIDED)

      // Placement re-checks too, in the service, ahead of the age gate. The
      // route refuses every placement on the age gate first today (SD-67),
      // so this calls the registered module directly.
      const open = await legacy(PredictionMarketState.OPEN)
      const refused = await service()
        .placePredictionPosition({
          market_id: open.id,
          supporter_id: strangerId,
          outcome_option_key: "YES",
          stake_amount: 1,
          idempotency_key: "idem_legacy",
        })
        .catch((e: unknown) => e)
      expect(refused).toEqual(expect.objectContaining({ code: "PREDICTION_MODE_NOT_PERMITTED" }))
      expect(await service().listPredictionPositions({ market_id: open.id })).toHaveLength(0)
      expect(await service().listUserPredictionSafeties({ supporter_id: strangerId })).toHaveLength(0)
    })
  },
})

import { createHmac, randomUUID } from "crypto"
import http from "http"
import type { AddressInfo } from "net"
import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { createSellerWorkflow } from "@mercurjs/b2c-core/workflows"
import sellerInventoryItemLink from "@mercurjs/b2c-core/links/seller-inventory-item"
import sellerShippingProfileLink from "@mercurjs/b2c-core/links/seller-shipping-profile"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { REQUEST_MODULE } from "../../src/modules/request"
import { SELLER_EXTENSION_MODULE } from "../../src/modules/seller-extension"
import { listSellerMetadataRecords } from "../../src/modules/seller-extension/metadata-service"
import { PLAYBOOK_IDS, PLAYBOOK_MODULE, RESOURCE_KEYS, unionFeatureKeys } from "../../src/modules/playbook"
import seedPlaybookRegistry from "../../src/modules/playbook/loaders/seed-registry"
import { LISTING_TYPE_IDS, LISTING_TYPE_MODULE } from "../../src/modules/listing-type"
import { BLACKSTAR_FULFILLMENT_MODULE } from "../../src/modules/blackstar-fulfillment"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../src/modules/marketplace-webhooks"
import { assignPlaybookWorkflow } from "../../src/workflows/assign-playbook"
import { backfillApprovedSellerPlaybooks } from "../../src/shared/approved-playbook-backfill"
import { pluginSlugsFrom } from "../../src/shared/extension-keys"
import runBackfillScript from "../../src/scripts/backfill-approved-seller-playbooks"
import { newTestPassword } from "./helpers/test-password"

jest.setTimeout(600 * 1000)

/**
 * A vendor's onboarding as the vendor panel, the admin panel and the
 * storefront make it, on the real server and a migrated Postgres. Each case
 * was measured failing before its fix (the MVP scout, 2026-11-17):
 *
 * - Nothing seeded the playbook registry, so approval silently dropped the
 *   application's playbook and the onboarding picker's assign answered 500.
 *   The playbook and listing-type modules now seed their registries from
 *   module loaders on every boot (missing rows only), and
 *   `backfill-approved-seller-playbooks` assigns the sellers approved while
 *   the registry was empty.
 * - "Sign me up to carry deliveries" was dropped at approval. It is now
 *   carried, and it is the only thing that enrolls anyone: a logistics
 *   vendor type used to, with the question answered no. With the Blackstar
 *   emit not configured approval issues no credential (it issued one nobody
 *   held and said it had emitted); with it configured the credential's
 *   secret reaches Blackstar, is redacted wherever a delivery is read back,
 *   and is cleared from the delivery row once delivered (the admin
 *   deliveries route returned it in plaintext, and the row kept it).
 * - A Service vendor could create no product: the panel's form names no
 *   listing type and the default was physical_product, which Service does
 *   not allow. An untyped product now takes the playbook's default.
 * - Products made through /vendor/seller-products had no shipping profile,
 *   and a body naming another store's seller_id there, or in POST
 *   /vendor/products, made the product in that store. A body naming
 *   another store's shipping profile or inventory item, or an item no store
 *   holds, is now refused 403 on both routes and on Mercur's variant
 *   create, and a seller link that fails leaves no product (the routes used
 *   to log it and answer 200).
 * - The admin panel's Accept (POST /admin/requests/:id) answered approval
 *   refusals 500.
 * - The assign route refused three of the thirteen resource keys the quiz
 *   offers and registration accepts (goods, creativity, capital). Both read
 *   one list now: registration and a re-run save every answer and read it
 *   back, and saving them installs no tool and enrolls no one in deliveries.
 * - The wizard's publish step recorded any id as the first published listing.
 *
 * The first case runs on the database as the app booted it; the runner
 * truncates every table between cases and runs the module loaders again,
 * as a restart would. Spends 19 of the auth limiter's 20 a minute (filings
 * and sign-ins; logins are registered through the auth module).
 */

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const container = () => getContainer() as any
    const call = <T = any>(p: Promise<T>) => p.catch((e: any) => e.response)
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`
    const sign = (claims: Record<string, unknown>) => {
      const secret = process.env.JWT_SECRET
      if (!secret) throw new Error("JWT_SECRET is not set in the test env")
      return jwt.sign(claims, secret, { expiresIn: "1h" })
    }
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })
    const pg = () => container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const query = () => container().resolve(ContainerRegistrationKeys.QUERY)

    /** A login as POST /auth/seller/emailpass/register makes one. */
    async function login(prefix: string) {
      const email = `${prefix}-${uid()}@example.com`
      const password = newTestPassword(prefix)
      const auth = container().resolve(Modules.AUTH)
      await auth.register("emailpass", { body: { email, password } } as any)
      const [provider] = await auth.listProviderIdentities({ entity_id: email, provider: "emailpass" })
      return { email, password, authIdentityId: provider.auth_identity_id as string }
    }

    async function adminToken() {
      const admin = await login("admin")
      const [user] = await container().resolve(Modules.USER).createUsers([{ email: admin.email }])
      await container()
        .resolve(Modules.AUTH)
        .updateAuthIdentities([{ id: admin.authIdentityId, app_metadata: { user_id: user.id } }])
      return sign({ actor_id: user.id, actor_type: "user", auth_identity_id: admin.authIdentityId, app_metadata: { user_id: user.id } })
    }

    /** The token the sign-up holds before a store exists. */
    const registrationToken = (who: { authIdentityId: string }) =>
      sign({ actor_id: "", actor_type: "seller", auth_identity_id: who.authIdentityId, app_metadata: {}, user_metadata: {} })

    type Survey = { playbook: string; recommended: string; roles: string[]; resources: string[]; node: boolean; vendor_type: string }

    /** What the vendor panel's sign-up files (useSignUpWithEmailPass). */
    async function file(who: { email: string; authIdentityId: string }, storeName: string, survey: Survey) {
      const filed = await call(
        api.post(
          "/auth/seller/register-request",
          {
            name: storeName,
            vendor_type: survey.vendor_type,
            playbook: survey.playbook,
            recommended_playbook: survey.recommended,
            roles: survey.roles,
            resources: survey.resources,
            node_operator_opt_in: survey.node,
            member: { name: storeName, email: who.email },
          },
          bearer(registrationToken(who))
        )
      )
      expect(filed.status).toBe(201)
      return filed.data.request.id as string
    }

    /** What the admin panel's Accept sends (ResolveRequestPrompt). */
    const accept = async (requestId: string) =>
      call(api.post(`/admin/requests/${requestId}`, { reviewer_note: "", status: "accepted" }, bearer(await adminToken())))

    const signIn = async (who: { email: string; password: string }) => {
      const res = await call(api.post("/auth/seller/emailpass", { email: who.email, password: who.password }))
      expect(res.status).toBe(200)
      return res.data.token as string
    }

    const sellerOf = async (authIdentityId: string) => {
      const [identity] = await container().resolve(Modules.AUTH).listAuthIdentities({ id: [authIdentityId] })
      return identity?.app_metadata?.seller_id as string
    }
    const metadataOf = async (sellerId: string) =>
      (await listSellerMetadataRecords(container().resolve(SELLER_EXTENSION_MODULE), { seller_id: sellerId }))[0]
    const assignmentOf = async (sellerId: string) =>
      (await container().resolve(PLAYBOOK_MODULE).listPlaybookAssignments({ seller_id: sellerId }))[0]
    const stubMail = () =>
      jest.spyOn(container().resolve(Modules.NOTIFICATION), "createNotifications").mockResolvedValue([] as any)
    /** Every node credential ever issued to the store, revoked ones included. */
    const credentialsOf = async (sellerId: string) =>
      container().resolve(BLACKSTAR_FULFILLMENT_MODULE).listBlackstarNodeOperatorCredentials({ seller_id: sellerId })
    /** The queued `node.operator.approved` deliveries, as the table holds them. */
    const nodeDeliveries = async () =>
      container().resolve(MARKETPLACE_WEBHOOKS_MODULE).listWebhookDeliveries({ event: "node.operator.approved" })
    const settingsOf = async (token: string) =>
      (await call(api.get("/vendor/node-operator", bearer(token)))).data.node_operator
    const NODE_OPERATOR_OFF = { opted_in: false, credential: null, status: "off", message: null }

    /** The real boot loader, run against this database in the module's own container. */
    const runPlaybookLoader = async () => {
      const cradle = container().resolve(PLAYBOOK_MODULE).__container__
      const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
      await seedPlaybookRegistry({ container: { resolve: (key: string) => cradle[key] } as unknown as MedusaContainer, logger: logger as any })
      return logger
    }
    const registryRows = async () =>
      (await pg().raw(`SELECT recipe_id, display_name, is_active, deleted_at FROM playbook ORDER BY recipe_id`)).rows as Array<{
        recipe_id: string
        display_name: string
        is_active: boolean
        deleted_at: Date | null
      }>

    /** The vendor panel's product create payload (product-create-form.tsx). */
    async function panelProductPayload(token: string, title: string) {
      const channels = await call(api.get("/vendor/sales-channels", bearer(token)))
      expect(channels.status).toBe(200)
      const channel = channels.data.sales_channels[0]
      return {
        title,
        subtitle: "",
        handle: "",
        description: "",
        discountable: true,
        categories: [],
        tags: [],
        sales_channels: channel ? [{ id: channel.id, name: channel.name }] : [],
        origin_country: "",
        material: "",
        mid_code: "",
        hs_code: "",
        options: [{ title: "Default option", values: ["Default option value"] }],
        status: "published",
        images: [],
        additional_data: undefined,
        variants: [
          {
            title: "Default variant",
            sku: undefined,
            manage_inventory: true,
            allow_backorder: false,
            variant_rank: 0,
            options: { "Default option": "Default option value" },
            prices: [{ currency_code: "usd", amount: 12 }],
          },
        ],
      }
    }

    const productOf = async (productId: string) =>
      (
        await query().graph({
          entity: "product",
          fields: ["id", "shipping_profile.id", "listing_type.catalog_id", "variants.inventory_items.inventory_item_id"],
          filters: { id: productId },
        })
      ).data[0]
    const sellersOfProduct = async (productId: string) =>
      (
        await query().graph({ entity: "seller_product", fields: ["seller_id"], filters: { product_id: productId } })
      ).data.map((row: { seller_id: string }) => row.seller_id)
    const defaultProfileOf = async (sellerId: string) =>
      (
        await query().graph({
          entity: sellerShippingProfileLink.entryPoint,
          fields: ["shipping_profile.id", "shipping_profile.type"],
          filters: { seller_id: sellerId },
        })
      ).data.find((row: any) => row.shipping_profile?.type === "default")?.shipping_profile?.id as string | undefined

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it("after boot both registries are seeded; approval writes the application's playbook and opt-in, and the onboarding assign payloads answer 200", async () => {
      // The registries as the module loaders left them at boot.
      expect((await registryRows()).map((row) => row.recipe_id)).toEqual([...PLAYBOOK_IDS].sort())
      const listingTypes = await container().resolve(LISTING_TYPE_MODULE).listListingTypes({})
      expect(listingTypes.map((row: { catalog_id: string }) => row.catalog_id).sort()).toEqual([...LISTING_TYPE_IDS].sort())

      stubMail()
      const applicant = await login("alpha")
      const storeName = `Alpha Kitchen ${uid()}`
      const requestId = await file(applicant, storeName, {
        playbook: "stall",
        recommended: "hub",
        roles: ["stall", "kitchen"],
        resources: ["transportation", "equipment", "goods"],
        node: true,
        vendor_type: "maker",
      })

      const approved = await accept(requestId)
      expect(approved.status).toBe(200)
      // Approval shows no one the node credential's secret.
      expect(JSON.stringify(approved.data)).not.toMatch(/secret/i)
      const sellerId = approved.data.seller.id as string
      expect(await sellerOf(applicant.authIdentityId)).toBe(sellerId)

      expect(await assignmentOf(sellerId)).toMatchObject({
        recipe_id: "stall",
        recommended_recipe_id: "hub",
        metadata: { roles: ["stall", "kitchen"], resources: ["transportation", "equipment", "goods"] },
      })

      // The opt-in reached the metadata. Blackstar's emit is not configured
      // here, so there is no one to send a secret to: approval issued no
      // credential and queued nothing (it used to issue one nobody held).
      expect((await metadataOf(sellerId)).node_operator_opt_in).toBe(true)
      expect(await credentialsOf(sellerId)).toEqual([])
      expect(await nodeDeliveries()).toEqual([])

      // Settings says so plainly, and turning it on there issues nothing either.
      const token = await signIn(applicant)
      expect(await settingsOf(token)).toEqual({
        opted_in: true,
        credential: null,
        status: "opted_in_no_credential",
        message: expect.stringMatching(/opted in to carry deliveries.*not connected on this marketplace/),
      })
      const turnedOn = await call(api.post("/vendor/node-operator", { opted_in: true }, bearer(token)))
      expect(turnedOn.status).toBe(200)
      expect(turnedOn.data.node_operator).toEqual({
        opted_in: true,
        credential: null,
        secret: null,
        provisioned: false,
        reason: "blackstar_not_configured",
        status: "opted_in_no_credential",
        message: expect.stringMatching(/not connected on this marketplace/),
      })
      expect(await credentialsOf(sellerId)).toEqual([])
      expect(await nodeDeliveries()).toEqual([])

      // The /onboarding PlaybookPicker's save.
      const picked = await call(
        api.post(
          "/vendor/playbook/assign",
          { recipe_id: "stall", answers: { size: "solo", governance: "i_decide", offering: "make_or_grow" }, recommended_recipe_id: "stall", overridden: false },
          bearer(token)
        )
      )
      expect(picked.status).toBe(200)
      expect(picked.data.playbook_assignment).toMatchObject({ seller_id: sellerId, recipe_id: "stall" })

      // The wizard's "Change": the quiz re-run with resources registration accepts.
      const rerun = await call(
        api.post(
          "/vendor/playbook/assign",
          { recipe_id: "stall", recommended_recipe_id: "hub", overridden: true, roles: ["stall", "kitchen"], resources: ["transportation", "goods", "creativity", "capital"] },
          bearer(token)
        )
      )
      expect(rerun.status).toBe(200)
      expect((await assignmentOf(sellerId)).metadata).toEqual({
        roles: ["stall", "kitchen"],
        resources: ["transportation", "goods", "creativity", "capital"],
      })
    })

    it("registration and a quiz re-run save all thirteen resource answers and read them back; saving them installs no tool and enrolls no one in deliveries", async () => {
      stubMail()
      const everyResource = [...RESOURCE_KEYS]
      expect(everyResource).toHaveLength(13)
      expect(everyResource).toEqual(expect.arrayContaining(["goods", "creativity", "capital"]))

      // As delivery-flavoured as an application gets with the deliveries
      // question answered no: hub and kitchen (both carry delivery zones),
      // transportation among the resources.
      const applicant = await login("india")
      const requestId = await file(applicant, `India Hub ${uid()}`, {
        playbook: "hub",
        recommended: "hub",
        roles: ["hub", "kitchen"],
        resources: everyResource,
        node: false,
        vendor_type: "mutual_aid",
      })
      const [stored] = await container().resolve(REQUEST_MODULE).listRequests({ id: requestId })
      expect(stored.data).toMatchObject({ resources: everyResource, roles: ["hub", "kitchen"], node_operator_opt_in: false })

      const approved = await accept(requestId)
      expect(approved.status).toBe(200)
      const sellerId = approved.data.seller.id as string
      const token = await signIn(applicant)

      // Reload: what registration saved reads back.
      const saved = await call(api.get("/vendor/playbook/assign", bearer(token)))
      expect(saved.status).toBe(200)
      expect(saved.data.playbook_assignment).toMatchObject({
        recipe_id: "hub",
        recommended_recipe_id: "hub",
        metadata: { roles: ["hub", "kitchen"], resources: everyResource },
      })
      const planBefore = await call(api.get("/vendor/plan/me", bearer(token)))
      expect(planBefore.status).toBe(200)

      // The wizard's "Change": the quiz re-run with every answer, in another
      // order, and another primary role.
      const reordered = [...everyResource].reverse()
      const rerun = await call(
        api.post(
          "/vendor/playbook/assign",
          { recipe_id: "kitchen", recommended_recipe_id: "hub", overridden: true, roles: ["kitchen", "hub"], resources: reordered },
          bearer(token)
        )
      )
      expect(rerun.status).toBe(200)
      const reloaded = await call(api.get("/vendor/playbook/assign", bearer(token)))
      expect(reloaded.data.playbook_assignment).toMatchObject({
        recipe_id: "kitchen",
        recommended_recipe_id: "hub",
        overridden: true,
        metadata: { roles: ["kitchen", "hub"], resources: reordered },
      })

      // Nothing was inferred from the roles, the resources or the vendor type:
      // the store's features are the roles' own, no plugin was installed, the
      // plan is the one it had, and it is not enrolled in deliveries.
      const metadata = await metadataOf(sellerId)
      expect(metadata.enabled_extensions).toEqual(unionFeatureKeys(["kitchen", "hub"]))
      expect(pluginSlugsFrom(metadata.enabled_extensions)).toEqual([])
      const planAfter = await call(api.get("/vendor/plan/me", bearer(token)))
      expect(planAfter.data.plan.code).toBe("free")
      expect(planAfter.data.plan).toEqual(planBefore.data.plan)
      expect(planAfter.data.feature_keys).toEqual([])
      expect(metadata.node_operator_opt_in).toBe(false)
      expect(await credentialsOf(sellerId)).toEqual([])
      expect(await settingsOf(token)).toEqual(NODE_OPERATOR_OFF)
    })

    it("with the Blackstar emit configured: a logistics applicant who answered no is not enrolled; an opted-in applicant's secret reaches Blackstar, is never read back, and leaves the delivery row once delivered", async () => {
      stubMail()
      // A stand-in for Blackstar's inbound webhook, answering what the test says.
      const received: Array<{ status: number; raw: string; body: any; headers: http.IncomingHttpHeaders }> = []
      let answer = 500
      const blackstar = http.createServer((req, res) => {
        let raw = ""
        req.on("data", (chunk) => (raw += chunk))
        req.on("end", () => {
          received.push({ status: answer, raw, body: JSON.parse(raw), headers: req.headers })
          res.statusCode = answer
          res.end("{}")
        })
      })
      await new Promise<void>((resolve) => blackstar.listen(0, "127.0.0.1", resolve))
      const signingKey = randomUUID()
      process.env.BLACKSTAR_WEBHOOK_SECRET = signingKey
      process.env.BLACKSTAR_API_BASE = `http://127.0.0.1:${(blackstar.address() as AddressInfo).port}`
      try {
        // ---- A logistics vendor type is an archetype, not an answer.
        const carrier = await login("lima")
        const carrierRequestId = await file(carrier, `Lima Carriers ${uid()}`, {
          playbook: "stall",
          recommended: "stall",
          roles: ["stall"],
          resources: ["transportation"],
          node: false,
          vendor_type: "logistics",
        })
        const carrierApproved = await accept(carrierRequestId)
        // 200 although the metadata write fails today (the Postgres enum has
        // no "logistics"; approval logs it and goes on): the store has its
        // seller, member, login link and playbook, and no seller_metadata row.
        expect(carrierApproved.status).toBe(200)
        const carrierSellerId = carrierApproved.data.seller.id as string
        expect((await assignmentOf(carrierSellerId)).recipe_id).toBe("stall")
        expect((await metadataOf(carrierSellerId))?.node_operator_opt_in ?? false).toBe(false)
        expect(await credentialsOf(carrierSellerId)).toEqual([])
        expect(await nodeDeliveries()).toEqual([])
        expect(await settingsOf(await signIn(carrier))).toEqual(NODE_OPERATOR_OFF)

        // ---- An applicant who answered yes.
        const driver = await login("delta")
        const driverRequestId = await file(driver, `Delta Kitchen ${uid()}`, {
          playbook: "kitchen",
          recommended: "kitchen",
          roles: ["kitchen"],
          resources: ["equipment", "transportation"],
          node: true,
          vendor_type: "kitchen",
        })
        const approved = await accept(driverRequestId)
        expect(approved.status).toBe(200)
        expect(JSON.stringify(approved.data)).not.toMatch(/secret/i)
        const sellerId = approved.data.seller.id as string
        expect((await metadataOf(sellerId)).node_operator_opt_in).toBe(true)
        const [credential, ...otherCredentials] = await credentialsOf(sellerId)
        expect(otherCredentials).toEqual([])
        expect(credential).toMatchObject({ status: "active", key_id: expect.stringMatching(/^bsk_/) })

        // One delivery is queued. Until Blackstar accepts it the row holds the
        // envelope it has to send, secret and all.
        const queued = await nodeDeliveries()
        expect(queued).toHaveLength(1)
        const deliveryId = queued[0].id as string
        const secret = queued[0].payload.payload.credential.secret as string
        expect(secret).toMatch(/^[0-9a-f]{64}$/)
        expect(queued[0].payload.payload.credential.key_id).toBe(credential.key_id)
        const redacted = { key_id: credential.key_id, secret: "[redacted]" }
        const rowOf = async () =>
          (await container().resolve(MARKETPLACE_WEBHOOKS_MODULE).listWebhookDeliveries({ id: deliveryId }))[0]

        // Read back by an admin, whatever status it is in: no secret.
        const admin = await adminToken()
        const listedByAdmin = async () => {
          const rows: any[] = []
          for (const status of ["pending", "failed", "dead", "succeeded"]) {
            const listed = await call(api.get(`/admin/blackstar/deliveries?status=${status}`, bearer(admin)))
            expect(listed.status).toBe(200)
            rows.push(...listed.data.deliveries)
          }
          return rows
        }
        const pendingView = await listedByAdmin()
        expect(pendingView.find((row) => row.id === deliveryId)?.payload.payload.credential).toEqual(redacted)
        expect(JSON.stringify(pendingView)).not.toContain(secret)

        // Blackstar is down: the delivery fails and keeps what a retry needs;
        // the replay route answers with the delivery, without the secret.
        const webhooks = container().resolve(MARKETPLACE_WEBHOOKS_MODULE)
        expect(await webhooks.attemptDelivery(deliveryId)).toBe(false)
        expect((await rowOf()).payload.payload.credential.secret).toBe(secret)
        // A row written before response bodies were scrubbed can hold an echo
        // of the secret there; the admin list scrubs it on the way out.
        await pg().raw(`UPDATE marketplace_webhook_delivery SET response_body = ? WHERE id = ?`, [`500 echo ${secret}`, deliveryId])
        const echoView = (await listedByAdmin()).find((row) => row.id === deliveryId)
        expect(echoView.response_body).toBe("500 echo [redacted]")
        const replayed = await call(
          api.post(`/admin/blackstar/deliveries/${deliveryId}/replay`, { attempt_now: false }, bearer(admin))
        )
        expect(replayed.status).toBe(200)
        expect(replayed.data.delivery.payload.payload.credential).toEqual(redacted)
        expect(JSON.stringify(replayed.data)).not.toContain(secret)
        expect(JSON.stringify(await listedByAdmin())).not.toContain(secret)

        // Blackstar accepts: it is sent the real secret, signed, and the row
        // lets go of it.
        answer = 202
        expect(await webhooks.attemptDelivery(deliveryId)).toBe(true)
        const accepted = () => received.filter((request) => request.status === 202)
        // Once, unless the app's own drain job got to the pending row in the
        // same instant; either way what was sent is the real secret.
        expect(accepted().length).toBeGreaterThanOrEqual(1)
        for (const request of accepted()) {
          expect(request.body).toMatchObject({
            event_type: "node.operator.approved",
            payload: { seller_id: sellerId, credential: { key_id: credential.key_id, secret } },
          })
          expect(request.headers["x-fbm-signature"]).toBe(
            createHmac("sha256", signingKey).update(`${request.headers["x-fbm-timestamp"]}.${request.raw}`).digest("hex")
          )
        }
        const sentBeforeRetry = accepted().length
        const delivered = await rowOf()
        expect(delivered.status).toBe("succeeded")
        expect(delivered.payload.payload.credential).toEqual(redacted)
        expect(delivered.payload.payload.seller_id).toBe(sellerId)
        const stillHeld = await pg().raw(
          `SELECT count(*)::int AS n FROM marketplace_webhook_delivery WHERE payload::text LIKE ?`,
          [`%${secret}%`]
        )
        expect(stillHeld.rows[0].n).toBe(0)
        expect(JSON.stringify(await listedByAdmin())).not.toContain(secret)
        // A delivered row is not sent again: its secret is gone.
        expect(await webhooks.attemptDelivery(deliveryId)).toBe(true)
        expect(accepted()).toHaveLength(sentBeforeRetry)
        // A concurrent attempt that read the row before the success and
        // failed after it: its write does not land on the delivered row.
        await (webhooks as any).scheduleRetryOrDie(deliveryId, 2, 500, "late failure")
        expect(await rowOf()).toMatchObject({ status: "succeeded", response_body: delivered.response_body })
        // Had something put it back on the queue anyway, the cleared payload
        // is still not sent, and the row is marked delivered again.
        await pg().raw(`UPDATE marketplace_webhook_delivery SET status = 'failed', next_attempt_at = NOW() WHERE id = ?`, [deliveryId])
        expect(await webhooks.attemptDelivery(deliveryId)).toBe(true)
        expect(accepted()).toHaveLength(sentBeforeRetry)
        expect((await rowOf()).status).toBe("succeeded")
        const replayDelivered = await call(api.post(`/admin/blackstar/deliveries/${deliveryId}/replay`, {}, bearer(admin)))
        expect(replayDelivered.status).toBe(409)
        // A row whose secret is cleared with no delivery behind it is not
        // marked succeeded: it is dead, says why, and a replay cannot send it.
        await pg().raw(`UPDATE marketplace_webhook_delivery SET status = 'pending', delivered_at = NULL, next_attempt_at = NOW() WHERE id = ?`, [deliveryId])
        expect(await webhooks.attemptDelivery(deliveryId)).toBe(false)
        expect(accepted()).toHaveLength(sentBeforeRetry)
        expect(await rowOf()).toMatchObject({ status: "dead", delivered_at: null, response_body: expect.stringMatching(/^Not sent: the credential secret/) })
        const replayCleared = await call(api.post(`/admin/blackstar/deliveries/${deliveryId}/replay`, {}, bearer(admin)))
        expect(replayCleared.status).toBe(200)
        expect(replayCleared.data).toMatchObject({ attempted: true, succeeded: false, delivery: { status: "dead" } })
        expect(accepted()).toHaveLength(sentBeforeRetry)

        // ---- An opted-in applicant whose metadata write fails (a logistics
        // vendor type) and whose provisioning throws: the answer is recorded
        // first, on a row approval creates.
        const echo = await login("echo")
        const echoRequestId = await file(echo, `Echo Haulers ${uid()}`, {
          playbook: "stall",
          recommended: "stall",
          roles: ["stall"],
          resources: ["transportation"],
          node: true,
          vendor_type: "logistics",
        })
        const emitSpy = jest.spyOn(webhooks, "emitBlackstar").mockRejectedValueOnce(new Error("queue down"))
        const echoApproved = await accept(echoRequestId)
        expect(echoApproved.status).toBe(200)
        expect(emitSpy).toHaveBeenCalledTimes(1)
        emitSpy.mockRestore()
        const echoSellerId = echoApproved.data.seller.id as string
        expect(await metadataOf(echoSellerId)).toMatchObject({ node_operator_opt_in: true })
        // The credential issued for the event that never queued was taken back.
        expect((await credentialsOf(echoSellerId)).filter((c: { status: string }) => c.status === "active")).toEqual([])
        expect(await settingsOf(await signIn(echo))).toMatchObject({ opted_in: true, credential: null, status: "opted_in_no_credential" })

        // ---- The vendor's own secret comes from Settings: re-issued, shown once.
        const token = await signIn(driver)
        expect(await settingsOf(token)).toMatchObject({
          opted_in: true,
          status: "active",
          message: null,
          credential: { key_id: credential.key_id },
        })
        const reissued = await call(api.post("/vendor/node-operator", { opted_in: true }, bearer(token)))
        expect(reissued.status).toBe(200)
        expect(reissued.data.node_operator).toMatchObject({ opted_in: true, provisioned: true, reason: null, status: "active" })
        const shownOnce = reissued.data.node_operator.secret as string
        expect(shownOnce).toMatch(/^[0-9a-f]{64}$/)
        expect(shownOnce).not.toBe(secret)
        expect(reissued.data.node_operator.credential.key_id).not.toBe(credential.key_id)
        expect(JSON.stringify(await settingsOf(token))).not.toContain(shownOnce)
        expect(JSON.stringify(await listedByAdmin())).not.toContain(shownOnce)
      } finally {
        delete process.env.BLACKSTAR_WEBHOOK_SECRET
        delete process.env.BLACKSTAR_API_BASE
        await new Promise((resolve) => blackstar.close(resolve))
      }
    })

    it("the registry is seeded again after the tables are emptied, and the loader inserts only what is missing, keeping an operator's edits", async () => {
      // The runner truncated every table and ran the module loaders again.
      expect((await registryRows()).map((row) => row.recipe_id)).toEqual([...PLAYBOOK_IDS].sort())

      // An operator deactivates and renames Stall, soft-deletes Hub; Creator is lost.
      await pg().raw(`UPDATE playbook SET is_active = false, display_name = 'Market Stall' WHERE recipe_id = 'stall'`)
      await pg().raw(`UPDATE playbook SET deleted_at = now() WHERE recipe_id = 'hub'`)
      await pg().raw(`DELETE FROM playbook WHERE recipe_id = 'creator'`)

      const first = await runPlaybookLoader()
      expect(first.info).toHaveBeenCalledWith(expect.stringContaining("seeded 1 missing row(s): creator"))
      const rows = await registryRows()
      expect(rows.map((row) => row.recipe_id)).toEqual([...PLAYBOOK_IDS].sort())
      expect(rows.find((row) => row.recipe_id === "stall")).toMatchObject({ is_active: false, display_name: "Market Stall" })
      expect(rows.find((row) => row.recipe_id === "hub")?.deleted_at).not.toBeNull()

      const second = await runPlaybookLoader()
      expect(second.info).toHaveBeenCalledWith(expect.stringContaining("nothing seeded"))
      expect(await registryRows()).toEqual(rows)
    })

    it("a seller approved while the registry was empty gets the playbook its application recorded from the backfill, once; one with an assignment is refused", async () => {
      stubMail()
      // The registry as it was before the boot loader existed.
      await pg().raw(`DELETE FROM playbook`)
      const applicant = await login("foxtrot")
      const requestId = await file(applicant, `Foxtrot Pantry ${uid()}`, {
        playbook: "kitchen",
        recommended: "kitchen",
        roles: ["kitchen", "hub"],
        resources: ["equipment", "network"],
        node: false,
        vendor_type: "kitchen",
      })
      const other = await login("golf")
      const otherRequestId = await file(other, `Golf Garden ${uid()}`, {
        playbook: "harvest",
        recommended: "harvest",
        roles: ["harvest"],
        resources: ["land"],
        node: false,
        vendor_type: "garden",
      })
      const approved = await accept(requestId)
      const otherApproved = await accept(otherRequestId)
      expect([approved.status, otherApproved.status]).toEqual([200, 200])
      const sellerId = approved.data.seller.id as string
      const otherSellerId = otherApproved.data.seller.id as string
      // What approval left: no assignment, and the warning it logged was all.
      expect(await assignmentOf(sellerId)).toBeUndefined()
      expect(await assignmentOf(otherSellerId)).toBeUndefined()

      // Golf picks a playbook of her own before the backfill runs.
      await runPlaybookLoader()
      await assignPlaybookWorkflow(container()).run({ input: { seller_id: otherSellerId, recipe_id: "grove" } })

      const dry = await backfillApprovedSellerPlaybooks(container(), { apply: false })
      expect(dry.would_assign).toEqual([
        { request_id: requestId, seller_id: sellerId, recipe_id: "kitchen", roles: ["kitchen", "hub"] },
      ])
      expect(dry.already_assigned).toEqual([expect.objectContaining({ request_id: otherRequestId, recipe_id: "grove" })])
      expect(dry.review).toEqual([])
      expect(await assignmentOf(sellerId)).toBeUndefined()

      await runBackfillScript({ container: container(), args: ["apply"] } as any)
      expect(await assignmentOf(sellerId)).toMatchObject({
        recipe_id: "kitchen",
        recommended_recipe_id: "kitchen",
        metadata: { roles: ["kitchen", "hub"], resources: ["equipment", "network"] },
      })
      expect((await assignmentOf(otherSellerId)).recipe_id).toBe("grove")

      const again = await backfillApprovedSellerPlaybooks(container(), { apply: true })
      expect(again.assigned).toEqual([])
      expect(again.already_assigned.map((entry) => entry.request_id).sort()).toEqual([requestId, otherRequestId].sort())
      expect((await assignmentOf(sellerId)).recipe_id).toBe("kitchen")
      expect((await assignmentOf(otherSellerId)).recipe_id).toBe("grove")

      // The backfill's write refuses an assignment made after its read. (A
      // failed workflow run rejects with a plain object, not an Error.)
      await expect(
        assignPlaybookWorkflow(container()).run({ input: { seller_id: otherSellerId, recipe_id: "stall", only_if_unassigned: true } })
      ).rejects.toMatchObject({ message: expect.stringContaining("already has a playbook assignment") })
      expect((await assignmentOf(otherSellerId)).recipe_id).toBe("grove")
    })

    it("an approved Service applicant's panel-made product is created as a bookable slot; opting out of deliveries stays off", async () => {
      stubMail()
      const applicant = await login("charlie")
      const requestId = await file(applicant, `Charlie Coaching ${uid()}`, {
        playbook: "service",
        recommended: "service",
        roles: ["service"],
        resources: ["time"],
        node: false,
        vendor_type: "maker",
      })
      const approved = await accept(requestId)
      expect(approved.status).toBe(200)
      const sellerId = approved.data.seller.id as string
      expect((await assignmentOf(sellerId)).recipe_id).toBe("service")

      expect((await metadataOf(sellerId)).node_operator_opt_in).toBe(false)
      expect(await credentialsOf(sellerId)).toEqual([])
      const token = await signIn(applicant)
      expect(await settingsOf(token)).toEqual(NODE_OPERATOR_OFF)

      const created = await call(api.post("/vendor/seller-products", await panelProductPayload(token, "Coaching session"), bearer(token)))
      // The route answers 200, not 201, as it always has.
      expect(created.status).toBe(200)
      expect(created.data.product.listing_type).toEqual(expect.objectContaining({ catalog_id: "bookable" }))
      expect((await productOf(created.data.product.id)).listing_type).toEqual(
        expect.objectContaining({ catalog_id: "bookable" })
      )

      // A type the request names is still checked against the playbook.
      const physical = await call(
        api.post(
          "/vendor/seller-products",
          { ...(await panelProductPayload(token, "Coaching kit")), additional_data: { listing_type_id: "physical_product" } },
          bearer(token)
        )
      )
      expect(physical.status).toBe(400)
      expect(physical.data.message).toMatch(/not allowed on the Service playbook/)
    })

    it("a panel-made product gets its store's default shipping profile and belongs to the caller's store whatever the body says; the wizard's publish needs one of its products", async () => {
      stubMail()
      const applicant = await login("bravo")
      const requestId = await file(applicant, `Bravo Pantry ${uid()}`, {
        playbook: "stall",
        recommended: "stall",
        roles: ["stall"],
        resources: ["goods"],
        node: false,
        vendor_type: "maker",
      })
      const approved = await accept(requestId)
      expect(approved.status).toBe(200)
      const sellerId = approved.data.seller.id as string
      const token = await signIn(applicant)
      const profileId = await defaultProfileOf(sellerId)
      expect(profileId).toMatch(/^sp_/)

      // Another store, with its own default shipping profile and a product.
      const owner = await login("victor")
      const { result: otherStore } = await createSellerWorkflow.run({
        container: container(),
        input: { auth_identity_id: owner.authIdentityId, member: { name: "Victor", email: owner.email }, seller: { name: `Victor Farm ${uid()}` } } as any,
      })
      const otherProfileId = await defaultProfileOf(otherStore.id)
      const {
        result: [otherProduct],
      } = await createProductsWorkflow(container()).run({
        input: {
          products: [
            {
              title: `Victor Jam ${uid()}`,
              options: [{ title: "Size", values: ["One"] }],
              variants: [{ title: "One", options: { Size: "One" }, manage_inventory: true, prices: [{ currency_code: "usd", amount: 5 }] }],
            } as any,
          ],
          additional_data: { seller_id: otherStore.id },
        },
      })

      const created = await call(api.post("/vendor/seller-products", await panelProductPayload(token, "Wildflower Honey"), bearer(token)))
      expect(created.status).toBe(200)
      const product = await productOf(created.data.product.id)
      expect(product.shipping_profile?.id).toBe(profileId)
      expect(product.listing_type).toEqual(expect.objectContaining({ catalog_id: "physical_product" }))
      expect(await sellersOfProduct(product.id)).toEqual([sellerId])
      const inventoryItemIds = product.variants.flatMap((v: any) => v.inventory_items.map((i: any) => i.inventory_item_id))
      expect(inventoryItemIds).toHaveLength(1)
      const { data: inventoryLinks } = await query().graph({
        entity: sellerInventoryItemLink.entryPoint,
        fields: ["seller_id"],
        filters: { inventory_item_id: inventoryItemIds },
      })
      expect(inventoryLinks.map((row: { seller_id: string }) => row.seller_id)).toEqual([sellerId])

      // A body naming the other store's seller id makes nothing of the other store's.
      const steered = await call(
        api.post(
          "/vendor/seller-products",
          { ...(await panelProductPayload(token, "Steered Honey")), additional_data: { seller_id: otherStore.id } },
          bearer(token)
        )
      )
      expect(steered.status).toBe(200)
      const steeredProduct = await productOf(steered.data.product.id)
      expect(await sellersOfProduct(steeredProduct.id)).toEqual([sellerId])
      expect(steeredProduct.shipping_profile?.id).toBe(profileId)
      expect(steeredProduct.shipping_profile?.id).not.toBe(otherProfileId)
      // A second product of the same type is linked too: the link was
      // one-to-one, and refused every product after a type's first.
      expect(steeredProduct.listing_type).toEqual(expect.objectContaining({ catalog_id: "physical_product" }))

      // The same through POST /vendor/products (FBM's handler behind Mercur's
      // validator, which takes draft or proposed): it made the product in the
      // other store, with that store's shipping profile.
      const viaProducts = await call(
        api.post(
          "/vendor/products",
          { ...(await panelProductPayload(token, "Draft Honey")), status: "draft", additional_data: { seller_id: otherStore.id } },
          bearer(token)
        )
      )
      expect(viaProducts.status).toBe(200)
      const draft = await productOf(viaProducts.data.product.id)
      expect(await sellersOfProduct(draft.id)).toEqual([sellerId])
      expect(draft.shipping_profile?.id).toBe(profileId)
      expect(draft.listing_type).toEqual(expect.objectContaining({ catalog_id: "physical_product" }))

      // A body naming the other store's shipping profile, or its inventory
      // item, is refused on both create routes, and nothing is made.
      const otherItemId = (await productOf(otherProduct.id)).variants[0].inventory_items[0].inventory_item_id as string
      const withItem = async (itemId: string, title: string) => {
        const payload = await panelProductPayload(token, title)
        return { ...payload, variants: [{ ...payload.variants[0], inventory_items: [{ inventory_item_id: itemId, required_quantity: 1 }] }] }
      }
      const withOtherItem = (title: string) => withItem(otherItemId, title)
      const [unlinked] = await container().resolve(Modules.INVENTORY).createInventoryItems([{ sku: `UNLINKED-${uid()}`, title: "Unlinked" }])
      const unlinkedItemId = unlinked.id as string
      const refusals = [
        ["/vendor/seller-products", { ...(await panelProductPayload(token, "Profile Honey")), shipping_profile_id: otherProfileId }],
        ["/vendor/seller-products", { ...(await panelProductPayload(token, "Missing Profile Honey")), shipping_profile_id: "sp_does_not_exist" }],
        ["/vendor/seller-products", await withOtherItem("Item Honey")],
        ["/vendor/products", { ...(await withOtherItem("Draft Item Honey")), status: "draft" }],
        // An item no store is linked to (ticket products make those): not
        // claimed either.
        ["/vendor/seller-products", await withItem(unlinkedItemId, "Unlinked Item Honey")],
        ["/vendor/products", { ...(await withItem(unlinkedItemId, "Draft Unlinked Honey")), status: "draft" }],
      ] as const
      for (const [route, body] of refusals) {
        const refused = await call(api.post(route, body, bearer(token)))
        expect({ route, title: body.title, status: refused.status, type: refused.data.type }).toEqual({ route, title: body.title, status: 403, type: "not_allowed" })
        const made = await pg().raw(`SELECT count(*)::int AS n FROM product WHERE title = ? AND deleted_at IS NULL`, [body.title])
        expect({ title: body.title, made: made.rows[0].n }).toEqual({ title: body.title, made: 0 })
      }
      expect(await defaultProfileOf(otherStore.id)).toBe(otherProfileId)
      const unlinkedLinks = await query().graph({ entity: sellerInventoryItemLink.entryPoint, fields: ["seller_id"], filters: { inventory_item_id: unlinkedItemId } })
      expect(unlinkedLinks.data).toEqual([])
      const otherItemLinks = await query().graph({ entity: sellerInventoryItemLink.entryPoint, fields: ["seller_id"], filters: { inventory_item_id: otherItemId } })
      expect(otherItemLinks.data.map((row: { seller_id: string }) => row.seller_id)).toEqual([otherStore.id])
      // Mercur's variant create on the caller's own product, which FBM does
      // not override: an item no store holds, or another store's, is refused
      // 403 before Mercur's hook can link the store to it.
      const twoSizes = await call(
        api.post(
          "/vendor/seller-products",
          {
            ...(await panelProductPayload(token, "Two Size Honey")),
            options: [{ title: "Size", values: ["Small", "Large"] }],
            variants: [{ ...(await panelProductPayload(token, "x")).variants[0], title: "Small", options: { Size: "Small" } }],
          },
          bearer(token)
        )
      )
      expect(twoSizes.status).toBe(200)
      const twoSizesId = twoSizes.data.product.id as string
      for (const itemId of [unlinkedItemId, otherItemId]) {
        const added = await call(
          api.post(
            `/vendor/products/${twoSizesId}/variants`,
            { title: "Large", options: { Size: "Large" }, prices: [{ currency_code: "usd", amount: 20 }], inventory_items: [{ inventory_item_id: itemId, required_quantity: 1 }] },
            bearer(token)
          )
        )
        expect({ itemId, status: added.status, type: added.data?.type }).toEqual({ itemId, status: 403, type: "not_allowed" })
      }
      const variantsAfter = await pg().raw(`SELECT count(*)::int AS n FROM product_variant WHERE product_id = ? AND deleted_at IS NULL`, [twoSizesId])
      expect(variantsAfter.rows[0].n).toBe(1)
      // A variant update takes no inventory_items (Mercur's schema is strict).
      const smallId = (await productOf(twoSizesId)).variants[0].id as string
      const updated = await call(
        api.post(`/vendor/products/${twoSizesId}/variants/${smallId}`, { inventory_items: [{ inventory_item_id: unlinkedItemId, required_quantity: 1 }] }, bearer(token))
      )
      expect(updated.status).toBe(400)
      const unlinkedAfterVariants = await query().graph({ entity: sellerInventoryItemLink.entryPoint, fields: ["seller_id"], filters: { inventory_item_id: unlinkedItemId } })
      expect(unlinkedAfterVariants.data).toEqual([])

      // The caller's own profile is accepted and used.
      const ownProfile = await call(
        api.post("/vendor/seller-products", { ...(await panelProductPayload(token, "Own Profile Honey")), shipping_profile_id: profileId }, bearer(token))
      )
      expect(ownProfile.status).toBe(200)
      expect((await productOf(ownProfile.data.product.id)).shipping_profile?.id).toBe(profileId)

      // The wizard's publish step: an id that names no product, and another store's, are refused.
      for (const listing_id of ["prod_does_not_exist", otherProduct.id]) {
        const refused = await call(api.post("/vendor/onboarding/publish", { listing_id }, bearer(token)))
        expect({ listing_id, status: refused.status }).toEqual({ listing_id, status: 400 })
        expect(refused.data.message).toBe("listing_id must be the id of a product in your store.")
      }
      const state = await call(api.get("/vendor/onboarding", bearer(token)))
      expect(state.data.state?.wizard_step).not.toBe("published")
      const published = await call(api.post("/vendor/onboarding/publish", { listing_id: product.id }, bearer(token)))
      expect(published.status).toBe(200)
      expect(published.data.state).toMatchObject({ wizard_step: "published", first_published_listing_id: product.id })
    })

    it("a product whose seller link fails is not made: both create routes answer an error and leave nothing behind", async () => {
      stubMail()
      const applicant = await login("hotel")
      const requestId = await file(applicant, `Hotel Pantry ${uid()}`, {
        playbook: "stall",
        recommended: "stall",
        roles: ["stall"],
        resources: ["goods"],
        node: false,
        vendor_type: "maker",
      })
      const approved = await accept(requestId)
      expect(approved.status).toBe(200)
      const sellerId = approved.data.seller.id as string
      const token = await signIn(applicant)

      // Refuse any link that names a seller, the way a broken link write would.
      const failSellerLinks = (target: any) => {
        const original = target.create.bind(target)
        return jest.spyOn(target, "create").mockImplementation(async (links: any) => {
          const list = Array.isArray(links) ? links : [links]
          if (list.some((link: any) => link && Object.prototype.hasOwnProperty.call(link, SELLER_MODULE))) {
            throw new Error("seller link refused (test)")
          }
          return original(links)
        })
      }
      const remoteLink = container().resolve(ContainerRegistrationKeys.REMOTE_LINK)
      const link = container().resolve(ContainerRegistrationKeys.LINK)
      failSellerLinks(remoteLink)
      if (link !== remoteLink) failSellerLinks(link)

      for (const [route, body] of [
        ["/vendor/seller-products", await panelProductPayload(token, "Unlinked Honey")],
        ["/vendor/products", { ...(await panelProductPayload(token, "Unlinked Draft Honey")), status: "draft" }],
      ] as const) {
        const answered = await call(api.post(route, body, bearer(token)))
        expect({ route, ok: answered.status < 300 }).toEqual({ route, ok: false })
        const left = await pg().raw(`SELECT count(*)::int AS n FROM product WHERE title = ? AND deleted_at IS NULL`, [body.title])
        expect({ route, left: left.rows[0].n }).toEqual({ route, left: 0 })
      }
      jest.restoreAllMocks()
      // Nothing of the two attempts is the store's.
      const { data: storeProducts } = await query().graph({ entity: "seller_product", fields: ["product_id"], filters: { seller_id: sellerId } })
      expect(storeProducts).toEqual([])
      const { data: storeItems } = await query().graph({ entity: sellerInventoryItemLink.entryPoint, fields: ["inventory_item_id"], filters: { seller_id: sellerId } })
      expect(storeItems).toEqual([])
    })

    it("the admin panel's Accept answers an approval refusal 409, as /approve does, and leaves the application pending", async () => {
      stubMail()
      const applicant = await login("echo")
      const storeName = `Echo Farm ${uid()}`
      const requestId = await file(applicant, storeName, {
        playbook: "stall",
        recommended: "stall",
        roles: ["stall"],
        resources: ["goods"],
        node: false,
        vendor_type: "maker",
      })
      // Another store takes the name after she filed.
      const owner = await login("other")
      await createSellerWorkflow.run({
        container: container(),
        input: { auth_identity_id: owner.authIdentityId, member: { name: "Other", email: owner.email }, seller: { name: storeName } } as any,
      })

      const refused = await accept(requestId)
      expect(refused.status).toBe(409)
      expect(refused.data).toMatchObject({ type: "conflict" })
      expect(refused.data.message).toMatch(/which another store already uses, so this application cannot be approved/)
      const [request] = await container().resolve(REQUEST_MODULE).listRequests({ id: requestId })
      expect(request.status).toBe("pending")
      expect(await sellerOf(applicant.authIdentityId)).toBeUndefined()
    })
  },
})

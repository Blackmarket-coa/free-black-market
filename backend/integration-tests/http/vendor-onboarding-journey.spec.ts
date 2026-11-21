import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { createSellerWorkflow } from "@mercurjs/b2c-core/workflows"
import sellerInventoryItemLink from "@mercurjs/b2c-core/links/seller-inventory-item"
import sellerShippingProfileLink from "@mercurjs/b2c-core/links/seller-shipping-profile"
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
 * - "Sign me up to carry deliveries" was dropped at approval.
 * - A Service vendor could create no product: the panel's form names no
 *   listing type and the default was physical_product, which Service does
 *   not allow. An untyped product now takes the playbook's default.
 * - Products made through /vendor/seller-products had no shipping profile,
 *   and a body naming another store's seller_id there, or in POST
 *   /vendor/products, made the product in that store.
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
 * as a restart would. Spends 11 of the auth limiter's 20 a minute (filings
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

      // The opt-in reached the metadata, and provisioning issued a credential.
      expect((await metadataOf(sellerId)).node_operator_opt_in).toBe(true)
      const credentials = await container()
        .resolve(BLACKSTAR_FULFILLMENT_MODULE)
        .listBlackstarNodeOperatorCredentials({ seller_id: sellerId })
      expect(credentials).toEqual([expect.objectContaining({ status: "active", key_id: expect.stringMatching(/^bsk_/) })])
      // With Blackstar's emit settings unset (as here), nothing was queued:
      // the issued secret went to no one.
      expect(
        await container().resolve(MARKETPLACE_WEBHOOKS_MODULE).listWebhookDeliveries({ event: "node.operator.approved" })
      ).toEqual([])

      const token = await signIn(applicant)
      const settings = await call(api.get("/vendor/node-operator", bearer(token)))
      expect(settings.status).toBe(200)
      expect(settings.data.node_operator).toEqual({
        opted_in: true,
        credential: expect.objectContaining({ key_id: credentials[0].key_id }),
      })

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
      expect(
        await container().resolve(BLACKSTAR_FULFILLMENT_MODULE).listBlackstarNodeOperatorCredentials({ seller_id: sellerId })
      ).toEqual([])
      expect((await call(api.get("/vendor/node-operator", bearer(token)))).data.node_operator).toEqual({
        opted_in: false,
        credential: null,
      })
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
      expect(
        await container().resolve(BLACKSTAR_FULFILLMENT_MODULE).listBlackstarNodeOperatorCredentials({ seller_id: sellerId })
      ).toEqual([])
      const token = await signIn(applicant)
      const settings = await call(api.get("/vendor/node-operator", bearer(token)))
      expect(settings.data.node_operator).toEqual({ opted_in: false, credential: null })

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
        input: { products: [{ title: `Victor Jam ${uid()}`, options: [{ title: "Size", values: ["One"] }] }], additional_data: { seller_id: otherStore.id } },
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

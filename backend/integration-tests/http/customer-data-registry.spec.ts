import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { generateResetPasswordTokenWorkflow } from "@medusajs/medusa/core-flows"
import { createPublishableKeyToken } from "./_publishable-key"
import { safe } from "./helpers/seller-auth"
import {
  CUSTOMER_DATA_REGISTRY,
  QUERY_CANNOT_ADDRESS,
  customerColumnOf,
} from "../../src/lib/customer-data-registry"
import { readCustomerDataAcrossRegistry } from "../../src/lib/customer-erasure"

jest.setTimeout(240 * 1000)

/**
 * The customer-data registry (D11-1) against a migrated database and the real
 * `/store/customers/me` export and deletion endpoints.
 *
 * `collective_backing` names its customer `backer_id`, so until the P1-13
 * follow-up it was in neither the export nor the deletion, and the drift test
 * meant to catch exactly that looked only for `customer_id`. The unit specs
 * show the registry now names the column; only a real database shows that the
 * export finds the person's backing by it (by SQL: Query cannot address this
 * module's tables, which this spec also measures) and that the deletion
 * leaves the backing whole for the campaign's totals and refund.
 *
 * The schema cases check every entry, not only the new one. The drift test
 * used to credit a model with the `customer_id` of its neighbour in the same
 * file, which put two tables with no customer column in the registry, and a
 * unit spec reading source cannot see what the migrations actually built.
 *
 * They found more than that, recorded below as ratchets and NOT fixed here:
 * each is a separate decision, and the lists must shrink as each is made.
 *
 * The P1-13 review found two more things a deletion left behind, both shown
 * here through the real routes: the old password hashes the reuse check keeps
 * per auth identity (written by a real password change), and the public name
 * on the person's reviews (read back through the public review route).
 */

// `food_order`'s anonymiseFields name four columns the table does not have
// (the model calls them recipient_name / recipient_email / recipient_phone,
// and safe_place_description is on food_delivery). Postgres rejects the
// whole UPDATE, so a deletion clears none of the order's address fields —
// the case D11-1 was opened for. `recipient_name` is NOT NULL, so the fix is a
// decision, not a rename.
const KNOWN_MISSING_ANONYMISE_FIELDS = [
  "food_order.customer_name",
  "food_order.customer_email",
  "food_order.customer_phone",
  "food_order.safe_place_description",
]

// `anonymise` entries whose customer column is NOT NULL: the UPDATE that
// unlinks a person who has rows there fails, and the row keeps the link.
const KNOWN_NOT_NULL_ANONYMISE = [
  "garden_vote.customer_id",
  "garden_proposal_comment.customer_id",
  "quest_contribution.customer_id",
  "quest_reward_grant.customer_id",
  "buyer_impact.customer_id",
]

// Before the P1-13 review, twelve entries besides the backing could not be
// read through Query, so every person's export carried
// `{ _error: "could not be read: Method \"list<Entity>s\" does not exist on
// \"<module>\"" }` in place of their rows: Query derives the method from the
// table name (`garden_time_credit` -> `listGardenTimeCredits`), the module's
// MedusaService key generates another (`TimeCredit` -> `listTimeCredits`).
// All thirteen now read by SQL (QUERY_CANNOT_ADDRESS in the registry), so the
// list of entries the export cannot read is empty and must stay empty.
const KNOWN_UNREADABLE_IN_EXPORT: string[] = []

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const container = () => getContainer() as any
    const pg = () => container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

    async function signedInCustomer(pak: string) {
      const email = `registry-${uid()}@example.com`
      const password = `${uid()}-pw`
      const registered = await api.post("/auth/customer/emailpass/register", { email, password })
      const created = await api.post(
        "/store/customers",
        { email },
        { headers: { authorization: `Bearer ${registered.data.token}`, "x-publishable-api-key": pak } }
      )
      const login = await api.post("/auth/customer/emailpass", { email, password })
      // The identity the login signs in with, found the way the password
      // reuse check finds it (middlewares/password-history.ts).
      const { rows } = await pg().raw(
        `SELECT "auth_identity_id" FROM "provider_identity" WHERE "entity_id" = ? AND "provider" = 'emailpass'`,
        [email]
      )
      return {
        id: created.data.customer.id as string,
        email,
        authIdentityId: rows[0]?.auth_identity_id as string,
        headers: { headers: { authorization: `Bearer ${login.data.token}`, "x-publishable-api-key": pak } },
      }
    }

    // Inserted directly: on a database built from the migrations neither
    // `collective_campaign` nor `collective_backing` can take a row through
    // the ORM, because their bigNumber `raw_*` companions were never migrated
    // (module-schema-drift.spec.ts KNOWN_DRIFT). The backing route writes
    // `backer_id: auth_context.actor_id` (campaigns/[id]/backings/route.ts),
    // which is the signed-in customer's id used here.
    async function insertBacking(backerId: string, amount: number) {
      const id = `cbck_registry_${uid().replace(/-/g, "")}`
      await pg().raw(
        `INSERT INTO "collective_backing" ("id", "campaign_id", "backer_id", "mode", "amount", "status")
         VALUES (?, ?, ?, 'PRE_ORDER', ?, 'PLEDGED')`,
        [id, "ccmp_registry_test", backerId, amount]
      )
      return id
    }

    async function backingRow(id: string) {
      const { rows } = await pg().raw(
        `SELECT "backer_id", "amount"::text AS "amount", "status" FROM "collective_backing" WHERE "id" = ?`,
        [id]
      )
      return rows[0] as { backer_id: string; amount: string; status: string } | undefined
    }

    describe("a collective backing in the customer's export and deletion", () => {
      it("is exported to its backer only, and survives their deletion with its link and amount intact", async () => {
        const pak = await createPublishableKeyToken(getContainer)
        const backer = await signedInCustomer(pak)
        const other = await signedInCustomer(pak)
        const mine = await insertBacking(backer.id, 25)
        const theirs = await insertBacking(other.id, 40)

        // Export: the backer gets their own backing and not the other one.
        const exported = await safe(api.get("/store/customers/me/data-export", backer.headers))
        expect(exported.status).toBe(200)
        const backings = (exported.data.community?.collective_backing ?? []) as Array<Record<string, unknown>>
        // One row, whole: an unreadable table would show here as `_error`.
        expect(backings).toEqual([
          expect.objectContaining({ id: mine, backer_id: backer.id, campaign_id: "ccmp_registry_test" }),
        ])

        // Deletion: the backing stays exactly as it was. The campaign's totals
        // are summed from it, and a failed campaign's escrow refund is paid to
        // the wallet backer_id names.
        const deleted = await safe(api.post("/store/customers/me/deletion", {}, backer.headers))
        expect(deleted.status).toBe(200)
        // food_order is the KNOWN_MISSING_ANONYMISE_FIELDS failure above, on
        // every deletion. garden_role used to be here too.
        expect(deleted.data.entities_failed).toEqual(["food_order"])

        expect(await backingRow(mine)).toEqual({ backer_id: backer.id, amount: "25", status: "PLEDGED" })
        expect(await backingRow(theirs)).toEqual({ backer_id: other.id, amount: "40", status: "PLEDGED" })
      })
    })

    describe("a wellness client profile, one of the twelve Query could not read", () => {
      // Health-adjacent, so the registry deletes it. Before the P1-13 review
      // the export showed `_error` in its place for everyone; the deletion
      // already reached it by SQL.
      async function insertProfile(customerId: string) {
        const id = `wcp_registry_${uid().replace(/-/g, "")}`
        await pg().raw(
          `INSERT INTO "wellness_client_profile" ("id", "seller_id", "customer_id", "email", "pronouns")
           VALUES (?, 'sel_registry_test', ?, ?, 'they/them')`,
          [id, customerId, `${id}@example.com`]
        )
        return id
      }
      const profileExists = async (id: string) =>
        ((await pg().raw(`SELECT 1 FROM "wellness_client_profile" WHERE "id" = ?`, [id])).rows as unknown[]).length === 1

      it("is exported to its customer only, and deleted with their account", async () => {
        const pak = await createPublishableKeyToken(getContainer)
        const client = await signedInCustomer(pak)
        const other = await signedInCustomer(pak)
        const mine = await insertProfile(client.id)
        const theirs = await insertProfile(other.id)

        const exported = await safe(api.get("/store/customers/me/data-export", client.headers))
        expect(exported.status).toBe(200)
        expect(exported.data.community?.wellness_client_profile).toEqual([
          expect.objectContaining({ id: mine, customer_id: client.id, pronouns: "they/them" }),
        ])

        const deleted = await safe(api.post("/store/customers/me/deletion", {}, client.headers))
        expect(deleted.status).toBe(200)
        expect(await profileExists(mine)).toBe(false)
        expect(await profileExists(theirs)).toBe(true)
      })
    })

    describe("what a deletion leaves of the person's old passwords, public name and notes (P1-13 review)", () => {
      // A password change through the real route, so the reuse check writes
      // its history row the way it does in production: the old hash, keyed
      // by the auth identity, stamped with the path's actor type. The reset
      // token is the one POST /auth/customer/emailpass/reset-password would
      // email.
      async function changePassword(email: string, password: string) {
        const { http } = container().resolve(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig
        const { result: token } = await generateResetPasswordTokenWorkflow(container()).run({
          input: { entityId: email, actorType: "customer", provider: "emailpass", secret: http.jwtSecret, jwtOptions: http.jwtOptions },
        })
        const updated = await safe(
          api.post("/auth/customer/emailpass/update", { password }, { headers: { authorization: `Bearer ${token}` } })
        )
        expect(updated.status).toBe(200)
      }

      async function historyOf(authIdentityId: string) {
        const { rows } = await pg().raw(
          `SELECT "actor_type" FROM "password_history_entry" WHERE "auth_identity_id" = ?`,
          [authIdentityId]
        )
        return rows as Array<{ actor_type: string }>
      }

      // The reuse check stores the old hash after the response is sent, so
      // the row lands a moment later.
      async function historyAfterWrite(authIdentityId: string) {
        for (let i = 0; i < 50; i++) {
          const rows = await historyOf(authIdentityId)
          if (rows.length > 0) return rows
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        return historyOf(authIdentityId)
      }

      async function insertReview(customerId: string, productId: string, name: string) {
        const id = `rev_registry_${uid().replace(/-/g, "")}`
        await pg().raw(
          `INSERT INTO "embed_product_review" ("id", "product_id", "seller_id", "order_id", "customer_id", "rating", "body", "customer_display_name")
           VALUES (?, ?, 'sel_registry_test', ?, ?, 5, 'Crisp and fresh.', ?)`,
          [id, productId, `order_${id}`, customerId, name]
        )
        return id
      }
      async function reviewRow(id: string) {
        const { rows } = await pg().raw(
          `SELECT "customer_id", "customer_display_name", "body", "rating" FROM "embed_product_review" WHERE "id" = ?`,
          [id]
        )
        return rows[0] as Record<string, unknown> | undefined
      }

      async function insertStandingOrder(customerId: string, notes: string) {
        const id = `so_registry_${uid().replace(/-/g, "")}`
        await pg().raw(
          `INSERT INTO "standing_order" ("id", "seller_id", "customer_id", "name", "frequency", "start_date", "line_items", "order_value", "fulfillment_method", "customer_notes")
           VALUES (?, 'sel_registry_test', ?, 'Weekly box', 'WEEKLY', now(), '[]'::jsonb, 1200, 'PICKUP', ?)`,
          [id, customerId, notes]
        )
        return id
      }
      async function standingOrderRow(id: string) {
        const { rows } = await pg().raw(
          `SELECT "customer_id", "customer_notes", "order_value"::text AS "order_value" FROM "standing_order" WHERE "id" = ?`,
          [id]
        )
        return rows[0] as Record<string, unknown> | undefined
      }

      it("deletes the customer's password history and nobody else's, and keeps their review without their name", async () => {
        const pak = await createPublishableKeyToken(getContainer)
        const leaving = await signedInCustomer(pak)
        const staying = await signedInCustomer(pak)
        expect(leaving.authIdentityId).toMatch(/^authid_/)
        expect(staying.authIdentityId).toMatch(/^authid_/)

        await changePassword(leaving.email, `${uid()}-new`)
        await changePassword(staying.email, `${uid()}-new`)
        expect(await historyAfterWrite(leaving.authIdentityId)).toEqual([{ actor_type: "customer" }])
        expect(await historyAfterWrite(staying.authIdentityId)).toEqual([{ actor_type: "customer" }])

        const product = `prod_registry_${uid().replace(/-/g, "")}`
        const mine = await insertReview(leaving.id, product, "Jordan R.")
        const theirs = await insertReview(staying.id, product, "Sam K.")
        const myOrder = await insertStandingOrder(leaving.id, "Leave it with the neighbour at 14B")
        const theirOrder = await insertStandingOrder(staying.id, "Ring twice")

        const publicAuthors = async () => {
          const res = await safe(api.get(`/store/products/${product}/reviews`, { headers: { "x-publishable-api-key": pak } }))
          expect(res.status).toBe(200)
          return (res.data.reviews as Array<{ id: string; author: string; body: string }>)
            .map((r) => ({ id: r.id, author: r.author, body: r.body }))
            .sort((a, b) => a.id.localeCompare(b.id))
        }
        type PublicReview = { id: string; author: string; body: string }
        const sortedPair = (a: PublicReview, b: PublicReview) => [a, b].sort((x, y) => x.id.localeCompare(y.id))
        expect(await publicAuthors()).toEqual(
          sortedPair({ id: mine, author: "Jordan R.", body: "Crisp and fresh." }, { id: theirs, author: "Sam K.", body: "Crisp and fresh." })
        )

        const deleted = await safe(api.post("/store/customers/me/deletion", {}, leaving.headers))
        expect(deleted.status).toBe(200)
        expect(deleted.data.login_revoked).toBe(true)
        // food_order is the KNOWN_MISSING_ANONYMISE_FIELDS failure, on every
        // deletion. The password history and the standing order are not.
        expect(deleted.data.entities_failed).toEqual(["food_order"])

        // Old password hashes: the leaving customer's are gone with their
        // identity; the other customer's are untouched.
        expect(await historyOf(leaving.authIdentityId)).toEqual([])
        expect(await historyOf(staying.authIdentityId)).toEqual([{ actor_type: "customer" }])

        // The review survives for other shoppers, without the link or the name.
        expect(await reviewRow(mine)).toEqual({ customer_id: null, customer_display_name: null, body: "Crisp and fresh.", rating: 5 })
        expect(await reviewRow(theirs)).toEqual({ customer_id: staying.id, customer_display_name: "Sam K.", body: "Crisp and fresh.", rating: 5 })
        expect(await publicAuthors()).toEqual(
          sortedPair({ id: mine, author: "Verified buyer", body: "Crisp and fresh." }, { id: theirs, author: "Sam K.", body: "Crisp and fresh." })
        )

        // The standing order is kept under TAX with its link; the customer's
        // own note to the seller is not.
        expect(await standingOrderRow(myOrder)).toEqual({ customer_id: leaving.id, customer_notes: null, order_value: "1200" })
        expect(await standingOrderRow(theirOrder)).toEqual({ customer_id: staying.id, customer_notes: "Ring twice", order_value: "1200" })
      })
    })

    describe("every registry entry against the migrated schema", () => {
      async function columnsOf(table: string) {
        const { rows } = await pg().raw(
          `SELECT "column_name", "is_nullable" FROM information_schema.columns
            WHERE "table_schema" = current_schema() AND "table_name" = ?`,
          [table]
        )
        return new Map(
          (rows as Array<{ column_name: string; is_nullable: string }>).map((r) => [r.column_name, r.is_nullable])
        )
      }

      it("names a table that exists and the customer column it has", async () => {
        const problems: string[] = []
        for (const entry of CUSTOMER_DATA_REGISTRY) {
          const columns = await columnsOf(entry.entity)
          if (columns.size === 0) problems.push(`${entry.entity}: no such table`)
          else if (!columns.has(customerColumnOf(entry))) problems.push(`${entry.entity}.${customerColumnOf(entry)}`)
        }
        expect(problems).toEqual([])
      })

      it("reads every exported entity without an error", async () => {
        // An unreadable entity is reported in the export as `_error`, in place
        // of the person's rows. Every entry is read here, by Query or by SQL,
        // including Mercur's order_set (Query) and the thirteen SQL reads.
        const out = await readCustomerDataAcrossRegistry(container(), "cus_registry_nobody")
        const unreadable = Object.entries(out).filter(([, rows]) =>
          rows.some((r) => (r as { _error?: string })?._error)
        )
        expect(unreadable.map(([entity, rows]) => `${entity}: ${JSON.stringify(rows)}`)).toEqual(
          KNOWN_UNREADABLE_IN_EXPORT
        )
        // Nobody's data: every read succeeded and found nothing.
        expect(out).toEqual({})
        expect(Object.keys(QUERY_CANNOT_ADDRESS)).toContain("collective_backing")
      })

      it("names only fields its tables have (ratchet)", async () => {
        const missing: string[] = []
        for (const entry of CUSTOMER_DATA_REGISTRY) {
          const columns = await columnsOf(entry.entity)
          for (const field of entry.anonymiseFields ?? []) {
            if (!columns.has(field)) missing.push(`${entry.entity}.${field}`)
          }
        }
        expect(missing).toEqual(KNOWN_MISSING_ANONYMISE_FIELDS)
      })

      it("can clear every column it says it anonymises (ratchet)", async () => {
        // Checked on the schema, not by running the erasure: an UPDATE that
        // sets a NOT NULL column to NULL fails only on a row it matches.
        const notNullable: string[] = []
        for (const entry of CUSTOMER_DATA_REGISTRY) {
          const columns = await columnsOf(entry.entity)
          const cleared = [
            ...(entry.action === "anonymise" ? [customerColumnOf(entry)] : []),
            ...(entry.action === "delete" ? [] : entry.anonymiseFields ?? []),
          ]
          for (const column of cleared) {
            if (columns.get(column) === "NO") notNullable.push(`${entry.entity}.${column}`)
          }
        }
        expect(notNullable).toEqual(KNOWN_NOT_NULL_ANONYMISE)
      })
    })
  },
})

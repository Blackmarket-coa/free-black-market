import * as fs from "fs"
import * as path from "path"

import {
  CUSTOMER_DATA_REGISTRY,
  UNREGISTERED_CUSTOMER_REFERENCES,
  customerColumnOf,
  registryEntry,
} from "../customer-data-registry"

/**
 * The anti-drift guard for D11-1.
 *
 * The CCPA export and deletion endpoints each hand-listed the entities they
 * knew about, nothing told either of them when a module added another, and they
 * ended up covering two tables out of forty-seven — while the export told the
 * person it contained everything held about them.
 *
 * A longer hand-list would have drifted the same way. This test is the thing
 * that actually prevents it: add a `customer_id` to a model without deciding
 * what deletion does to it, and the build fails naming the table.
 *
 * ## Widened past `customer_id` (P1-13 follow-up, 2026-11-15)
 *
 * `collective_backing` names its customer `backer_id`. The walk looked only
 * for `customer_id`, so the table was in neither endpoint and nothing said so.
 * The walk now also reads every column named for a person — a backer, a
 * voter, an owner, `*_by_id` — and each one must be the registered customer
 * column of its table, a reviewed non-customer column (`NOT_A_CUSTOMER_ID`
 * below, with the evidence), or a known gap
 * (`UNREGISTERED_CUSTOMER_REFERENCES` in the registry, with a proposed
 * disposition). A new one fails the build naming the column.
 *
 * The rule is a vocabulary, so a customer id in a column named for nothing
 * human (`ref_id`, `party`) still escapes it. That limit is stated rather than
 * hidden; extend `PERSON_ROLES` when a new name turns up.
 *
 * It also reads each model's own columns now. The old walk took 9000
 * characters after each `model.define(` and credited the model with any
 * `customer_id` in them, which put `garden_role` and `hawala_investment_pool`
 * in the registry on the strength of the next model in their files.
 */

const MODULES_DIR = path.join(__dirname, "..", "..", "modules")

type ModelColumns = { entity: string; file: string; columns: Map<string, string> }

/**
 * The top-level columns of every `model.define("name", { ... })` in a source
 * file, each with the text of its definition. Brace-matched, skipping strings
 * and comments, so a column belongs to the model it is declared in.
 */
function parseModels(src: string, file: string): ModelColumns[] {
  const models: ModelColumns[] = []
  const defineRe = /model\s*\.\s*define\(\s*["'`]([a-z0-9_]+)["'`]\s*,\s*\{/g
  let m: RegExpExecArray | null
  while ((m = defineRe.exec(src)) !== null) {
    const columns = new Map<string, string>()
    let i = m.index + m[0].length
    let depth = 1
    let keyStart = i
    while (i < src.length && depth > 0) {
      const c = src[i]
      if (c === '"' || c === "'" || c === "`") {
        for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++
      } else if (c === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i++
      } else if (c === "/" && src[i + 1] === "*") {
        i = src.indexOf("*/", i + 2) + 1
      } else if ("{([".includes(c)) {
        depth++
      } else if ("})]".includes(c)) {
        depth--
      } else if (depth === 1 && c === ",") {
        keyStart = i + 1
      } else if (depth === 1 && c === ":") {
        const key = src
          .slice(keyStart, i)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/[^\n]*/g, "")
          .trim()
          .replace(/^["']|["']$/g, "")
        let end = i + 1
        for (let d = 0; end < src.length; end++) {
          const e = src[end]
          if ("{([".includes(e)) d++
          else if ("})]".includes(e)) {
            if (d === 0) break
            d--
          } else if (e === "," && d === 0) break
        }
        if (/^[a-z_][a-z0-9_]*$/.test(key)) columns.set(key, src.slice(i + 1, end).replace(/\s+/g, " ").trim())
      }
      i++
    }
    models.push({ entity: m[1], file, columns })
  }
  return models
}

/** Every model under `src/modules/**`. */
function walkModels(): ModelColumns[] {
  const found: ModelColumns[] = []
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        // Migrations mirror the models and would double-count; specs are not
        // schema.
        if (entry.name === "__tests__" || entry.name === "migrations") continue
        walk(full)
        continue
      }
      if (!entry.name.endsWith(".ts")) continue
      const src = fs.readFileSync(full, "utf8")
      if (src.includes("define(")) found.push(...parseModels(src, full))
    }
  }
  walk(MODULES_DIR)
  return found
}

/**
 * Words that name a person. A text or JSON column ending `_id` / `_ids` whose
 * last word is one of these, or which mentions `customer` anywhere, or which
 * ends `_by_id` / `_to_id` / `_from_id` / `_by`, is read as a reference to
 * someone. A column naming `seller` or `vendor` says which kind of person it
 * holds, and the registry is about customers, so those are not read.
 */
const PERSON_ROLES = new Set(
  (
    "customer backer buyer shopper member voter supporter requester submitter reviewer proposer " +
    "organizer author actor user subject receiver recipient attester attestor participant offerer " +
    "helper creator contributor delegator delegate beneficiary assignee owner holder investor donor " +
    "sender payer payee claimant attendee volunteer client guest patron referrer referred invitee " +
    "inviter follower sponsor signer borrower lender tenant renter admin person profile verifier"
  ).split(" ")
)

function namesAPerson(column: string, definition: string): boolean {
  if (!/^model\s*\.\s*(text|json)\b/.test(definition)) return false
  if (/_by$/.test(column)) return true
  if (!/_ids?$/.test(column)) return false
  const words = column.replace(/_ids?$/, "").split("_")
  if (words.includes("seller") || words.includes("vendor")) return false
  if (words.includes("customer")) return true
  if (/_(by|to|from)_ids?$/.test(column)) return true
  return PERSON_ROLES.has(words[words.length - 1])
}

/**
 * Person-named columns that do not hold a Medusa customer id, each checked
 * against the code that writes it (2026-11-15). A column here is outside the
 * registry's scope, not overlooked.
 */
const NOT_A_CUSTOMER_ID: Record<string, string> = {
  "collective_campaign_contribution.participant_id": "a collective_campaign_participant row id (collective-campaign/service.ts writes participant.id); participants are organisations or sellers",
  "cottage_food_sales_entry.profile_id": "a cottage-food profile row id (cottage-food/service.ts)",
  "ops_funding_bucket.profile_id": "a hype_profile row id (vendor-hype service)",
  "prediction_market.profile_id": "a hype_profile row id (vendor-hype service)",
  "hawala_escrow_agreement.subject_id": "the escrowed thing, read with subject_type (escrow-agreement model)",
  "food_delivery.rescheduled_from_id": "the food_delivery this one replaces",
  "donation_disbursement.beneficiary_id": "a donation_beneficiary row id (donation/service.ts)",
  "tenancy_membership.user_id": "staff of a storefront organisation; only admin/tenancy/storefronts/from-template creates memberships",
  "order_cycle_exchange.receiver_id": "the coordinating seller (integrations/blackout/coalitions/[coalitionId]/order-cycles)",
  "service_review.reviewer_id": "a seller (vendor/service-contracts/[id]/reviews writes reviewer_seller_id)",
  "seller_metadata.blackout_user_id": "a seller's linked Blackout account (integrations/blackout/link)",
  "vendor_plan_assignment.stripe_customer_id": "the seller's Stripe customer (vendor/billing/setup-intent)",
  "hawala_bank_account.stripe_customer_id": "Stripe's id, not ours; the row is found by owner_id, which is listed as a gap",
  "blackout_manage_session.blackout_user_id": "on a row the registry deletes whole by customer_id, so it goes with the row",
  "intake_receipt.received_by": "free text a vendor types at aid-network intake (vendor/aid-network/intake), not an id",
  "request.reviewer_id": "the admin who reviewed it (admin/requests/[id])",
  "proof_artifact.verifier_id": "an admin (v1/admin/marketplace/proofs/[id]/verify, /reject)",
  "order_dispute.resolved_by": "an admin (order-dispute/service.ts adminId)",
  "wholesale_application.reviewed_by": "an admin (admin/wholesale-application/[id]/approve)",
  "vendor_badge.granted_by": "an admin (admin/vendor-verification/[id]/badges)",
  "verification_check.verified_by": "an admin (admin/vendor-verification/checks/[checkId], admin/vault/[id])",
  "creator_application.decided_by": "the program's seller (v1/seller/programs/[id]/applications/[appId]/decide)",
  "service_application.decided_by": "the program's seller (v1/seller/services/programs/[id]/applications/[appId]/decide)",
  "kb_contribution.decided_by": "an admin (admin/knowledge-base/contributions/[id]/decide)",
  "hawala_vendor_advance.approved_by": "an admin (admin/hawala/advances/orgs/[id]/approve)",
  "hawala_payout_hold.released_by": "an admin actor or \"system\" (lib/card-refund-attribution.ts, lib/card-order-reconcile.ts)",
}

describe("customer data registry", () => {
  const models = walkModels()
  const byEntity = new Map(models.map((m) => [m.entity, m]))
  const rel = (file: string) => path.relative(MODULES_DIR, file)
  const customerLinked = models.filter((m) => m.columns.has("customer_id"))

  /** Every person-named column other than `customer_id`, as `entity.column`. */
  const personColumns = models.flatMap((m) =>
    [...m.columns.entries()]
      .filter(([column, definition]) => column !== "customer_id" && namesAPerson(column, definition))
      .map(([column]) => ({ ref: `${m.entity}.${column}`, file: m.file }))
  )

  it("finds the customer-linked models at all", () => {
    // Guards the guard: a regex that silently matches nothing would make every
    // assertion below vacuously true.
    expect(models.length).toBeGreaterThan(250)
    expect(customerLinked.length).toBeGreaterThan(30)
    expect(personColumns.length).toBeGreaterThan(50)
  })

  it("reads each model's own columns, not its neighbour's", () => {
    // The old walk's failure, as a fixture: two models in one file, the
    // customer column on the second.
    const src = `
      export const Role = model.define("fixture_role", {
        id: model.id().primaryKey(),
        // customer_id: not here
        garden_id: model.text(),
        permissions: model.json().nullable(), /* { customer_id: ... } */
      })
      export const Assignment = model.define("fixture_assignment", {
        id: model.id().primaryKey(),
        customer_id: model.text(),
        meta: model.json().default({ a: { b: "c, d: e" } }),
        buyer_id: model.text().nullable(),
      })
    `
    const [role, assignment] = parseModels(src, "fixture.ts")
    expect(role.entity).toBe("fixture_role")
    expect([...role.columns.keys()]).toEqual(["id", "garden_id", "permissions"])
    expect([...assignment.columns.keys()]).toEqual(["id", "customer_id", "meta", "buyer_id"])
    expect(namesAPerson("buyer_id", assignment.columns.get("buyer_id")!)).toBe(true)
  })

  it("reads the columns that name a customer under another name", () => {
    // The case that started the widening, and the name rule's edges.
    expect(personColumns.map((p) => p.ref)).toContain("collective_backing.backer_id")
    expect(namesAPerson("voter_id", "model.text()")).toBe(true)
    expect(namesAPerson("attester_customer_id", "model.text()")).toBe(true)
    expect(namesAPerson("customer_ids", "model.json().nullable()")).toBe(true)
    expect(namesAPerson("approved_by_id", "model.text().nullable()")).toBe(true)
    expect(namesAPerson("accepted_by", "model.text().nullable()")).toBe(true)
    expect(namesAPerson("best_by", "model.dateTime().nullable()")).toBe(false)
    expect(namesAPerson("creator_seller_id", "model.text()")).toBe(false)
    expect(namesAPerson("member_deposit_pool_id", "model.text()")).toBe(false)
    expect(namesAPerson("garden_id", "model.text()")).toBe(false)
  })

  it("has an entry for every model that holds a customer_id", () => {
    const missing = customerLinked
      .filter((m) => !registryEntry(m.entity))
      .map((m) => `${m.entity}  (${rel(m.file)})`)

    expect(missing).toEqual([])
  })

  it("accounts for every column that names a customer under another name", () => {
    // Registered as its table's customer column, reviewed as not a customer
    // id, or listed as a known gap with a proposed disposition. Anything else
    // is a table that holds someone's data with no decision about it.
    const registered = new Set(
      CUSTOMER_DATA_REGISTRY.filter((e) => !e.framework).map((e) => `${e.entity}.${customerColumnOf(e)}`)
    )
    const unaccounted = personColumns
      .filter(
        (p) =>
          !registered.has(p.ref) &&
          !(p.ref in NOT_A_CUSTOMER_ID) &&
          !(p.ref in UNREGISTERED_CUSTOMER_REFERENCES)
      )
      .map((p) => `${p.ref}  (${rel(p.file)})`)

    expect(unaccounted).toEqual([])
  })

  it("keeps its reviewed lists current, so the gap list can only shrink", () => {
    const live = new Set(personColumns.map((p) => p.ref))
    const registered = new Set(
      CUSTOMER_DATA_REGISTRY.map((e) => `${e.entity}.${customerColumnOf(e)}`)
    )
    // A listed column that no longer exists, or is no longer person-named.
    const staleGaps = Object.keys(UNREGISTERED_CUSTOMER_REFERENCES).filter((ref) => !live.has(ref))
    const staleReviewed = Object.keys(NOT_A_CUSTOMER_ID).filter((ref) => !live.has(ref))
    // A gap that has been registered: take it off the list.
    const closedGaps = Object.keys(UNREGISTERED_CUSTOMER_REFERENCES).filter((ref) => registered.has(ref))
    const both = Object.keys(NOT_A_CUSTOMER_ID).filter((ref) => ref in UNREGISTERED_CUSTOMER_REFERENCES)

    expect({ staleGaps, staleReviewed, closedGaps, both }).toEqual({
      staleGaps: [],
      staleReviewed: [],
      closedGaps: [],
      both: [],
    })
  })

  it("has no entry for a model, or a customer column, that no longer exists", () => {
    // The other direction: a stale entry means deletion tries to clear a table
    // that is gone, or filters on a column it does not have, and the registry
    // stops describing the system. Framework tables are not in src/modules.
    const stale = CUSTOMER_DATA_REGISTRY.filter((e) => !e.framework)
      .filter((e) => !byEntity.get(e.entity)?.columns.has(customerColumnOf(e)))
      .map((e) => `${e.entity}.${customerColumnOf(e)}`)

    expect(stale).toEqual([])
  })

  it("names the customer column wherever it is not customer_id, and only there", () => {
    for (const e of CUSTOMER_DATA_REGISTRY) {
      // A framework table links however its owner chose, so it always says.
      if (e.framework) expect(e.customerColumn).toMatch(/^[a-z_]+$/)
      // Saying `customer_id` explicitly would be noise; saying anything else
      // is checked against the model above.
      expect(e.customerColumn).not.toBe("customer_id")
    }
  })

  it("covers Medusa's notification log, through receiver_id", () => {
    // The order confirmation stores the buyer's address and first name and
    // what they bought in it, one row per order.
    expect(registryEntry("notification")).toMatchObject({
      action: "delete",
      customerColumn: "receiver_id",
      framework: true,
    })
  })

  it("covers collective backings, through backer_id, and keeps them for the campaign's totals and refunds", () => {
    // P1-13: a backing names its customer backer_id. It is an escrowed
    // payment whose campaign totals and failure refund depend on the row and
    // its link, so it is retained, not deleted or unlinked.
    const backing = registryEntry("collective_backing")
    // Read by SQL: Query cannot address this module's tables (see the entry).
    expect(backing).toMatchObject({ action: "retain", customerColumn: "backer_id", exportVia: "sql" })
    expect(backing?.framework).toBeUndefined()
    expect(backing?.basis).toMatch(/refund/)
    expect(backing?.inExport).not.toBe(false)
  })

  it("states a basis for everything it keeps", () => {
    // A retention with no stated basis is an omission, not a decision.
    const unjustified = CUSTOMER_DATA_REGISTRY.filter(
      (e) => e.action !== "delete" && !e.basis
    ).map((e) => e.entity)

    expect(unjustified).toEqual([])
  })

  it("names fields to clear wherever it says anonymise", () => {
    const empty = CUSTOMER_DATA_REGISTRY.filter(
      (e) => e.action === "retain" && e.anonymiseFields && e.anonymiseFields.length === 0
    ).map((e) => e.entity)

    expect(empty).toEqual([])
  })

  it("lists each entity once", () => {
    const counts = new Map<string, number>()
    for (const e of CUSTOMER_DATA_REGISTRY) {
      counts.set(e.entity, (counts.get(e.entity) ?? 0) + 1)
    }
    expect([...counts.entries()].filter(([, n]) => n > 1)).toEqual([])
  })

  it("keeps the food order's address out of a retained row", () => {
    // The concrete case that started this: a delivery kept the recipient's
    // name, phone and street address after they deleted their account.
    // NOTE (2026-11-15): customer_name and customer_phone are not columns of
    // food_order (it has recipient_*), so on Postgres this UPDATE fails whole
    // and clears nothing. Pinned, not fixed, by KNOWN_MISSING_ANONYMISE_FIELDS
    // in integration-tests/http/customer-data-registry.spec.ts.
    const order = registryEntry("food_order")
    expect(order?.action).toBe("retain")
    expect(order?.anonymiseFields).toEqual(
      expect.arrayContaining([
        "customer_name",
        "customer_phone",
        "delivery_address_line_1",
        "delivery_latitude",
      ])
    )
  })

  it("deletes wellness records rather than keeping them anonymised", () => {
    // An "anonymised" health record is still a health record about one person.
    for (const entity of [
      "wellness_member",
      "wellness_client_profile",
      "wellness_class_attendee",
    ]) {
      expect(registryEntry(entity)?.action).toBe("delete")
    }
  })
})

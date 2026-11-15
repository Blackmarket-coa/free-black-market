import * as fs from "fs"
import * as path from "path"

import {
  CUSTOMER_DATA_REGISTRY,
  QUERY_CANNOT_ADDRESS,
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
 * ## Widened again by the P1-13 review
 *
 * The first widening only read names ending `_id`, `_ids` or `_by`, so a
 * `customer_ref` or a `buyer_account` on an unregistered table passed the
 * build. Now any column that mentions `customer` is read whatever it ends in,
 * and person-named columns ending `_ref`, `_reference`, `_key`, `_account`,
 * `_handle`, `_uid` or `_external_id` are read too. A customer-named column
 * that only describes its row (`customer_email`, `customer_notes`) is
 * accounted for when its row is deleted or the column is cleared; on a row the
 * registry keeps, it must be listed.
 *
 * And a row with no customer column at all can still be about a customer: a
 * food order's delivery holds the recipient's name, phone and address and is
 * tied to them only through `food_delivery.order_id`. The walk now also finds
 * every model that hangs off a registered table in the same module, by a
 * `belongsTo` or a `<table>_id` column, and each must be registered, listed
 * with `via`, or reviewed (`REVIEWED_CHILD_ROWS`).
 *
 * It also reads each model's own columns now. The old walk took 9000
 * characters after each `model.define(` and credited the model with any
 * `customer_id` in them, which put `garden_role` and `hawala_investment_pool`
 * in the registry on the strength of the next model in their files.
 */

const MODULES_DIR = path.join(__dirname, "..", "..", "modules")

type ModelColumns = {
  entity: string
  file: string
  /** The variable the model is assigned to, which a `belongsTo` names. */
  varName?: string
  columns: Map<string, string>
}

/**
 * The top-level columns of every `model.define("name", { ... })` in a source
 * file, each with the text of its definition. Brace-matched, skipping strings
 * and comments, so a column belongs to the model it is declared in.
 */
function parseModels(src: string, file: string): ModelColumns[] {
  const models: ModelColumns[] = []
  const defineRe = /(?:\b([A-Za-z_$][\w$]*)\s*=\s*)?model\s*\.\s*define\(\s*["'`]([a-z0-9_]+)["'`]\s*,\s*\{/g
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
        // camelCase keys too (digital-product's `fileId`): a skipped key is a
        // column the walk would never judge.
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) columns.set(key, src.slice(i + 1, end).replace(/\s+/g, " ").trim())
      }
      i++
    }
    models.push({ entity: m[2], file, varName: m[1], columns })
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
 * Words that name a person. A text or JSON column is read as being about
 * someone when it mentions `customer` anywhere, whatever it ends in; or ends
 * `_by`, `_by_id`, `_to_id` or `_from_id`; or ends in a reference suffix
 * (`REFERENCE_SUFFIX`) after one of these words. A column naming `seller` or
 * `vendor` (and not `customer`) says which kind of person it holds, and the
 * registry is about customers, so those are not read.
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

/** What a column holding someone's identifier ends in. */
const REFERENCE_SUFFIX = /_(external_ids?|ids?|uid|ref|reference|key|account|handle)$/

const snakeCase = (column: string) => column.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()

function namesAPerson(column: string, definition: string): boolean {
  if (!/^model\s*\.\s*(text|json)\b/.test(definition)) return false
  const name = snakeCase(column)
  // Before any suffix rule: `customer_ref`, `customer_key`, `customers`,
  // `seller_customer_id` all name the person this registry is about.
  if (name.includes("customer")) return true
  if (/_by$/.test(name)) return true
  if (!REFERENCE_SUFFIX.test(name)) return false
  const words = name.replace(REFERENCE_SUFFIX, "").split("_")
  if (words.includes("seller") || words.includes("vendor")) return false
  if (/_(by|to|from)_ids?$/.test(name)) return true
  return PERSON_ROLES.has(words[words.length - 1])
}

/**
 * Whether a person-named column holds an identifier, rather than something
 * said about its row's person (`customer_email`, `customer_notes`). An
 * identifier may name someone other than the row's customer, so it always
 * needs a decision; a description goes wherever its row goes.
 */
function isReference(column: string): boolean {
  const name = snakeCase(column)
  return REFERENCE_SUFFIX.test(name) || /_by$/.test(name)
}

/**
 * Models in the same module that hang off `parents`: a `belongsTo` to the
 * parent's model, or a text `<stem>_id` column where the parent's table is
 * `<stem>` or ends `_<stem>` (`food_delivery.order_id` -> `food_order`).
 * Each link is `child.column` with the column as the database names it
 * (`belongsTo` key + `_id`).
 */
function childLinks(models: ModelColumns[], parents: Set<string>) {
  const moduleOf = (m: ModelColumns) => path.relative(MODULES_DIR, m.file).split(path.sep)[0]
  const links: Array<{ ref: string; child: string; parent: string; file: string }> = []
  for (const child of models) {
    const siblings = models.filter((m) => m !== child && moduleOf(m) === moduleOf(child))
    for (const [column, definition] of child.columns) {
      const target = definition.match(/^model\s*\.\s*belongsTo\(\s*\(\)\s*=>\s*([A-Za-z_$][\w$]*)/)?.[1]
      const viaBelongsTo = target ? siblings.find((m) => m.varName === target) : undefined
      if (viaBelongsTo && parents.has(viaBelongsTo.entity)) {
        links.push({ ref: `${child.entity}.${column}_id`, child: child.entity, parent: viaBelongsTo.entity, file: child.file })
        continue
      }
      if (!/_id$/.test(column) || !/^model\s*\.\s*text\b/.test(definition)) continue
      const stem = column.replace(/_id$/, "")
      const viaColumn = siblings.find((m) => parents.has(m.entity) && (m.entity === stem || m.entity.endsWith(`_${stem}`)))
      if (viaColumn) links.push({ ref: `${child.entity}.${column}`, child: child.entity, parent: viaColumn.entity, file: child.file })
    }
  }
  return links
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
  // Read by the review's wider suffix rule (`_key`, `_handle`).
  "opportunity_score.subject_key": "a category slug or a product id, by subject_type (opportunity-engine/models/opportunity-score.ts)",
  "seller_metadata.creator_handle": "a CREATOR seller's own public handle (seller-extension/models/seller-metadata.ts; read by v1/marketplace/creators/[handle])",
}

/**
 * Rows that hang off a registered table and hold nothing about its customer,
 * each checked against the code that writes it (2026-11-15). The child-row
 * walk accepts these; anything else it finds must be registered or listed
 * with `via`.
 */
const REVIEWED_CHILD_ROWS: Record<string, string> = {
  "ar_invoice_payment.invoice_id": "the seller's record of a payment received against the invoice: seller_id, method, reference, note (accounts-receivable/service.ts); kept with the retained invoice",
  "food_order_item.order_id": "the order's line items: product, quantity, price, and the product's own allergens and dietary flags (store/food-producers/[id]/orders); the buyer's per-item special_instructions are not a column, so nothing here names, contacts or locates them; kept with the retained order",
  "quote_line.quote_id": "the seller's priced lines and line notes (vendor/quotes, quote/service.ts replaceLines); kept with the retained quote",
  "shopper_wishlist_item.wishlist_id": "product ids only, and deleted with the wishlist by the foreign key's ON DELETE CASCADE (wishlist/migrations/Migration20260123CreateWishlist.ts)",
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

  const gaps = Object.entries(UNREGISTERED_CUSTOMER_REFERENCES)
  const tableOf = (ref: string) => ref.split(".")[0]
  const columnOf = (ref: string) => ref.split(".")[1]

  /**
   * The tables a child row can hang off: ours in the registry, and those
   * listed with `via` (a food order's delivery has events of its own).
   */
  const parents = new Set([
    ...CUSTOMER_DATA_REGISTRY.filter((e) => !e.framework).map((e) => e.entity),
    ...gaps.filter(([, g]) => g.via).map(([ref]) => tableOf(ref)),
  ])
  const children = childLinks(models, parents)

  /**
   * How a person-named column is already decided by the registry itself:
   * it is its table's customer column, its entry clears it, or it describes
   * a row the entry deletes. Undefined when the registry does not decide it.
   */
  function decided(ref: string): string | undefined {
    const entry = registryEntry(tableOf(ref))
    const column = columnOf(ref)
    if (!entry) return undefined
    if (!entry.framework && customerColumnOf(entry) === column) return "registered"
    if (entry.action !== "delete" && entry.anonymiseFields?.includes(column)) return "cleared"
    if (entry.action === "delete" && !isReference(column)) return "deleted with its row"
    return undefined
  }

  /** A listed gap proposes clearing this column (food_delivery.customer_feedback). */
  const proposedClear = (ref: string) =>
    gaps.some(([key, g]) => tableOf(key) === tableOf(ref) && g.clear?.includes(columnOf(ref)))

  it("finds the customer-linked models at all", () => {
    // Guards the guard: a regex that silently matches nothing would make every
    // assertion below vacuously true.
    expect(models.length).toBeGreaterThan(250)
    expect(customerLinked.length).toBeGreaterThan(30)
    expect(personColumns.length).toBeGreaterThan(50)
    expect(children.length).toBeGreaterThan(5)
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
        customerRef: model.text().nullable(),
      })
    `
    const [role, assignment] = parseModels(src, "fixture.ts")
    expect(role.entity).toBe("fixture_role")
    expect(role.varName).toBe("Role")
    expect([...role.columns.keys()]).toEqual(["id", "garden_id", "permissions"])
    expect([...assignment.columns.keys()]).toEqual(["id", "customer_id", "meta", "buyer_id", "customerRef"])
    expect(namesAPerson("buyer_id", assignment.columns.get("buyer_id")!)).toBe(true)
    expect(namesAPerson("customerRef", assignment.columns.get("customerRef")!)).toBe(true)
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
    // The P1-13 review: `customer` anywhere, whatever the suffix, and person
    // words before a reference suffix other than `_id`.
    expect(namesAPerson("customer_ref", "model.text()")).toBe(true)
    expect(namesAPerson("customer_key", "model.text()")).toBe(true)
    expect(namesAPerson("seller_customer_id", "model.text()")).toBe(true)
    expect(namesAPerson("customer_email", "model.text()")).toBe(true)
    expect(namesAPerson("buyer_account", "model.text().nullable()")).toBe(true)
    expect(namesAPerson("member_external_id", "model.text()")).toBe(true)
    expect(namesAPerson("owner_handle", "model.text()")).toBe(true)
    expect(namesAPerson("idempotency_key", "model.text()")).toBe(false)
    expect(namesAPerson("partner_org_key", "model.text()")).toBe(false)
    expect(namesAPerson("customer_paid", "model.bigNumber()")).toBe(false)
    // An identifier always needs a decision; a description goes with its row.
    expect(isReference("customer_ref")).toBe(true)
    expect(isReference("customer_email")).toBe(false)
  })

  it("finds the rows that hang off a parent, by belongsTo or by <table>_id, in the parent's module only", () => {
    const file = (mod: string) => path.join(MODULES_DIR, mod, "models", "fixture.ts")
    const fixture = [
      ...parseModels(
        `export const Order = model.define("fx_order", { id: model.id(), customer_id: model.text() })
         export const Delivery = model.define("fx_delivery", { id: model.id(), order_id: model.text(), recipient_name: model.text() })
         export const Item = model.define("fx_order_item", { id: model.id(), order: model.belongsTo(() => Order, { mappedBy: "items" }) })
         export const Event = model.define("fx_delivery_event", { id: model.id(), delivery: model.belongsTo(() => Delivery) })
         export const Zone = model.define("fx_zone", { id: model.id(), region_id: model.text() })`,
        file("fx-mod")
      ),
      ...parseModels(`export const Other = model.define("fx_other", { id: model.id(), order_id: model.text() })`, file("fx-elsewhere")),
    ]
    const links = childLinks(fixture, new Set(["fx_order", "fx_delivery"]))
    expect(links.map((l) => `${l.ref} -> ${l.parent}`).sort()).toEqual([
      "fx_delivery.order_id -> fx_order",
      "fx_delivery_event.delivery_id -> fx_delivery",
      "fx_order_item.order_id -> fx_order",
    ])
  })

  it("has an entry for every model that holds a customer_id", () => {
    const missing = customerLinked
      .filter((m) => !registryEntry(m.entity))
      .map((m) => `${m.entity}  (${rel(m.file)})`)

    expect(missing).toEqual([])
  })

  it("accounts for every column that names a customer under another name", () => {
    // Registered as its table's customer column, cleared by its entry, a
    // description on a row its entry deletes, reviewed as not a customer id,
    // or listed as a known gap with a proposed disposition. Anything else is
    // a table that holds someone's data with no decision about it.
    const unaccounted = personColumns
      .filter(
        (p) =>
          !decided(p.ref) &&
          !(p.ref in NOT_A_CUSTOMER_ID) &&
          !(p.ref in UNREGISTERED_CUSTOMER_REFERENCES) &&
          !proposedClear(p.ref)
      )
      .map((p) => `${p.ref}  (${rel(p.file)})`)

    expect(unaccounted).toEqual([])
  })

  it("accounts for every row that hangs off a registered table", () => {
    // The food_delivery case: no customer column, so the column walk cannot
    // see it, but it is reached through its order's customer_id and holds the
    // recipient's name, phone and address. Each such row is registered,
    // listed with `via` its parent, or reviewed as holding nothing about them.
    const unaccounted = children
      .filter(
        (c) =>
          !registryEntry(c.child) &&
          UNREGISTERED_CUSTOMER_REFERENCES[c.ref]?.via !== c.parent &&
          !(c.ref in REVIEWED_CHILD_ROWS)
      )
      .map((c) => `${c.ref} -> ${c.parent}  (${rel(c.file)})`)

    expect(unaccounted).toEqual([])
  })

  it("lists a food order's delivery, and its events, with the recipient's details to clear", () => {
    // D11-1's headline case lives on the delivery as much as on the order.
    expect(children.map((c) => `${c.ref} -> ${c.parent}`)).toEqual(
      expect.arrayContaining(["food_delivery.order_id -> food_order", "food_delivery_event.delivery_id -> food_delivery"])
    )
    const delivery = UNREGISTERED_CUSTOMER_REFERENCES["food_delivery.order_id"]
    expect(delivery).toMatchObject({ via: "food_order", proposed: "retain" })
    expect(delivery.clear).toEqual(
      expect.arrayContaining(["recipient_name", "recipient_phone", "delivery_address", "safe_place_description", "customer_feedback"])
    )
    expect(UNREGISTERED_CUSTOMER_REFERENCES["food_delivery_event.delivery_id"]).toMatchObject({
      via: "food_delivery",
      clear: ["latitude", "longitude"],
    })
  })

  it("keeps its reviewed lists current, so the gap list can only shrink", () => {
    const live = new Set([...personColumns.map((p) => p.ref), ...children.map((c) => c.ref)])
    const childRefs = new Set(children.map((c) => c.ref))
    // A listed column that no longer exists, or is no longer person-named.
    const staleGaps = gaps.map(([ref]) => ref).filter((ref) => !live.has(ref))
    const staleReviewed = Object.keys(NOT_A_CUSTOMER_ID).filter((ref) => !live.has(ref))
    const staleChildren = Object.keys(REVIEWED_CHILD_ROWS).filter((ref) => !childRefs.has(ref))
    // A gap the registry now decides (registered, cleared, deleted with its
    // row): take it off the list.
    const closedGaps = gaps.map(([ref]) => ref).filter((ref) => decided(ref))
    const both = [...Object.keys(NOT_A_CUSTOMER_ID), ...Object.keys(REVIEWED_CHILD_ROWS)].filter(
      (ref) => ref in UNREGISTERED_CUSTOMER_REFERENCES
    )
    // A `via` that is not the link the walk found, a column to clear that the
    // model does not have, or a `clear` proposal on a row nobody keeps.
    const badVia = gaps
      .filter(([ref, g]) => g.via && !children.some((c) => c.ref === ref && c.parent === g.via))
      .map(([ref]) => ref)
    const badClear = gaps.flatMap(([ref, g]) =>
      (g.clear ?? []).filter((column) => !byEntity.get(tableOf(ref))?.columns.has(column)).map((c) => `${tableOf(ref)}.${c}`)
    )
    const clearOffRegistry = gaps
      .filter(([ref, g]) => g.proposed === "clear" && (registryEntry(tableOf(ref))?.action ?? "delete") === "delete")
      .map(([ref]) => ref)

    expect({ staleGaps, staleReviewed, staleChildren, closedGaps, both, badVia, badClear, clearOffRegistry }).toEqual({
      staleGaps: [],
      staleReviewed: [],
      staleChildren: [],
      closedGaps: [],
      both: [],
      badVia: [],
      badClear: [],
      clearOffRegistry: [],
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

  it("names the customer column wherever it is not customer_id, and on every framework table", () => {
    for (const e of CUSTOMER_DATA_REGISTRY) {
      // A framework table links however its owner chose and its model is not
      // walked, so it always says, even `customer_id` (Mercur's order_set).
      if (e.framework) expect(e.customerColumn).toMatch(/^[a-z_]+$/)
      // On ours, saying `customer_id` explicitly would be noise; saying
      // anything else is checked against the model above.
      else expect(e.customerColumn).not.toBe("customer_id")
    }
  })

  it("reads by SQL exactly the tables Query cannot address, and says why for each", () => {
    // Each was an `_error` in every export on Postgres (the integration spec
    // reads every entry). A reason without an entry, or the reverse, is drift.
    const viaSql = CUSTOMER_DATA_REGISTRY.filter((e) => e.exportVia === "sql").map((e) => e.entity)
    expect(viaSql.sort()).toEqual(Object.keys(QUERY_CANNOT_ADDRESS).sort())
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
    // Read by SQL: Query cannot address this table (QUERY_CANNOT_ADDRESS).
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

  it("pins the food order's configured anonymiseFields (not what the erasure achieves)", () => {
    // The concrete case that started this: a delivery kept the recipient's
    // name, phone and street address after they deleted their account.
    // NOTE (2026-11-15): this pins the configured list only. Four of its
    // fields are not columns of food_order: customer_name, customer_email
    // and customer_phone (it has recipient_*), and safe_place_description
    // (on food_delivery). On Postgres the UPDATE fails whole and clears
    // nothing, and the deletion reports food_order in entities_failed. Pinned,
    // not fixed, by KNOWN_MISSING_ANONYMISE_FIELDS in
    // integration-tests/http/customer-data-registry.spec.ts.
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

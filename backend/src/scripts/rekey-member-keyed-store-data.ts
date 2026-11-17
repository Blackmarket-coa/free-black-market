import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { APPLY_OR_DRY_RUN, parseScriptArgs } from "../shared/exec-args"

/**
 * Move store records written under a member id onto that member's store
 * (SD-145).
 *
 *     npx medusa exec ./src/scripts/rekey-member-keyed-store-data.ts
 *     npx medusa exec ./src/scripts/rekey-member-keyed-store-data.ts apply
 *
 * The first is a dry run: it reads, writes nothing, and reports per table and
 * column how many rows hold a member id (`mem_`), how many it would rekey, a
 * sample, and the rows it leaves alone. Writing needs the bare word `apply`
 * (`medusa exec` refuses `--apply` before the script loads; see
 * shared/exec-args.ts). Any other word is refused before anything is read.
 *
 * Behind the vendor gate `auth_context.actor_id` is a member id for every
 * vendor, and some ninety vendor routes used it as the store id until SD-145.
 * They wrote the member id into the store column of every row below, so a
 * store's records belonged to whichever member made them. Those routes now
 * write the store id; this moves what they wrote before.
 *
 * Each row holding a `mem_` id in a listed column is mapped to that member's
 * `seller_id`, soft-deleted (removed) members included, whatever the row's own
 * `deleted_at`. Left alone, and listed:
 *
 *   - rows whose member id matches no member row at all;
 *   - rows a unique index would refuse once rekeyed: two members of one store
 *     who each made `INV-00001`, two farm profiles, a fund code used twice.
 *     All rows of such a clash are kept, for a person to resolve;
 *   - rows that hang off a parent row that keeps its member id (an invoice's
 *     payments, a fund's movements, a node's stock and transfers), so a
 *     child is never moved away from its parent.
 *
 * `apply` rewrites one table per transaction, in the order of the list. Each
 * table is locked against writes (SHARE ROW EXCLUSIVE; reads continue) for the
 * length of its own transaction, the plan is made again under the lock, and
 * every changed row is printed. A failure rolls that table back and the run
 * goes on to the next. A second run finds nothing left to rekey.
 *
 * Posture A (docs/POSTURE_A_COMPLIANCE.md): no hawala ledger table, no ledger
 * account, and nothing that moves or re-homes Coalition Credits is ever
 * rewritten here. The columns in {@link HELD_FOR_DECISION} hold member ids
 * that decide where money goes; they are counted read-only and left for an
 * operator and counsel to decide.
 *
 * Run it right after the SD-145 routes deploy: from then on the routes read
 * by the store id, and until this runs, records written under a member id are
 * not shown to the store (they are not lost). Run the dry run first, and
 * `apply` in a quiet window.
 */

export type RekeyTarget = {
  table: string
  column: string
  /** The routes that wrote the member id here. */
  writtenBy: string
  /**
   * A row whose foreign key (`via`) names a row of `table` that keeps its
   * member id keeps its own: the child follows its parent.
   */
  keepWithParent?: { table: string; via: readonly string[] }
}

/**
 * Every store column the SD-145 routes wrote the actor's member id into,
 * derived by reading each route and the service method it calls. Parents come
 * before their children.
 */
export const REKEY_TARGETS: readonly RekeyTarget[] = [
  // POST /vendor/customer-tiers (vendor-rules createVendorCustomerTiers), and
  // POST /vendor/nursery/channels, which creates a tier per sales channel.
  { table: "vendor_customer_tier", column: "seller_id", writtenBy: "customer-tiers, nursery/channels" },
  // POST /vendor/enterprise-fees (order-cycle createEnterpriseFees).
  { table: "enterprise_fee", column: "seller_id", writtenBy: "enterprise-fees" },
  // POST /vendor/invoices (accounts-receivable createDraft); unique per store
  // on invoice_number, so members' INV-00001s clash and are kept.
  { table: "ar_invoice", column: "seller_id", writtenBy: "invoices" },
  // POST /vendor/invoices/:id/payments: recordPayment copies the invoice's
  // seller_id onto each payment.
  {
    table: "ar_invoice_payment",
    column: "seller_id",
    writtenBy: "invoices/:id/payments",
    keepWithParent: { table: "ar_invoice", via: ["invoice_id"] },
  },
  // POST /vendor/quotes (quote createDraft); unique per store on quote_number.
  { table: "quote", column: "seller_id", writtenBy: "quotes" },
  // No farm table: POST /vendor/farm/profile never wrote one. It created the
  // producer without its required `seller_id` (refused by the database, so
  // nothing was written) and then linked it with a shape Medusa's Link throws
  // on (`{ producer_seller: ... }`), both measured on Postgres; nothing else
  // writes the seller-producer link, and `producer.seller_id` is written only
  // with a store id (the v1 launch flow, the growth-loop seed). Harvests, lots
  // and windows hang off the producer, not the store.
  // POST /vendor/woocommerce/connection (connectWooCommerceWorkflow); one per store.
  { table: "woocommerce_connection", column: "seller_id", writtenBy: "woocommerce/connection" },
  // POST /vendor/odoo/connection (connectOdooWorkflow); one per store.
  { table: "odoo_connection", column: "seller_id", writtenBy: "odoo/connection" },
  // Product links: POST /vendor/woocommerce/import and /vendor/odoo/import put
  // the actor on the import event, and the background import links each
  // product to it; POST /vendor/printful/import links them itself.
  {
    table: "seller_seller_product_product",
    column: "seller_id",
    writtenBy: "woocommerce/import, odoo/import, printful/import",
  },
  // POST /vendor/order-cycles.
  { table: "order_cycle", column: "coordinator_seller_id", writtenBy: "order-cycles" },
  // POST /vendor/order-cycles/:id/exchanges (seller_id defaults to the caller).
  { table: "order_cycle_exchange", column: "seller_id", writtenBy: "order-cycles/:id/exchanges" },
  // POST /vendor/order-cycles/:id/products, and
  // POST /vendor/order-cycles/:id/exchanges/:exchangeId/products.
  {
    table: "order_cycle_product",
    column: "seller_id",
    writtenBy: "order-cycles/:id/products, order-cycles/:id/exchanges/:exchangeId/products",
  },
  // POST /vendor/share-box-templates.
  { table: "share_box_template", column: "coordinator_seller_id", writtenBy: "share-box-templates" },
  // POST /vendor/quests/collective (formCollective).
  { table: "quest_collective", column: "owner_seller_id", writtenBy: "quests/collective" },
  // POST /vendor/quests/enrollments, /quests/collective, /quests/collective/:id/join.
  {
    table: "quest_enrollment",
    column: "seller_id",
    writtenBy: "quests/enrollments, quests/collective, quests/collective/:id/join",
  },
  // GET /vendor/quests/enrollments(/:id): syncProgress records a stage event
  // under the enrollment's seller_id.
  { table: "quest_stage_event", column: "seller_id", writtenBy: "quests/enrollments, quests/enrollments/:id" },
  // GET /vendor/quests/enrollments/:id/packet and /quests/collective/:id/packet.
  { table: "quest_packet", column: "seller_id", writtenBy: "quests/enrollments/:id/packet, quests/collective/:id/packet" },
  // POST /vendor/quests/collective/:id/consent (recordConsent).
  { table: "quest_member_consent", column: "seller_id", writtenBy: "quests/collective/:id/consent" },
  // POST /vendor/aid-network/nodes; unique per store on slug.
  { table: "network_node", column: "seller_id", writtenBy: "aid-network/nodes" },
  // POST /vendor/aid-network/intake (recordIntake).
  {
    table: "intake_receipt",
    column: "seller_id",
    writtenBy: "aid-network/intake",
    keepWithParent: { table: "network_node", via: ["node_id"] },
  },
  // POST /vendor/aid-network/intake and /aid-network/transfers/:id/receive.
  {
    table: "node_stock",
    column: "seller_id",
    writtenBy: "aid-network/intake, aid-network/transfers/:id/receive",
    keepWithParent: { table: "network_node", via: ["node_id"] },
  },
  // POST /vendor/aid-network/transfers.
  {
    table: "node_transfer",
    column: "seller_id",
    writtenBy: "aid-network/transfers",
    keepWithParent: { table: "network_node", via: ["from_node_id", "to_node_id"] },
  },
  // POST /vendor/funds (fund-accounting). Grant bookkeeping in cents: no
  // hawala table, no ledger account, no Coalition Credits balance (expenditures
  // cite hawala entries by id, and those are not touched). Unique per store on
  // code.
  { table: "fund", column: "seller_id", writtenBy: "funds" },
  // POST /vendor/funds/:id/entries (recordEntry).
  {
    table: "fund_transaction",
    column: "seller_id",
    writtenBy: "funds/:id/entries",
    keepWithParent: { table: "fund", via: ["fund_id"] },
  },
  // POST /vendor/vault.
  { table: "vault_document", column: "seller_id", writtenBy: "vault" },
  // POST /vendor/botanical/pathways (activatePathwayFromTemplate). The other
  // botanical tables have no writer.
  { table: "botanical_pathway", column: "maker_id", writtenBy: "botanical/pathways" },
  // PUT /vendor/cottage-food/profile and /cottage-food/onboarding
  // (upsertProfileForSeller); one per store.
  { table: "cottage_food_profile", column: "seller_id", writtenBy: "cottage-food/profile, cottage-food/onboarding" },
  // POST /vendor/cottage-food/labels (createLabelForSeller).
  { table: "cottage_food_label", column: "seller_id", writtenBy: "cottage-food/labels" },
  // POST /vendor/cottage-food/sales (recordSale).
  { table: "cottage_food_sales_entry", column: "seller_id", writtenBy: "cottage-food/sales" },
  // POST /vendor/nursery/products (upsertForProduct).
  { table: "nursery_product_attribute", column: "seller_id", writtenBy: "nursery/products" },
  // POST /vendor/plant-nursery/propagation/batches (startBatch).
  { table: "propagation_batch", column: "seller_id", writtenBy: "plant-nursery/propagation/batches" },
  // POST /vendor/production-batches.
  { table: "production_batch", column: "seller_id", writtenBy: "production-batches" },
  // POST /vendor/production-costs (recordCost).
  { table: "production_cost_entry", column: "seller_id", writtenBy: "production-costs" },
  // POST /vendor/collective/demand-pools/:id/proposals. A proposal names its
  // supplier; the pool's selection copies it (held below), so a proposal
  // already selected is rekeyed here while its pool keeps the member id.
  { table: "supplier_proposal", column: "supplier_id", writtenBy: "collective/demand-pools/:id/proposals" },
  // The same route, with bargaining_group_id (submitGroupProposal).
  { table: "bargaining_proposal", column: "proposer_id", writtenBy: "collective/demand-pools/:id/proposals" },
]

export type HeldColumn = {
  table: string
  column: string
  writtenBy: string
  reason: string
  /** Further columns shown in the sample. */
  detail?: readonly string[]
}

/**
 * Member ids that decide where money goes. Counted and sampled, never
 * rewritten: an operator and counsel decide (Posture A).
 */
export const HELD_FOR_DECISION: readonly HeldColumn[] = [
  {
    table: "hawala_vendor_payment",
    column: "payer_vendor_id",
    writtenBy: "pos/checkout",
    reason:
      "hawala ledger table: the payer of a vendor-to-vendor payment, whose SELLER_EARNINGS account the payment debited",
    detail: ["payer_ledger_account_id", "payee_vendor_id", "amount", "currency_code", "status"],
  },
  {
    table: "demand_post",
    column: "selected_supplier_id",
    writtenBy: "copied from a proposal of collective/demand-pools/:id/proposals when its pool selects it",
    reason:
      "the payee of the pool's escrow: the admin approval releases it to the SELLER_EARNINGS account owned by this id (processGroupPurchase)",
    detail: ["status", "final_total_price", "escrow_account_id"],
  },
  {
    table: "hawala_ledger_account",
    column: "owner_id",
    writtenBy: "none of these routes (the hawala earnings route minted SELLER_EARNINGS for member ids before resolveVendorSellerId)",
    reason:
      "ledger accounts owned by a member id; both money paths above find accounts by these ids, so they are reported with the holds",
    detail: ["owner_type", "account_type", "currency_code", "balance", "available_balance"],
  },
]

/** Rows printed per table in a sample. */
const SAMPLE = 5

type Pg = {
  raw: <T = Record<string, unknown>>(sql: string, bindings?: readonly unknown[]) => Promise<{ rows: T[] }>
  transaction: <R>(run: (trx: Pg) => Promise<R>) => Promise<R>
}

type Log = (line: string) => void

export type RowRef = { id: string; member_id: string; store_id: string | null }

export type TargetReport = {
  table: string
  column: string
  writtenBy: string
  /** `missing`: the table or column is not in this database. */
  status: "missing" | "planned" | "applied" | "failed"
  /** Rows holding a member id in the column, before this run. */
  found: number
  /** Rows rekeyed (`apply`) or to be rekeyed (dry run). */
  rekey: RowRef[]
  /** Of those, rows written by a member since removed, and rows of a closed store. */
  removedMember: number
  closedStore: number
  unmatched: RowRef[]
  conflicts: Array<RowRef & { index: string }>
  keptWithParent: RowRef[]
  /** Unique indexes on the column that use expressions: not checked here; a clash there rolls the table back. */
  uncheckedIndexes: string[]
  error?: string
}

export type HeldReport = HeldColumn & {
  status: "missing" | "counted"
  found: number
  sample: Array<Record<string, unknown>>
}

export type RekeySummary = { apply: boolean; targets: TargetReport[]; held: HeldReport[] }

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

/** A table or column name from the lists above, quoted. */
function ident(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`rekey-member-keyed-store-data: refusing identifier ${JSON.stringify(name)}`)
  }
  return `"${name}"`
}

async function columnsOf(pg: Pg, table: string): Promise<Set<string>> {
  const { rows } = await pg.raw<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`,
    [table]
  )
  return new Set(rows.map((r) => r.column_name))
}

type UniqueIndex = { name: string; columns: string[]; hasExpressions: boolean; predicate: string | null; nullsNotDistinct: boolean }

async function uniqueIndexesOn(pg: Pg, table: string, column: string): Promise<UniqueIndex[]> {
  const { rows } = await pg.raw<{
    name: string
    columns: string[] | null
    has_expressions: boolean
    predicate: string | null
    definition: string
    nulls_not_distinct: string | null
  }>(
    `SELECT ic.relname::text AS name,
            ARRAY(SELECT a.attname::text
                    FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                   ORDER BY k.ord) AS columns,
            (i.indexprs IS NOT NULL) AS has_expressions,
            pg_get_expr(i.indpred, i.indrelid) AS predicate,
            pg_get_indexdef(i.indexrelid) AS definition,
            to_jsonb(i) ->> 'indnullsnotdistinct' AS nulls_not_distinct
       FROM pg_index i
       JOIN pg_class ic ON ic.oid = i.indexrelid
      WHERE i.indrelid = to_regclass(?) AND i.indisunique`,
    [table]
  )
  return rows
    .filter((r) => (r.columns ?? []).includes(column) || (r.has_expressions && r.definition.includes(column)))
    .map((r) => ({
      name: r.name,
      columns: r.columns ?? [],
      hasExpressions: r.has_expressions,
      predicate: r.predicate,
      nullsNotDistinct: r.nulls_not_distinct === "true",
    }))
}

type Classified = RowRef & { row_ctid: string; matched: boolean; member_removed: boolean; store_closed: boolean; via: string[] }

/** Every row holding a member id in the column, with the member's store. */
async function classify(pg: Pg, target: RekeyTarget): Promise<Classified[]> {
  const t = ident(target.table)
  const c = ident(target.column)
  const via = target.keepWithParent?.via ?? []
  const viaSelect = via.map((v, i) => `, t.${ident(v)}::text AS via_${i}`).join("")
  const { rows } = await pg.raw<Record<string, unknown>>(
    `SELECT t.ctid::text AS row_ctid, t."id"::text AS id, t.${c} AS member_id,
            (m.id IS NOT NULL AND m.seller_id IS NOT NULL) AS matched,
            m.seller_id AS store_id,
            COALESCE(m.deleted_at IS NOT NULL, false) AS member_removed,
            COALESCE(s.deleted_at IS NOT NULL, false) AS store_closed${viaSelect}
       FROM ${t} t
       LEFT JOIN "member" m ON m.id = t.${c}
       LEFT JOIN "seller" s ON s.id = m.seller_id
      WHERE left(t.${c}, 4) = 'mem_'
      ORDER BY t."id", t.ctid`
  )
  return rows.map((r) => ({
    row_ctid: String(r.row_ctid),
    id: String(r.id),
    member_id: String(r.member_id),
    store_id: r.matched ? String(r.store_id) : null,
    matched: Boolean(r.matched),
    member_removed: Boolean(r.member_removed),
    store_closed: Boolean(r.store_closed),
    via: via.map((_, i) => (r[`via_${i}`] == null ? "" : String(r[`via_${i}`]))),
  }))
}

/**
 * The rows that would break this unique index once rekeyed: a moving row that
 * would share every indexed value with another row the index covers. NULLs
 * are distinct unless the index says otherwise, as Postgres has it.
 */
async function conflictsFor(pg: Pg, target: RekeyTarget, index: UniqueIndex): Promise<Set<string>> {
  const t = ident(target.table)
  const c = ident(target.column)
  const others = index.columns.filter((col) => col !== target.column)
  const otherSelect = others.map((col, i) => `, t.${ident(col)} AS k_${i}`).join("")
  const eq = index.nullsNotDistinct ? "IS NOT DISTINCT FROM" : "="
  const otherMatch = others.map((_, i) => ` AND o.k_${i} ${eq} p.k_${i}`).join("")
  const { rows } = await pg.raw<{ row_ctid: string }>(
    `WITH projected AS (
       SELECT t.row_ctid,
              CASE WHEN left(t.${c}, 4) = 'mem_' AND m.seller_id IS NOT NULL THEN m.seller_id ELSE t.${c} END AS new_key,
              (left(t.${c}, 4) = 'mem_' AND m.seller_id IS NOT NULL) AS moving${otherSelect}
         FROM (SELECT ctid AS row_ctid, * FROM ${t} WHERE ${predicateSql(index.predicate)}) t
         LEFT JOIN "member" m ON m.id = t.${c}
     )
     SELECT p.row_ctid::text AS row_ctid
       FROM projected p
      WHERE p.moving
        AND EXISTS (SELECT 1 FROM projected o
                     WHERE o.row_ctid <> p.row_ctid AND o.new_key ${eq} p.new_key${otherMatch})`
  )
  return new Set(rows.map((r) => r.row_ctid))
}

/**
 * An index predicate as Postgres prints it (`pg_get_expr`), for a raw query:
 * knex reads a bare `?` as a binding, so the jsonb `?` operator is escaped.
 */
function predicateSql(predicate: string | null): string {
  return predicate ? `(${predicate.replace(/\?/g, "\\?")})` : "TRUE"
}

type Plan = { report: TargetReport; rekeyCtids: string[]; keptIds: Set<string> }

async function plan(pg: Pg, target: RekeyTarget, keptByTable: Map<string, Set<string>>): Promise<Plan> {
  const report: TargetReport = {
    table: target.table,
    column: target.column,
    writtenBy: target.writtenBy,
    status: "planned",
    found: 0,
    rekey: [],
    removedMember: 0,
    closedStore: 0,
    unmatched: [],
    conflicts: [],
    keptWithParent: [],
    uncheckedIndexes: [],
  }
  const columns = await columnsOf(pg, target.table)
  const via = target.keepWithParent?.via ?? []
  if (!columns.has(target.column) || !columns.has("id") || via.some((v) => !columns.has(v))) {
    report.status = "missing"
    return { report, rekeyCtids: [], keptIds: new Set() }
  }

  const rows = await classify(pg, target)
  report.found = rows.length

  const conflictIndex = new Map<string, string>()
  for (const index of await uniqueIndexesOn(pg, target.table, target.column)) {
    if (index.hasExpressions) {
      report.uncheckedIndexes.push(index.name)
      continue
    }
    for (const ctid of await conflictsFor(pg, target, index)) {
      if (!conflictIndex.has(ctid)) conflictIndex.set(ctid, index.name)
    }
  }

  const keptParents = target.keepWithParent ? keptByTable.get(target.keepWithParent.table) ?? new Set<string>() : new Set<string>()
  const rekeyCtids: string[] = []
  const keptIds = new Set<string>()
  for (const row of rows) {
    const ref: RowRef = { id: row.id, member_id: row.member_id, store_id: row.store_id }
    if (!row.matched) {
      report.unmatched.push(ref)
      keptIds.add(row.id)
    } else if (conflictIndex.has(row.row_ctid)) {
      report.conflicts.push({ ...ref, index: conflictIndex.get(row.row_ctid) as string })
      keptIds.add(row.id)
    } else if (row.via.some((parentId) => parentId && keptParents.has(parentId))) {
      report.keptWithParent.push(ref)
      keptIds.add(row.id)
    } else {
      report.rekey.push(ref)
      rekeyCtids.push(row.row_ctid)
      if (row.member_removed) report.removedMember += 1
      if (row.store_closed) report.closedStore += 1
    }
  }
  return { report, rekeyCtids, keptIds }
}

/** A Postgres `tid[]` literal for these ctids ("(0,1)" and the like). */
function tidArray(ctids: readonly string[]): string {
  return `{${ctids.map((ctid) => `"${ctid.replace(/[^0-9(),]/g, "")}"`).join(",")}}`
}

async function rekeyTable(pg: Pg, target: RekeyTarget, keptByTable: Map<string, Set<string>>): Promise<Plan> {
  const columns = await columnsOf(pg, target.table)
  if (!columns.has(target.column)) {
    // Nothing to lock: plan() reports it as missing.
    return plan(pg, target, keptByTable)
  }
  return pg.transaction(async (trx) => {
    await trx.raw(`LOCK TABLE ${ident(target.table)} IN SHARE ROW EXCLUSIVE MODE`)
    const planned = await plan(trx, target, keptByTable)
    if (planned.report.status === "missing" || planned.rekeyCtids.length === 0) {
      planned.report.status = planned.report.status === "missing" ? "missing" : "applied"
      return planned
    }
    const t = ident(target.table)
    const c = ident(target.column)
    const { rows } = await trx.raw<{ id: string; member_id: string; store_id: string }>(
      `UPDATE ${t} t
          SET ${c} = m.seller_id
         FROM "member" m
        WHERE m.id = t.${c}
          AND m.seller_id IS NOT NULL
          AND left(t.${c}, 4) = 'mem_'
          AND t.ctid = ANY(?::tid[])
      RETURNING t."id"::text AS id, m.id AS member_id, t.${c} AS store_id`,
      [tidArray(planned.rekeyCtids)]
    )
    if (rows.length !== planned.rekeyCtids.length) {
      throw new Error(
        `${target.table}.${target.column}: planned ${planned.rekeyCtids.length} rows under the lock, updated ${rows.length}`
      )
    }
    planned.report.rekey = rows
      .map((r) => ({ id: r.id, member_id: r.member_id, store_id: r.store_id }))
      .sort((a, b) => a.id.localeCompare(b.id))
    planned.report.status = "applied"
    return planned
  })
}

async function countHeld(pg: Pg, held: HeldColumn): Promise<HeldReport> {
  const columns = await columnsOf(pg, held.table)
  if (!columns.has(held.column) || !columns.has("id")) {
    return { ...held, status: "missing", found: 0, sample: [] }
  }
  const t = ident(held.table)
  const c = ident(held.column)
  const detail = (held.detail ?? []).filter((d) => columns.has(d))
  const detailSelect = detail.map((d) => `, t.${ident(d)}::text AS ${ident(d)}`).join("")
  const [{ rows: count }, { rows: sample }] = await Promise.all([
    pg.raw<{ n: string }>(`SELECT count(*)::text AS n FROM ${t} t WHERE left(t.${c}, 4) = 'mem_'`),
    pg.raw<Record<string, unknown>>(
      `SELECT t."id"::text AS id, t.${c} AS member_id, m.seller_id AS store_id${detailSelect}
         FROM ${t} t
         LEFT JOIN "member" m ON m.id = t.${c}
        WHERE left(t.${c}, 4) = 'mem_'
        ORDER BY t."id"
        LIMIT ${SAMPLE}`
    ),
  ])
  return { ...held, status: "counted", found: Number(count[0]?.n ?? 0), sample }
}

/** Plan, or with `apply` perform, the rekey. Prints as it goes. */
export async function rekeyMemberKeyedStoreData(
  container: MedusaContainer,
  options: { apply: boolean; log?: Log; targets?: readonly RekeyTarget[]; held?: readonly HeldColumn[] }
): Promise<RekeySummary> {
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as Pg
  const log: Log = options.log ?? (() => undefined)
  const keptByTable = new Map<string, Set<string>>()
  const targets: TargetReport[] = []

  for (const target of options.targets ?? REKEY_TARGETS) {
    let planned: Plan
    try {
      planned = options.apply ? await rekeyTable(pg, target, keptByTable) : await plan(pg, target, keptByTable)
    } catch (error) {
      // The table's transaction rolled back: every member-keyed row in it
      // keeps its member id, and so do its children.
      const message = error instanceof Error ? error.message : String(error)
      const remaining = await plan(pg, target, keptByTable).catch(() => null)
      const report: TargetReport = remaining
        ? { ...remaining.report, rekey: [], status: "failed", error: message }
        : {
            table: target.table,
            column: target.column,
            writtenBy: target.writtenBy,
            status: "failed",
            found: 0,
            rekey: [],
            removedMember: 0,
            closedStore: 0,
            unmatched: [],
            conflicts: [],
            keptWithParent: [],
            uncheckedIndexes: [],
            error: message,
          }
      const kept = new Set<string>(remaining ? [...remaining.keptIds, ...remaining.report.rekey.map((r) => r.id)] : [])
      planned = { report, rekeyCtids: [], keptIds: kept }
    }
    keptByTable.set(target.table, planned.keptIds)
    targets.push(planned.report)
    printTarget(planned.report, options.apply, log)
  }

  const held: HeldReport[] = []
  for (const column of options.held ?? HELD_FOR_DECISION) {
    const report = await countHeld(pg, column)
    held.push(report)
    printHeld(report, log)
  }

  return { apply: options.apply, targets, held }
}

const refLine = (r: RowRef) => `${r.id} ${r.member_id} -> ${r.store_id ?? "(no member)"}`

function printTarget(r: TargetReport, apply: boolean, log: Log): void {
  const name = `${r.table}.${r.column}`
  if (r.status === "missing") {
    log(`${name}: not in this database (skipped)`)
    return
  }
  const verb = apply ? (r.status === "applied" ? "rekeyed" : "rekeyed 0, rolled back") : "would rekey"
  log(
    `${name} [${r.writtenBy}]: ${r.found} member-keyed; ${verb} ${r.rekey.length}` +
      ` (removed member ${r.removedMember}, closed store ${r.closedStore});` +
      ` no member ${r.unmatched.length}; unique clash ${r.conflicts.length}; kept with parent ${r.keptWithParent.length}`
  )
  if (r.error) log(`  FAILED, rolled back: ${r.error}`)
  const shown = apply ? r.rekey : r.rekey.slice(0, SAMPLE)
  for (const row of shown) log(`  ${apply ? "changed" : "sample"} ${refLine(row)}`)
  if (!apply && r.rekey.length > SAMPLE) log(`  ... and ${r.rekey.length - SAMPLE} more`)
  for (const row of r.unmatched) log(`  left alone (no such member) ${row.id} ${row.member_id}`)
  for (const row of r.conflicts) log(`  left alone (would break ${row.index}) ${refLine(row)}`)
  for (const row of r.keptWithParent) log(`  left alone (parent keeps its member id) ${refLine(row)}`)
  for (const index of r.uncheckedIndexes) log(`  unique index ${index} uses expressions and is not checked; a clash there rolls the table back`)
}

function printHeld(r: HeldReport, log: Log): void {
  const name = `${r.table}.${r.column}`
  if (r.status === "missing") {
    log(`HELD ${name}: not in this database`)
    return
  }
  log(`HELD ${name} [${r.writtenBy}]: ${r.found} member-keyed, never rewritten here: ${r.reason}`)
  for (const row of r.sample) log(`  ${JSON.stringify(row)}`)
}

export default async function run({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const tag = "[rekey-member-keyed-store-data]"
  const parsed = parseScriptArgs(args, APPLY_OR_DRY_RUN)
  if (!parsed.ok) {
    // Thrown, so `medusa exec` exits non-zero: nothing was read.
    logger.error(`${tag} refused: ${parsed.message}`)
    throw new Error(`rekey-member-keyed-store-data refused: ${parsed.message}`)
  }
  const apply = parsed.flags.has("apply")
  logger.info(`${tag} ${apply ? "apply: rewriting, one transaction per table" : "dry run: nothing is written; add `apply` to write"}`)
  const summary = await rekeyMemberKeyedStoreData(container, { apply, log: (line) => logger.info(`${tag} ${line}`) })
  const total = summary.targets.reduce((n, t) => n + t.rekey.length, 0)
  const left = summary.targets.reduce((n, t) => n + t.unmatched.length + t.conflicts.length + t.keptWithParent.length, 0)
  const failed = summary.targets.filter((t) => t.status === "failed").map((t) => `${t.table}.${t.column}`)
  const held = summary.held.reduce((n, h) => n + h.found, 0)
  logger.info(
    `${tag} ${apply ? "rekeyed" : "would rekey"} ${total} rows; left alone ${left}; ` +
      `held for an operator and counsel decision ${held}` +
      (failed.length ? `; FAILED and rolled back: ${failed.join(", ")}` : "")
  )
  if (failed.length) {
    throw new Error(`rekey-member-keyed-store-data: ${failed.join(", ")} failed and rolled back`)
  }
}

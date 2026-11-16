import { expect, test, type Page } from "@playwright/test"

/**
 * The admin panel's Disputes screens (`admin-panel/src/routes/disputes`),
 * rendered in a real browser against a mocked backend.
 *
 * The panel has no DOM test library, so until this spec nothing had ever
 * mounted these screens: the rules behind them are unit-tested
 * (`dispute-rules.spec.ts`) and the API they call is pinned on a real
 * database (`backend/integration-tests/http/admin-disputes.spec.ts`), but
 * whether the pages load, the filter drives the query, the decision panel
 * sends what the server expects and a refusal reaches the operator was
 * checked by nobody.
 *
 * Every `/admin/*` and `/auth/*` call is answered here with `page.route`
 * (nothing reaches a backend): the signed-in user, the store the shell
 * reads, a disputes queue and case files with their event logs, and a
 * PATCH that applies the backend's own rules and answers in its words: a
 * closing decision needs a note (400 `note_required`); an award must be a
 * whole number of minor units, no more than the claim, nothing on a release
 * and something on a refund (400 `invalid_award_amount`); a case already
 * decided answers 409 "cannot move a dispute from X to Y", which is what
 * `backend/integration-tests/http/admin-disputes.spec.ts` gets on Postgres;
 * and only a case decided between the server's read and its write answers
 * 409 "this dispute changed while it was being decided" (`raceNext`). The
 * panel is pointed at its own origin for the API through
 * `window.__MEDUSA_BACKEND_URL__`, which it reads before its build-time
 * backend URL, so the same spec runs against the compose-built panel in CI
 * (ADMIN_URL, port 7000) and against `vite` locally:
 *
 *     cd admin-panel && npx vite --port 5391
 *     cd e2e && ADMIN_URL=http://localhost:5391 npx playwright test admin-disputes
 *
 * Set DISPUTES_SMOKE_SCREENSHOTS to a directory to keep a screenshot of
 * each step there; otherwise they go to the test's output directory.
 */

const ADMIN = process.env.ADMIN_URL || "http://localhost:7000"
const ORIGIN = new URL(ADMIN).origin

test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })

type Dispute = {
  id: string
  order_id: string
  seller_id: string
  customer_id: string
  status: string
  reason: string
  description: string
  currency_code: string
  claim_amount: number
  award_amount: number
  seller_response: string | null
  seller_responded_at: string | null
  resolution_note: string | null
  resolved_at: string | null
  resolved_by: string | null
  escrow_agreement_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

type DisputeEvent = {
  id: string
  kind: string
  actor_type: string
  actor_id: string | null
  from_status: string | null
  to_status: string | null
  message: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

function dispute(id: string, over: Partial<Dispute> = {}): Dispute {
  return {
    id,
    order_id: `order_${id}`,
    seller_id: "sel_grower",
    customer_id: "cus_buyer",
    status: "open",
    reason: "not_received",
    description: "Tracking says delivered on Tuesday; nothing arrived and the neighbours have nothing.",
    currency_code: "usd",
    claim_amount: 2599,
    award_amount: 0,
    seller_response: null,
    seller_responded_at: null,
    resolution_note: null,
    resolved_at: null,
    resolved_by: null,
    escrow_agreement_id: null,
    metadata: {
      contacted_seller: true,
      evidence_urls: ["https://track.example.com/1Z999", "javascript:alert(1)"],
      intake_source: "store/order-claims",
      amount_unit: "minor",
    },
    created_at: daysAgo(3),
    updated_at: daysAgo(3),
    ...over,
  }
}

const LIVE = new Set(["open", "under_review"])
const CLOSING = new Set(["resolved_refund", "resolved_release", "withdrawn"])
const ALLOWED: Record<string, string[]> = {
  open: ["under_review", "resolved_refund", "resolved_release", "withdrawn"],
  under_review: ["resolved_refund", "resolved_release", "withdrawn"],
}

/**
 * A stand-in for the backend: state per dispute, and the PATCH rules of
 * `backend/src/api/admin/disputes/[id]/route.ts` and the order-dispute
 * service. Records every PATCH body and every unanswered call.
 */
async function mockBackend(page: Page, seed: Dispute[]) {
  const disputes = new Map(seed.map((d) => [d.id, { ...d }]))
  const events = new Map<string, DisputeEvent[]>(
    seed.map((d) => [
      d.id,
      [
        {
          id: `ev_${d.id}_0`,
          kind: "opened",
          actor_type: "buyer",
          actor_id: d.customer_id,
          from_status: null,
          to_status: "open",
          message: d.description,
          metadata: null,
          created_at: d.created_at,
        },
      ],
    ])
  )
  const patches: { id: string; body: Record<string, unknown> }[] = []
  const listQueries: string[] = []
  const detailReads: string[] = []
  const unexpected: string[] = []
  const racing = new Set<string>()

  const log = (id: string, e: Omit<DisputeEvent, "id" | "created_at">) =>
    events.get(id)!.push({ ...e, id: `ev_${id}_${events.get(id)!.length}`, created_at: new Date().toISOString() })

  /** Another admin decides the case on the server; the open page does not know. */
  const decideElsewhere = (id: string, status: string, note: string) => {
    const d = disputes.get(id)!
    log(id, { kind: "resolved", actor_type: "admin", actor_id: "user_other", from_status: d.status, to_status: status, message: note, metadata: { award_amount: 0 } })
    Object.assign(d, { status, resolution_note: note, resolved_at: new Date().toISOString(), resolved_by: "user_other" })
  }

  /**
   * The next PATCH on this case loses the race the service's conditional
   * write guards: it read the case while still open, and another operator's
   * release landed before its write. Only then does the backend send the
   * "changed while it was being decided" message.
   */
  const raceNext = (id: string) => racing.add(id)

  await page.addInitScript(() => {
    ;(window as unknown as { __MEDUSA_BACKEND_URL__: string }).__MEDUSA_BACKEND_URL__ = window.location.origin
  })

  await page.route(
    (url) => url.origin === ORIGIN && /^\/(admin|auth)\//.test(url.pathname),
    async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      const path = url.pathname
      const method = req.method()
      const json = (body: unknown, status = 200) => route.fulfill({ status, json: body })

      if (path === "/admin/users/me") {
        return json({ user: { id: "user_ops", email: "ops@example.com", first_name: "Ops", last_name: "Admin", metadata: {} } })
      }
      if (path === "/admin/stores") {
        return json({ stores: [{ id: "store_1", name: "Free Black Market", supported_currencies: [{ currency_code: "usd", is_default: true }], metadata: {} }], count: 1, offset: 0, limit: 50 })
      }

      if (path === "/admin/disputes" && method === "GET") {
        const status = url.searchParams.get("status")
        listQueries.push(status ?? "(queue)")
        const rows = [...disputes.values()]
          .filter((d) => (status ? d.status === status : LIVE.has(d.status)))
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
        return json({ disputes: rows, count: rows.length })
      }

      const detail = path.match(/^\/admin\/disputes\/([^/]+)$/)
      if (detail) {
        const id = decodeURIComponent(detail[1])
        const d = disputes.get(id)
        if (!d) return json({ message: "Dispute not found" }, 404)
        if (method === "GET") {
          detailReads.push(id)
          return json({ dispute: d, events: events.get(id) })
        }
        if (method === "PATCH") {
          const body = (req.postDataJSON() ?? {}) as Record<string, unknown>
          patches.push({ id, body })
          const to = String(body.status ?? "")
          const note = typeof body.note === "string" ? body.note.trim() : ""
          if (CLOSING.has(to) && !note) return json({ message: "A decision that closes the case needs a note saying why", type: "note_required" }, 400)
          const raw = body.award_amount
          if (raw !== undefined && raw !== null && !(typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0)) {
            return json({ message: "award_amount must be a whole number of the currency's minor unit", type: "invalid_award_amount" }, 400)
          }
          if (racing.delete(id)) {
            const from = d.status
            decideElsewhere(id, "resolved_release", "Signed for at the door.")
            return json({ message: `this dispute changed while it was being decided (it is no longer ${from}); reload it` }, 409)
          }
          if (!(ALLOWED[d.status] ?? []).includes(to)) {
            return json({ message: `cannot move a dispute from ${d.status} to ${to}` }, 409)
          }
          if (to === "under_review") {
            log(id, { kind: "status_changed", actor_type: "admin", actor_id: "user_ops", from_status: d.status, to_status: to, message: null, metadata: null })
            d.status = to
            return json({ dispute: d, escrow_transition: null })
          }
          let award = 0
          const invalidAward = (message: string) => json({ message, type: "invalid_award_amount" }, 400)
          if (to === "resolved_refund") {
            award = typeof raw === "number" ? raw : d.claim_amount
            if (award > d.claim_amount) return invalidAward(`award of ${award} exceeds the ${d.claim_amount} claimed`)
            if (award === 0) return invalidAward("a refund resolution must award something — use resolved_release to award nothing")
          }
          if (to === "resolved_release" && typeof raw === "number" && raw > 0) {
            return invalidAward("a release resolution awards nothing — use resolved_refund to award a refund")
          }
          log(id, { kind: "resolved", actor_type: "admin", actor_id: "user_ops", from_status: d.status, to_status: to, message: note, metadata: { award_amount: award } })
          Object.assign(d, { status: to, award_amount: award, resolution_note: note, resolved_at: new Date().toISOString(), resolved_by: "user_ops" })
          return json({ dispute: d, escrow_transition: null, escrow_agreement_id: null })
        }
      }

      const order = path.match(/^\/admin\/orders\/([^/]+)$/)
      if (order) {
        return json({ order: { id: order[1], display_id: 1042, email: "buyer@example.com", total: 25.99, currency_code: "usd", created_at: daysAgo(10), status: "completed" } })
      }
      if (path === "/admin/customers/cus_buyer") {
        return json({ customer: { id: "cus_buyer", email: "buyer@example.com", first_name: "Ada", last_name: "Buyer" } })
      }
      if (path === "/admin/sellers/sel_grower") {
        return json({ seller: { id: "sel_grower", name: "Riverside Growers", email: "grower@example.com" } })
      }

      // Everything else the shell asks for on load (notifications, the
      // search palette's prefetch): an empty list under the resource's name.
      if (method === "GET") {
        const resource = path.split("/").pop() ?? ""
        const key = resource.replace(/-/g, "_")
        return json({ [key]: [], [resource.split("-").pop() ?? key]: [], count: 0, offset: 0, limit: 0 })
      }
      unexpected.push(`${method} ${path}`)
      return json({ message: "not mocked" }, 500)
    }
  )

  return { disputes, events, patches, listQueries, detailReads, unexpected, decideElsewhere, raceNext }
}

/** Fail the test on anything the page throws. */
function watchErrors(page: Page) {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}

async function shot(page: Page, name: string) {
  const dir = process.env.DISPUTES_SMOKE_SCREENSHOTS
  const path = dir ? `${dir}/${name}.png` : test.info().outputPath(`${name}.png`)
  // Let toasts and dialogs finish animating in, so the picture shows them.
  await page.waitForTimeout(500)
  await page.screenshot({ path })
}

const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text })

test.describe("admin Disputes screens", () => {
  test("the queue lists what needs a decision, and the filter shows decided cases", async ({ page }) => {
    const errors = watchErrors(page)
    const api = await mockBackend(page, [
      dispute("odsp_newer", { created_at: daysAgo(1) }),
      dispute("odsp_older", { created_at: daysAgo(6), reason: "damaged", claim_amount: 4250 }),
      dispute("odsp_refunded", { status: "resolved_refund", award_amount: 2599, resolution_note: "Never shipped.", resolved_at: daysAgo(2) }),
    ])

    await page.goto(`${ADMIN}/disputes`)
    await expect(page.getByRole("heading", { name: "Disputes" })).toBeVisible()
    const rows = page.locator("table tbody tr")
    await expect(rows).toHaveCount(2)
    // Oldest first, with days waiting and the claim in dollars, not cents.
    await expect(rows.nth(0)).toContainText("order_odsp_older")
    await expect(rows.nth(0)).toContainText("6 days")
    await expect(rows.nth(0)).toContainText("Arrived damaged")
    await expect(rows.nth(0)).toContainText("$42.50")
    await expect(rows.nth(1)).toContainText("$25.99")
    await shot(page, "01-queue")

    await page.getByRole("combobox", { name: "Show disputes" }).click()
    await page.getByRole("option", { name: "Decided: refund" }).click()
    await expect(page).toHaveURL(/\/disputes\?status=resolved_refund$/)
    await expect(rows).toHaveCount(1)
    await expect(rows.nth(0)).toContainText("Decided: refund")
    // A decided case is not "waiting": the column is blank for it.
    await expect(rows.nth(0).locator("td").nth(1)).toHaveText("—")
    expect(api.listQueries).toEqual(["(queue)", "resolved_refund"])
    await shot(page, "02-filter-decided-refund")

    await page.getByRole("combobox", { name: "Show disputes" }).click()
    await page.getByRole("option", { name: "Withdrawn" }).click()
    await expect(page.getByText("No disputes are withdrawn.")).toBeVisible()

    expect(errors).toEqual([])
    expect(api.unexpected).toEqual([])
  })

  test("a case file: take it under review, then refund an exact amount", async ({ page }) => {
    const errors = watchErrors(page)
    const api = await mockBackend(page, [dispute("odsp_case")])

    await page.goto(`${ADMIN}/disputes`)
    await page.locator("table tbody tr").first().getByRole("button", { name: "Open" }).click()
    await expect(page).toHaveURL(/\/disputes\/odsp_case$/)

    // The claim, what the buyer sent, both parties and the log.
    await expect(page.getByText("Claimed").locator("..")).toContainText("$25.99")
    await expect(page.getByRole("link", { name: "https://track.example.com/1Z999" })).toHaveAttribute("rel", "noopener noreferrer")
    await expect(page.getByText("1 more not shown: not a web address")).toBeVisible()
    await expect(page.getByText("Storefront claim form")).toBeVisible()
    await expect(page.getByRole("link", { name: "#1042" })).toBeVisible()
    await expect(page.getByRole("link", { name: "buyer@example.com" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Riverside Growers" })).toBeVisible()
    await expect(page.getByText("Buyer opened the dispute")).toBeVisible()
    await shot(page, "03-case-file-open")

    await page.getByRole("button", { name: "Take it under review" }).click()
    await expect(toast(page, "Taken under review")).toBeVisible()
    await expect(page.getByText("Under review", { exact: true }).first()).toBeVisible()
    await expect(page.getByText("Admin moved it from open to under review")).toBeVisible()
    await expect(page.getByRole("button", { name: "Take it under review" })).toHaveCount(0)
    expect(api.patches).toEqual([{ id: "odsp_case", body: { status: "under_review" } }])
    await shot(page, "04-under-review")

    await page.getByRole("button", { name: "Refund the buyer" }).click()
    // The note's label says who can read it.
    await expect(
      page.getByText("Decision note: the buyer and the seller can read this in their claim records; it is not emailed")
    ).toBeVisible()
    await page.getByLabel("Award (USD)").fill("12.50")
    // No note yet: the screen explains and will not send.
    await expect(page.getByText("Write a decision note saying why")).toBeVisible()
    await expect(page.getByRole("button", { name: "Record decision" })).toBeDisabled()
    await page.getByLabel(/Decision note/).fill("One of the two boxes arrived; refund the other.")
    await shot(page, "05-refund-amount-filled")

    await page.getByRole("button", { name: "Record decision" }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toContainText("The buyer and the seller are not notified by this screen.")
    await shot(page, "06-confirm")
    await dialog.getByRole("button", { name: "Record decision" }).click()

    await expect(toast(page, "Decision recorded")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Decision" })).toBeVisible()
    await expect(page.getByText("Awarded").locator("..")).toContainText("$12.50")
    await expect(page.getByText("No money has moved.")).toBeVisible()
    await expect(page.getByText("Admin decided: refund the buyer, awarding $12.50")).toBeVisible()
    expect(api.patches[1]).toEqual({
      id: "odsp_case",
      body: { status: "resolved_refund", award_amount: 1250, note: "One of the two boxes arrived; refund the other." },
    })
    await shot(page, "07-decided-partial-refund")

    expect(errors).toEqual([])
    expect(api.unexpected).toEqual([])
  })

  test("a refund with no amount sends none, and the whole claim is awarded", async ({ page }) => {
    const errors = watchErrors(page)
    const api = await mockBackend(page, [dispute("odsp_whole", { claim_amount: 4250 })])

    await page.goto(`${ADMIN}/disputes/odsp_whole`)
    await page.getByRole("button", { name: "Refund the buyer" }).click()
    await expect(page.getByLabel("Award (USD)")).toHaveAttribute("placeholder", "Blank awards the full claim ($42.50)")
    await page.getByLabel(/Decision note/).fill("Never shipped; the seller agrees.")
    await page.getByRole("button", { name: "Record decision" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Record decision" }).click()

    await expect(toast(page, "Decision recorded")).toBeVisible()
    await expect(page.getByText("Awarded").locator("..")).toContainText("$42.50")
    expect(api.patches).toEqual([
      { id: "odsp_whole", body: { status: "resolved_refund", note: "Never shipped; the seller agrees." } },
    ])
    await shot(page, "08-decided-whole-refund")

    expect(errors).toEqual([])
    expect(api.unexpected).toEqual([])
  })

  /**
   * The backend's answer here is "cannot move a dispute from
   * resolved_release to resolved_refund" (status words, not a sentence).
   * The spec used to mock the race message instead, which the backend sends
   * only in the race below, so it tested a toast operators never saw.
   */
  test("a decision someone else already made comes back as a 409, and the operator is told in words", async ({ page }) => {
    const errors = watchErrors(page)
    const api = await mockBackend(page, [dispute("odsp_race")])

    await page.goto(`${ADMIN}/disputes/odsp_race`)
    await page.getByRole("button", { name: "Refund the buyer" }).click()
    await page.getByLabel(/Decision note/).fill("Refund in full.")

    // Another operator releases it while this page is open.
    api.decideElsewhere("odsp_race", "resolved_release", "Signed for at the door.")

    await page.getByRole("button", { name: "Record decision" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Record decision" }).click()

    await expect(
      toast(page, "This dispute was already decided or changed by someone else. The page now shows where it stands.")
    ).toBeVisible()
    await expect(page.getByText(/cannot move a dispute|resolved_release/)).toHaveCount(0)
    // Sent once: a refusal is not retried behind the operator's back.
    expect(api.patches).toEqual([{ id: "odsp_race", body: { status: "resolved_refund", note: "Refund in full." } }])
    // And the case file shows what the server now says, without a reload:
    // the other operator's release, and no decision left to offer.
    await expect(page.getByRole("heading", { name: "Decision" })).toBeVisible()
    await expect(page.getByText("Outcome").locator("..")).toContainText("Decided: release")
    await expect(page.getByText("Note", { exact: true }).locator("..")).toContainText("Signed for at the door.")
    await expect(page.getByRole("button", { name: "Record decision" })).toHaveCount(0)
    await shot(page, "09-conflict-toast-and-refreshed")

    expect(errors).toEqual([])
    expect(api.unexpected).toEqual([])
  })

  test("a decision that loses the race to another operator's write gets the same words", async ({ page }) => {
    const errors = watchErrors(page)
    const api = await mockBackend(page, [dispute("odsp_close")])

    await page.goto(`${ADMIN}/disputes/odsp_close`)
    await page.getByRole("button", { name: "Refund the buyer" }).click()
    await page.getByLabel(/Decision note/).fill("Refund in full.")
    api.raceNext("odsp_close")

    await page.getByRole("button", { name: "Record decision" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Record decision" }).click()

    await expect(
      toast(page, "This dispute was already decided or changed by someone else. The page now shows where it stands.")
    ).toBeVisible()
    await expect(page.getByText(/changed while it was being decided/)).toHaveCount(0)
    expect(api.patches).toHaveLength(1)
    await expect(page.getByText("Outcome").locator("..")).toContainText("Decided: release")
    await expect(page.getByRole("button", { name: "Record decision" })).toHaveCount(0)
    await shot(page, "10-race-toast-and-refreshed")

    expect(errors).toEqual([])
    expect(api.unexpected).toEqual([])
  })

  /**
   * The queue and the case file are sibling routes, so the queue is
   * unmounted while a case is open, and the panel sets `refetchOnMount:
   * false` for every query. Going back used to show the pre-decision queue
   * from cache with no request: the decided case still listed as Open.
   */
  test("after a decision, Back to disputes shows the queue without the decided case", async ({ page }) => {
    const errors = watchErrors(page)
    const api = await mockBackend(page, [
      dispute("odsp_one", { created_at: daysAgo(3) }),
      dispute("odsp_two", { created_at: daysAgo(5) }),
    ])

    await page.goto(`${ADMIN}/disputes`)
    const rows = page.locator("table tbody tr")
    await expect(rows).toHaveCount(2)
    await rows.filter({ hasText: "order_odsp_one" }).getByRole("button", { name: "Open" }).click()
    await expect(page).toHaveURL(/\/disputes\/odsp_one$/)

    await page.getByRole("button", { name: "Refund the buyer" }).click()
    await page.getByLabel(/Decision note/).fill("Never shipped.")
    await page.getByRole("button", { name: "Record decision" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Record decision" }).click()
    await expect(toast(page, "Decision recorded")).toBeVisible()

    await page.getByRole("button", { name: "Back to disputes" }).click()
    await expect(page).toHaveURL(/\/disputes$/)
    await expect(rows).toHaveCount(1)
    await expect(rows.nth(0)).toContainText("order_odsp_two")
    await expect(page.getByText("order_odsp_one")).toHaveCount(0)
    // The queue was asked again, not read from cache.
    expect(api.listQueries.filter((q) => q === "(queue)").length).toBeGreaterThanOrEqual(2)
    await shot(page, "11-back-to-queue-after-decision")

    expect(errors).toEqual([])
    expect(api.unexpected).toEqual([])
  })

  test("a case file reopened after someone else decided it shows their decision, not a stale form", async ({ page }) => {
    const errors = watchErrors(page)
    const api = await mockBackend(page, [dispute("odsp_seen")])

    await page.goto(`${ADMIN}/disputes`)
    await page.locator("table tbody tr").first().getByRole("button", { name: "Open" }).click()
    await expect(page.getByRole("button", { name: "Refund the buyer" })).toBeVisible()
    await page.getByRole("button", { name: "Back to disputes" }).click()
    await expect(page.locator("table tbody tr")).toHaveCount(1)

    // Another operator decides it while this tab is on the queue.
    api.decideElsewhere("odsp_seen", "resolved_release", "Signed for at the door.")
    const readsBefore = api.detailReads.length

    await page.locator("table tbody tr").first().getByRole("button", { name: "Open" }).click()
    await expect(page.getByText("Outcome").locator("..")).toContainText("Decided: release")
    await expect(page.getByRole("button", { name: "Refund the buyer" })).toHaveCount(0)
    expect(api.detailReads.length).toBeGreaterThan(readsBefore)

    expect(errors).toEqual([])
    expect(api.unexpected).toEqual([])
  })
})

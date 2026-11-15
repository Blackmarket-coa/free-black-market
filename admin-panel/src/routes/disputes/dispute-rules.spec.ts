import { readFileSync } from "fs"
import path from "path"

import { describe, expect, it } from "vitest"

import {
  ADMIN_TRANSITIONS,
  DISPUTE_STATUSES,
  REASON_LABELS,
  STATUS_LABELS,
  adminActionsFor,
  buyerSubmission,
  daysWaiting,
  describeEvent,
  escrowTransitionFor,
  formatMajor,
  formatMinor,
  listQuery,
  parseAmount,
  parseFilter,
  resolutionDraft,
} from "./dispute-rules"

const open = { status: "open" as const, claim_amount: 2599, currency_code: "usd" }
const underReview = { ...open, status: "under_review" as const }

describe("resolutionDraft", () => {
  it("taking a case under review sends the status and nothing else", () => {
    expect(resolutionDraft(open, "under_review")).toEqual({ problems: [], body: { status: "under_review" } })
  })

  it("a refund with no amount sends no award, so the backend awards the whole claim", () => {
    expect(resolutionDraft(underReview, "resolved_refund", { note: "Tracking shows no delivery." })).toEqual({
      problems: [],
      body: { status: "resolved_refund", note: "Tracking shows no delivery." },
    })
  })

  it("a refund amount is sent exactly, in minor units", () => {
    expect(resolutionDraft(open, "resolved_refund", { award: "12.50", note: "Half the order." }).body).toEqual({
      status: "resolved_refund",
      award_amount: 1250,
      note: "Half the order.",
    })
    expect(resolutionDraft(open, "resolved_refund", { award: "25.99", note: "All of it." }).body?.award_amount).toBe(
      2599
    )
  })

  it("refuses an award over the claim, as the backend does, and says by how much", () => {
    const d = resolutionDraft(open, "resolved_refund", { award: "26", note: "x" })
    expect(d.body).toBeNull()
    expect(d.problems).toEqual(["The award of $26.00 is more than the $25.99 claimed"])
  })

  it("refuses an amount it would have to guess at", () => {
    for (const bad of ["-1", "1.234", "1,000", "$5", "abc", "1e3", "5."]) {
      expect(resolutionDraft(open, "resolved_refund", { award: bad, note: "x" }).body).toBeNull()
    }
  })

  it("a release awards nothing; an amount on one means the wrong outcome was picked", () => {
    expect(resolutionDraft(open, "resolved_release", { note: "Delivered and signed for." }).body).toEqual({
      status: "resolved_release",
      note: "Delivered and signed for.",
    })
    expect(resolutionDraft(open, "resolved_release", { award: "0", note: "x" }).body).toEqual({
      status: "resolved_release",
      note: "x",
    })
    expect(resolutionDraft(open, "resolved_release", { award: "5", note: "x" }).problems).toEqual([
      "A release awards the buyer nothing. To award money, refund instead",
    ])
  })

  it("a decision that closes the case needs a decision note", () => {
    for (const to of ["resolved_refund", "resolved_release", "withdrawn"] as const) {
      const d = resolutionDraft(open, to, { note: "   " })
      expect(d.body).toBeNull()
      expect(d.problems).toContain("Write a decision note saying why")
    }
    expect(resolutionDraft(open, "withdrawn", { note: "Buyer emailed to withdraw." }).body).toEqual({
      status: "withdrawn",
      note: "Buyer emailed to withdraw.",
    })
  })

  it("offers no move the backend refuses", () => {
    expect(resolutionDraft(underReview, "under_review").body).toBeNull()
    for (const decided of ["resolved_refund", "resolved_release", "withdrawn"] as const) {
      for (const to of DISPUTE_STATUSES) {
        expect(resolutionDraft({ ...open, status: decided }, to, { note: "x" }).body).toBeNull()
      }
    }
    expect(resolutionDraft({ ...open, status: "resolved_refund" }, "withdrawn", { note: "x" }).problems).toEqual([
      "A dispute that is decided for a refund cannot be moved to withdrawn",
    ])
  })

  it("works in the currency's own minor unit", () => {
    const yen = { status: "open" as const, claim_amount: 5000, currency_code: "jpy" }
    expect(resolutionDraft(yen, "resolved_refund", { award: "3000", note: "x" }).body?.award_amount).toBe(3000)
    expect(resolutionDraft(yen, "resolved_refund", { award: "30.5", note: "x" }).body).toBeNull()
  })
})

describe("amounts", () => {
  it("parses exactly or not at all", () => {
    expect(parseAmount("15", "usd")).toBe(1500)
    expect(parseAmount(" 8.57 ", "usd")).toBe(857)
    expect(parseAmount("0.1", "usd")).toBe(10)
    expect(parseAmount("", "usd")).toBeNull()
    expect(parseAmount("1.234", "usd")).toBeNull()
  })

  it("formats dispute figures as minor units and order totals as major units", () => {
    expect(formatMinor(2599, "usd")).toBe("$25.99")
    expect(formatMinor(5000, "jpy")).toBe("¥5,000")
    // A Medusa order total of 25.99 is $25.99, not 26 cents.
    expect(formatMajor(25.99, "usd")).toBe("$25.99")
  })
})

describe("list filter", () => {
  it("defaults to the backend's queue, which takes no status", () => {
    expect(parseFilter(null)).toBe("queue")
    expect(parseFilter("nonsense")).toBe("queue")
    expect(listQuery("queue")).toBeUndefined()
  })

  it("passes one known status through", () => {
    expect(parseFilter("resolved_release")).toBe("resolved_release")
    expect(listQuery("resolved_release")).toEqual({ status: "resolved_release" })
  })
})

describe("what the buyer submitted", () => {
  it("reads the claim form's answers as the intake stores them", () => {
    expect(
      buyerSubmission({
        claim_reason: "not_received",
        contacted_seller: true,
        evidence_urls: ["https://photos.example.com/box.jpg", "http://track.example.com/1Z999"],
        intake_source: "store/order-claims",
      })
    ).toEqual({
      contactedSeller: "yes",
      evidence: ["https://photos.example.com/box.jpg", "http://track.example.com/1Z999"],
      evidenceNotShown: 0,
      source: "Storefront claim form",
    })
    expect(buyerSubmission({ contacted_seller: false, evidence_urls: [], intake_source: "backfill:request" })).toEqual({
      contactedSeller: "no",
      evidence: [],
      evidenceNotShown: 0,
      source: "Migrated from a legacy claim",
    })
  })

  it("a claim filed without the form was never asked, which is not a no", () => {
    expect(buyerSubmission({ intake_source: "store/orders/[id]/dispute" })).toEqual({
      contactedSeller: "not_asked",
      evidence: [],
      evidenceNotShown: 0,
      source: "Order dispute API",
    })
    expect(buyerSubmission(null).contactedSeller).toBe("not_asked")
  })

  it("never turns junk metadata into a link", () => {
    const s = buyerSubmission({
      contacted_seller: "yes",
      evidence_urls: [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "//evil.example.com/x",
        "not a url",
        42,
        { href: "https://x.example.com" },
        " https://ok.example.com/p?q=1 ",
      ],
      intake_source: 7,
    })
    expect(s).toEqual({
      contactedSeller: "not_asked",
      evidence: ["https://ok.example.com/p?q=1"],
      evidenceNotShown: 6,
      source: null,
    })
    for (const junk of [undefined, "string", 5, ["array"], { evidence_urls: "https://x.example.com" }]) {
      expect(buyerSubmission(junk)).toEqual({ contactedSeller: "not_asked", evidence: [], evidenceNotShown: 0, source: null })
    }
  })

  it("shows an intake source it does not know by its own name", () => {
    expect(buyerSubmission({ intake_source: "support-desk" }).source).toBe("support-desk")
  })
})

describe("event log and escrow", () => {
  const base = { id: "e", actor_id: "user_1", message: null, metadata: null, created_at: "2026-11-01T00:00:00Z" }

  it("says what happened in words", () => {
    expect(describeEvent({ ...base, kind: "opened", actor_type: "buyer", from_status: null, to_status: "open" }, "usd")).toBe(
      "Buyer opened the dispute"
    )
    expect(
      describeEvent(
        { ...base, kind: "status_changed", actor_type: "admin", from_status: "open", to_status: "under_review" },
        "usd"
      )
    ).toBe("Admin moved it from open to under review")
    expect(
      describeEvent(
        {
          ...base,
          kind: "resolved",
          actor_type: "admin",
          from_status: "under_review",
          to_status: "resolved_refund",
          metadata: { award_amount: 1250 },
        },
        "usd"
      )
    ).toBe("Admin decided: refund the buyer, awarding $12.50")
  })

  it("names an escrow transition only when the order has an escrow", () => {
    expect(escrowTransitionFor("resolved_refund", null)).toBeNull()
    expect(escrowTransitionFor("resolved_refund", "esc_1")).toBe("recover")
    expect(escrowTransitionFor("resolved_release", "esc_1")).toBe("resolve_dispute_release")
    expect(escrowTransitionFor("withdrawn", "esc_1")).toBeNull()
  })

  it("counts whole days waiting", () => {
    expect(daysWaiting("2026-11-01T00:00:00Z", new Date("2026-11-15T12:00:00Z"))).toBe(14)
    expect(daysWaiting("not a date")).toBeNull()
  })
})

/**
 * The panel's copy of the dispute vocabulary against the backend's own.
 *
 * Parsed as text rather than imported, as `storefront/src/lib/__tests__/
 * fee-schedule.spec.ts` does: the backend is a separate workspace, and
 * pulling it in would make these tests depend on it building. If a parse
 * below stops matching, update it rather than deleting it — it is what stops
 * this screen offering a move the server refuses, or hiding one it allows.
 */
describe("parity with backend/src/modules/order-dispute", () => {
  const backend = (relative: string) =>
    readFileSync(path.join(__dirname, "../../../../backend/src", relative), "utf8")
  const resolution = backend("modules/order-dispute/resolution.ts")
  const patchRoute = backend("api/admin/disputes/[id]/route.ts")

  const enumValues = (name: string): Record<string, string> => {
    const block = resolution.match(new RegExp(`export enum ${name} \\{([\\s\\S]*?)\\n\\}`))
    if (!block) throw new Error(`Could not find enum ${name} in order-dispute/resolution.ts`)

    return Object.fromEntries([...block[1].matchAll(/(\w+)\s*=\s*"([a-z_]+)"/g)].map((m) => [m[1], m[2]]))
  }

  const statusByMember = enumValues("DisputeStatus")
  const member = (m: string) => {
    const value = statusByMember[m]
    if (!value) throw new Error(`DisputeStatus.${m} is not in the enum`)

    return value
  }

  /** TRANSITIONS, as { from: [to, …] } in values. */
  const transitions: Record<string, string[]> = (() => {
    const block = resolution.match(/const TRANSITIONS[^=]*=\s*\{([\s\S]*?)\n\}/)
    if (!block) throw new Error("Could not find TRANSITIONS in order-dispute/resolution.ts")
    const out: Record<string, string[]> = {}
    for (const m of block[1].matchAll(/\[DisputeStatus\.(\w+)\]\s*:\s*\[([\s\S]*?)\]/g)) {
      out[member(m[1])] = [...m[2].matchAll(/DisputeStatus\.(\w+)/g)].map((t) => member(t[1]))
    }

    return out
  })()

  /** The statuses `canActorTransition` lets an admin move to. */
  const adminMayReach: Set<string> = (() => {
    const body = resolution.match(/export function canActorTransition[\s\S]*?\n\}/)
    if (!body) throw new Error("Could not find canActorTransition in order-dispute/resolution.ts")
    const allowed = new Set<string>()
    for (const m of body[0].matchAll(/((?:case DisputeStatus\.\w+:\s*)+)return ([^\n]+)/g)) {
      if (!m[2].includes('"admin"')) continue
      for (const c of m[1].matchAll(/DisputeStatus\.(\w+)/g)) allowed.add(member(c[1]))
    }

    return allowed
  })()

  it("parses all three", () => {
    // A silent zero-value parse would make every assertion below vacuous.
    expect(Object.keys(statusByMember).length).toBeGreaterThanOrEqual(5)
    expect(Object.keys(transitions).length).toBe(Object.keys(statusByMember).length)
    expect(adminMayReach.size).toBeGreaterThanOrEqual(3)
  })

  it("knows exactly the backend's statuses and reasons", () => {
    expect([...DISPUTE_STATUSES].sort()).toEqual(Object.values(statusByMember).sort())
    expect(Object.keys(STATUS_LABELS).sort()).toEqual(Object.values(statusByMember).sort())
    expect(Object.keys(REASON_LABELS).sort()).toEqual(Object.values(enumValues("DisputeReason")).sort())
  })

  it("offers an admin exactly the moves the backend allows an admin", () => {
    for (const from of DISPUTE_STATUSES) {
      const expected = (transitions[from] ?? []).filter((to) => adminMayReach.has(to)).sort()
      expect([...adminActionsFor(from)].sort()).toEqual(expected)
      expect([...ADMIN_TRANSITIONS[from]].sort()).toEqual(expected)
    }
  })

  /**
   * How the panel actually calls the backend. A reviewer changed the
   * mutation's method from PATCH to POST and every other test here still
   * passed; tsc cannot see it either. In production that would hit a route
   * the backend does not define, and no decision could be recorded.
   */
  it("the hooks call the paths and methods the backend routes export", () => {
    const hooks = readFileSync(path.join(__dirname, "../../hooks/api/disputes.tsx"), "utf8")
    const listRoute = backend("api/admin/disputes/route.ts")
    const exported = (src: string) =>
      new Set([...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]))

    const block = (name: string) => {
      const m = hooks.match(new RegExp(`export const ${name} = [\\s\\S]*?\\n\\}\\n`))
      if (!m) throw new Error(`Could not find ${name} in hooks/api/disputes.tsx`)

      return m[0]
    }

    // The queue: GET /admin/disputes, filtered by the `status` the route reads.
    expect(block("useDisputes")).toMatch(/fetch<\w+>\("\/admin\/disputes",\s*\{\s*query: params/)
    expect(block("useDisputes")).not.toMatch(/method:/)
    expect(exported(listRoute)).toContain("GET")
    expect(listRoute).toMatch(/req\.query\.status/)

    // The case file: GET /admin/disputes/:id.
    expect(block("useDispute")).toMatch(/fetch<\w+>\(`\/admin\/disputes\/\$\{encodeURIComponent\(id\)\}`\)/)
    expect(exported(patchRoute)).toContain("GET")

    // A decision: the mutation's method must be one the [id] route exports.
    const mutation = block("useUpdateDispute")
    expect(mutation).toMatch(/fetch<\w+>\(`\/admin\/disputes\/\$\{encodeURIComponent\(id\)\}`/)
    const method = mutation.match(/method: "(\w+)"/)?.[1]
    expect(method).toBe("PATCH")
    expect(exported(patchRoute)).toContain(method)
  })

  /**
   * The server refuses a closing decision without a note (400
   * `note_required`); the panel explains that before sending. If the two
   * lists drift, the panel either sends a decision the server refuses or
   * stops asking for a reason the buyer and the seller then see missing.
   */
  it("asks for a note on exactly the decisions the backend refuses without one", () => {
    const block = resolution.match(/export const DECISIONS_NEEDING_A_NOTE[^=]*=\s*\[([\s\S]*?)\]/)
    if (!block) throw new Error("Could not find DECISIONS_NEEDING_A_NOTE in order-dispute/resolution.ts")
    const needNote = [...block[1].matchAll(/DisputeStatus\.(\w+)/g)].map((m) => member(m[1])).sort()
    expect(needNote.length).toBeGreaterThanOrEqual(3)
    expect(patchRoute).toMatch(/decisionNoteMissing\(status, body\.note\)/)

    const panelNeedsNote = DISPUTE_STATUSES.filter((to) =>
      resolutionDraft(open, to, { note: "" }).problems.includes("Write a decision note saying why")
    ).sort()
    expect(panelNeedsNote).toEqual(needNote)
  })

  it("offers only statuses the PATCH route handles", () => {
    const handled = new Set(
      [...patchRoute.matchAll(/status === DisputeStatus\.(\w+)/g)].map((m) => member(m[1]))
    )
    expect(handled.size).toBeGreaterThanOrEqual(4)
    for (const from of DISPUTE_STATUSES) {
      for (const to of adminActionsFor(from)) expect(handled).toContain(to)
    }
  })
})

/**
 * The defect this screen closes was that no route or menu entry reached the
 * disputes API. These read the wiring as text (the route map pulls in the
 * whole app, which this test runner cannot render) so that removing either
 * entry fails here rather than leaving the queue unreachable again.
 */
describe("wiring", () => {
  const src = (relative: string) => readFileSync(path.join(__dirname, "../..", relative), "utf8")

  it("registers the list and detail routes", () => {
    const routes = src("dashboard-app/routes/get-route.map.tsx")
    const block = routes.match(/path: "\/disputes",[\s\S]*?\n {12}\},/)
    expect(block).not.toBeNull()
    expect(block![0]).toContain('import("@routes/disputes/dispute-list")')
    expect(block![0]).toMatch(/path: ":id",\s*lazy: \(\) => import\("@routes\/disputes\/dispute-detail"\)/)
  })

  it("puts Disputes in the main menu", () => {
    expect(src("components/layout/main-layout/main-layout.tsx")).toMatch(/label: "Disputes",\s*to: "\/disputes"/)
  })

  it("each route module exports the Component the router loads", () => {
    expect(src("routes/disputes/dispute-list/index.ts")).toMatch(/as Component\b/)
    expect(src("routes/disputes/dispute-detail/index.ts")).toMatch(/as Component\b/)
  })
})

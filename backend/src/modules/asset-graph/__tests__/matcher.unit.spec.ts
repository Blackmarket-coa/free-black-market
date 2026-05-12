/**
 * Matcher engine tests.
 *
 * Four manifest match-shapes the v0 engine must handle, exercised
 * with fixture declaration pools shaped like real intake:
 *
 *   - Nursery: concrete-leaf slugs + numeric attribute constraints
 *     (`acreage_min`, `hours_per_week_min`). Tests prove constraints
 *     fail the right declarations, that the optional
 *     `skill.installation` slot doesn't block satisfaction, and that
 *     cross-member assembly works (operator's land + N household
 *     contributors).
 *
 *   - Tool library: hierarchical wildcards on `tool.*` and a
 *     lifecycle filter (`exhaustible-borrow-return`). Tests prove
 *     the wildcard expands to multiple subkinds, the lifecycle filter
 *     rejects mismatches, and the proposal lists every contributing
 *     declaration.
 *
 *   - Repair café: skill-vs-artifact-category routing and a
 *     `perishable`-lifecycle event-shift slot. The event-loop
 *     scheduling primitive is out of scope; the test confirms slot-
 *     level matching works correctly and the proposal completion flag
 *     turns on only when every required slot has ≥ min_count
 *     candidates.
 *
 *   - Childcare co-op: multiple-count slots (≥3 caregivers + ≥3
 *     background checks), boolean attribute constraint
 *     (`childproofed: true`), and a credential-typed declaration
 *     that the matcher treats like any other concrete leaf — VC
 *     payload validation happens at attestation-write time, not
 *     in the matcher.
 *
 * Also covers the constraint vocabulary directly
 * (<key>_min / <key>_max / exact) and the proposalsFromReport
 * builder's behavior when there is and isn't a candidate operator.
 */

import {
  evaluateConstraints,
  matchSlot,
  matchManifest,
  proposalsFromReport,
  OPERATOR_LIKE_ROLES,
  type MatcherDeclaration,
} from "../matcher"
import { YARD_SCRAP_NURSERY_MANIFEST as NURSERY } from "../manifests/yard-scrap-nursery"
import { TOOL_LIBRARY_MANIFEST as TOOLS } from "../manifests/tool-library"
import { REPAIR_CAFE_MANIFEST as REPAIR } from "../manifests/repair-cafe"
import { CHILDCARE_MANIFEST as CHILDCARE } from "../manifests/childcare"
import { CREATOR_BOUNTY_MANIFEST as BOUNTY } from "../manifests/creator-bounty"
import { COURIER_COLLECTIVE_MANIFEST as COURIER } from "../manifests/courier-collective"

const decl = (overrides: Partial<MatcherDeclaration> = {}): MatcherDeclaration => ({
  id: overrides.id ?? "decl_x",
  member_id: overrides.member_id ?? "mem_x",
  kind_slug: overrides.kind_slug ?? "land.yard.residential",
  attributes: overrides.attributes ?? {},
  sensitivity_tier: overrides.sensitivity_tier,
  lifecycle: overrides.lifecycle,
  revoked_at: overrides.revoked_at ?? null,
})

describe("evaluateConstraints", () => {
  it("returns true when constraints are undefined or empty", () => {
    expect(evaluateConstraints(undefined, { x: 1 })).toBe(true)
    expect(evaluateConstraints({}, { x: 1 })).toBe(true)
  })

  it("passes <key>_min when attribute >= value", () => {
    expect(evaluateConstraints({ acreage_min: 0.25 }, { acreage: 0.25 })).toBe(true)
    expect(evaluateConstraints({ acreage_min: 0.25 }, { acreage: 0.30 })).toBe(true)
  })

  it("fails <key>_min when attribute < value", () => {
    expect(evaluateConstraints({ acreage_min: 0.25 }, { acreage: 0.20 })).toBe(false)
  })

  it("passes <key>_max when attribute <= value", () => {
    expect(evaluateConstraints({ acreage_max: 1.0 }, { acreage: 1.0 })).toBe(true)
    expect(evaluateConstraints({ acreage_max: 1.0 }, { acreage: 0.5 })).toBe(true)
  })

  it("fails <key>_max when attribute > value", () => {
    expect(evaluateConstraints({ acreage_max: 1.0 }, { acreage: 1.5 })).toBe(false)
  })

  it("exact-matches non-suffixed keys", () => {
    expect(evaluateConstraints({ accessible: true }, { accessible: true })).toBe(true)
    expect(evaluateConstraints({ accessible: true }, { accessible: false })).toBe(false)
  })

  it("fails when the attribute is missing or wrong type for a numeric constraint", () => {
    expect(evaluateConstraints({ acreage_min: 0.25 }, {})).toBe(false)
    expect(evaluateConstraints({ acreage_min: 0.25 }, { acreage: "0.5" })).toBe(false)
  })
})

describe("matchSlot — kind_slug + lifecycle + constraints", () => {
  it("matches an exact leaf slug", () => {
    const slot = NURSERY.required_asset_kinds.find(
      (s) => s.kind_slug === "skill.horticulture"
    )!
    const pool = [
      decl({ id: "d1", kind_slug: "skill.horticulture" }),
      decl({ id: "d2", kind_slug: "skill.installation" }),
    ]
    const report = matchSlot(slot, pool)
    expect(report.candidates.map((c) => c.declaration_id)).toEqual(["d1"])
    expect(report.satisfied).toBe(true)
  })

  it("expands a wildcard to multiple subkinds", () => {
    const slot = TOOLS.required_asset_kinds.find((s) => s.kind_slug === "tool.*")!
    const pool = [
      decl({
        id: "d1",
        kind_slug: "tool.power-tool",
        lifecycle: "exhaustible-borrow-return",
      }),
      decl({
        id: "d2",
        kind_slug: "tool.garden.tiller",
        lifecycle: "exhaustible-borrow-return",
      }),
      decl({ id: "d3", kind_slug: "skill.horticulture" }),
    ]
    const report = matchSlot(slot, pool)
    expect(report.candidates.map((c) => c.declaration_id).sort()).toEqual([
      "d1",
      "d2",
    ])
  })

  it("filters by lifecycle when the slot specifies one", () => {
    const slot = TOOLS.required_asset_kinds.find((s) => s.kind_slug === "tool.*")!
    const pool = [
      decl({
        id: "d1",
        kind_slug: "tool.power-tool",
        lifecycle: "exhaustible-borrow-return",
      }),
      // Wrong lifecycle — should be rejected.
      decl({
        id: "d2",
        kind_slug: "tool.power-tool",
        lifecycle: "durable-commitment",
      }),
    ]
    const report = matchSlot(slot, pool)
    expect(report.candidates.map((c) => c.declaration_id)).toEqual(["d1"])
  })

  it("filters by attribute constraints", () => {
    const slot = NURSERY.required_asset_kinds.find(
      (s) => s.kind_slug === "land.yard.residential"
    )!
    const pool = [
      decl({
        id: "d1",
        kind_slug: "land.yard.residential",
        attributes: { acreage: 0.30 },
        lifecycle: "durable-commitment",
      }),
      // Too small — fails acreage_min: 0.25.
      decl({
        id: "d2",
        kind_slug: "land.yard.residential",
        attributes: { acreage: 0.10 },
        lifecycle: "durable-commitment",
      }),
    ]
    const report = matchSlot(slot, pool)
    expect(report.candidates.map((c) => c.declaration_id)).toEqual(["d1"])
  })

  it("skips revoked declarations", () => {
    const slot = NURSERY.required_asset_kinds.find(
      (s) => s.kind_slug === "skill.horticulture"
    )!
    const pool = [
      decl({ id: "d1", kind_slug: "skill.horticulture" }),
      decl({
        id: "d2",
        kind_slug: "skill.horticulture",
        revoked_at: new Date(),
      }),
    ]
    const report = matchSlot(slot, pool)
    expect(report.candidates.map((c) => c.declaration_id)).toEqual(["d1"])
  })

  it("treats an optional slot with zero candidates as satisfied", () => {
    const slot = NURSERY.required_asset_kinds.find(
      (s) => s.kind_slug === "skill.installation"
    )!
    expect(slot.optional).toBe(true)
    const report = matchSlot(slot, [])
    expect(report.candidates).toEqual([])
    expect(report.satisfied).toBe(true)
  })

  it("treats a required slot with zero candidates as unsatisfied", () => {
    const slot = NURSERY.required_asset_kinds.find(
      (s) => s.kind_slug === "skill.horticulture"
    )!
    expect(slot.optional).toBe(false)
    const report = matchSlot(slot, [])
    expect(report.satisfied).toBe(false)
  })
})

describe("matchManifest — nursery (concrete + constraints + cross-member assembly)", () => {
  const operatorMember = "mem_operator"
  const householdA = "mem_household_a"
  const householdB = "mem_household_b"

  const pool = (): MatcherDeclaration[] => [
    // Operator brings land, horticulture skill, truck, recurring time, compost/vermicast/plug output capacity.
    decl({
      id: "d_land",
      member_id: operatorMember,
      kind_slug: "land.yard.residential",
      attributes: { acreage: 0.30, soil_tested: true },
      lifecycle: "durable-commitment",
    }),
    decl({
      id: "d_skill",
      member_id: operatorMember,
      kind_slug: "skill.horticulture",
      attributes: { years_experience: 5 },
    }),
    decl({
      id: "d_truck",
      member_id: operatorMember,
      kind_slug: "tool.vehicle.truck",
      attributes: { has_hitch: true },
    }),
    decl({
      id: "d_time",
      member_id: operatorMember,
      kind_slug: "time.recurring",
      attributes: { hours_per_week: 25 },
      lifecycle: "recurring",
    }),
    decl({
      id: "d_compost",
      member_id: operatorMember,
      kind_slug: "output-capacity.compost",
      attributes: { cubic_yards_per_month: 5 },
      lifecycle: "recurring",
    }),
    decl({
      id: "d_vermicast",
      member_id: operatorMember,
      kind_slug: "output-capacity.vermicast",
      attributes: { lbs_per_month: 20 },
      lifecycle: "recurring",
    }),
    decl({
      id: "d_plug",
      member_id: operatorMember,
      kind_slug: "output-capacity.plant-plug",
      attributes: { plugs_per_month: 200 },
      lifecycle: "recurring",
    }),
    // Two households contributing yard-scrap.
    decl({
      id: "d_scrap_a",
      member_id: householdA,
      kind_slug: "output-capacity.yard-scrap",
      attributes: { cubic_yards_per_month: 0.5 },
      lifecycle: "recurring",
    }),
    decl({
      id: "d_scrap_b",
      member_id: householdB,
      kind_slug: "output-capacity.yard-scrap",
      attributes: { cubic_yards_per_month: 0.3 },
      lifecycle: "recurring",
    }),
  ]

  it("satisfies every required slot when the operator + households cover the roles", () => {
    const report = matchManifest(NURSERY, pool())
    expect(report.satisfied).toBe(true)
    for (const sr of report.slot_reports) {
      expect(sr.satisfied).toBe(true)
    }
  })

  it("identifies the operator as a candidate operator (has host + operator-role decls)", () => {
    const report = matchManifest(NURSERY, pool())
    const opIds = report.candidate_operators.map((o) => o.member_id)
    expect(opIds).toContain(operatorMember)
  })

  it("does not pick households as candidate operators (they only fill the contributor role)", () => {
    const report = matchManifest(NURSERY, pool())
    const opIds = report.candidate_operators.map((o) => o.member_id)
    expect(opIds).not.toContain(householdA)
    expect(opIds).not.toContain(householdB)
  })

  it("collects every operator declaration on their candidate-operator row, not just the operator-role ones", () => {
    const report = matchManifest(NURSERY, pool())
    const op = report.candidate_operators.find(
      (o) => o.member_id === operatorMember
    )!
    expect(op.own_declaration_ids).toEqual(
      expect.arrayContaining([
        "d_land",
        "d_skill",
        "d_truck",
        "d_time",
        "d_compost",
        "d_vermicast",
        "d_plug",
      ])
    )
  })

  it("becomes unsatisfied when the operator's land fails the acreage constraint", () => {
    const p = pool()
    // Find and shrink the operator's land below acreage_min.
    p.find((d) => d.id === "d_land")!.attributes = { acreage: 0.10 }
    const report = matchManifest(NURSERY, p)
    expect(report.satisfied).toBe(false)
    const landReport = report.slot_reports.find(
      (s) => s.slot.kind_slug === "land.yard.residential"
    )!
    expect(landReport.satisfied).toBe(false)
  })

  it("remains satisfied when the optional skill.installation slot has no candidates", () => {
    // Pool above has no skill.installation declaration; manifest treats it as optional.
    const report = matchManifest(NURSERY, pool())
    const installReport = report.slot_reports.find(
      (s) => s.slot.kind_slug === "skill.installation"
    )!
    expect(installReport.candidates).toEqual([])
    expect(installReport.satisfied).toBe(true)
    expect(report.satisfied).toBe(true)
  })
})

describe("matchManifest — tool library (wildcard + lifecycle + trust-score sensitivity)", () => {
  const librarianMember = "mem_librarian"
  const lenderA = "mem_lender_a"
  const lenderB = "mem_lender_b"
  const borrowerMember = "mem_borrower"

  const pool = (): MatcherDeclaration[] => [
    decl({
      id: "d_tool_drill",
      member_id: lenderA,
      kind_slug: "tool.power-tool",
      attributes: { corded: true, voltage: 120 },
      lifecycle: "exhaustible-borrow-return",
    }),
    decl({
      id: "d_tool_tiller",
      member_id: lenderB,
      kind_slug: "tool.garden.tiller",
      attributes: {},
      lifecycle: "exhaustible-borrow-return",
    }),
    decl({
      id: "d_librarian_time",
      member_id: librarianMember,
      kind_slug: "time.coordinator",
      attributes: { hours_per_week: 4, response_sla_hours: 24 },
      lifecycle: "recurring",
    }),
    decl({
      id: "d_trust",
      member_id: borrowerMember,
      kind_slug: "credential.trust-score",
      attributes: { score: 80, loans_completed: 12 },
      sensitivity_tier: "match-only",
      lifecycle: "durable-commitment",
    }),
  ]

  it("satisfies the tool.* wildcard slot with two tool subkinds across two members", () => {
    const report = matchManifest(TOOLS, pool())
    const toolSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "tool.*"
    )!
    expect(toolSlot.candidates.map((c) => c.declaration_id).sort()).toEqual([
      "d_tool_drill",
      "d_tool_tiller",
    ])
    expect(toolSlot.satisfied).toBe(true)
  })

  it("picks the librarian as a candidate operator (coordinator role is operator-like)", () => {
    const report = matchManifest(TOOLS, pool())
    const opIds = report.candidate_operators.map((o) => o.member_id)
    expect(opIds).toContain(librarianMember)
  })

  it("rejects a wrong-lifecycle tool declaration (durable-commitment ≠ exhaustible-borrow-return)", () => {
    const p = pool()
    p.push(
      decl({
        id: "d_tool_static",
        member_id: lenderA,
        kind_slug: "tool.vehicle.truck",
        attributes: {},
        lifecycle: "durable-commitment",
      })
    )
    const report = matchManifest(TOOLS, p)
    const toolSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "tool.*"
    )!
    // d_tool_static lives in pool but is filtered by lifecycle.
    expect(toolSlot.candidates.map((c) => c.declaration_id)).not.toContain(
      "d_tool_static"
    )
  })

  it("manifest is satisfied with one tool, one librarian, one trust score", () => {
    const report = matchManifest(TOOLS, pool())
    expect(report.satisfied).toBe(true)
  })
})

describe("matchManifest — repair café (skill wildcard + perishable event-shift + client role)", () => {
  const fixer = "mem_fixer"
  const coordinator = "mem_coord"
  const venueHost = "mem_venue"
  const customer = "mem_customer"

  const pool = (): MatcherDeclaration[] => [
    decl({
      id: "d_skill",
      member_id: fixer,
      kind_slug: "skill.repair.electronics",
      attributes: { soldering: true, smd_capable: false },
      lifecycle: "durable-commitment",
    }),
    decl({
      id: "d_shift",
      member_id: fixer,
      kind_slug: "time.event-shift",
      attributes: { hours: 3, event_date: "2026-06-13" },
      lifecycle: "perishable",
    }),
    decl({
      id: "d_venue",
      member_id: venueHost,
      kind_slug: "space.event-venue",
      attributes: { capacity: 40, accessible: true, recurrence: "monthly-saturday" },
      lifecycle: "durable-commitment",
    }),
    decl({
      id: "d_coord",
      member_id: coordinator,
      kind_slug: "time.coordinator",
      attributes: { hours_per_week: 3 },
      lifecycle: "recurring",
    }),
    decl({
      id: "d_broken",
      member_id: customer,
      kind_slug: "artifact.broken-item",
      attributes: {
        category: "electronics",
        symptom: "no power",
        not_water_damaged: true,
      },
      lifecycle: "one-time",
    }),
  ]

  it("satisfies every required slot when fixer + venue + coordinator + customer all show up", () => {
    const report = matchManifest(REPAIR, pool())
    expect(report.satisfied).toBe(true)
  })

  it("matches the skill.repair.* wildcard against the electronics leaf", () => {
    const report = matchManifest(REPAIR, pool())
    const skillSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "skill.repair.*"
    )!
    expect(skillSlot.candidates.map((c) => c.declaration_id)).toEqual(["d_skill"])
  })

  it("matches event-shift only when lifecycle is perishable", () => {
    const p = pool()
    p.find((d) => d.id === "d_shift")!.lifecycle = "recurring" // wrong lifecycle
    const report = matchManifest(REPAIR, p)
    const shiftSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "time.event-shift"
    )!
    expect(shiftSlot.satisfied).toBe(false)
    expect(report.satisfied).toBe(false)
  })

  it("rejects venue without accessible=true (constraint failure)", () => {
    const p = pool()
    p.find((d) => d.id === "d_venue")!.attributes = {
      capacity: 40,
      accessible: false,
      recurrence: "monthly-saturday",
    }
    const report = matchManifest(REPAIR, p)
    const venueSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "space.event-venue"
    )!
    expect(venueSlot.satisfied).toBe(false)
  })

  it("picks venue host and coordinator as candidate operators; fixer and customer are participants, not operators", () => {
    // The fixer's role in the manifest is `fixer`, which is intentionally
    // NOT in OPERATOR_LIKE_ROLES — fixers are participants who join an
    // already-running repair café, they don't deploy it. The deploying
    // anchors are the venue host (offering recurring space) and the
    // coordinator (running intake). Customers are pure clients.
    const report = matchManifest(REPAIR, pool())
    const opIds = report.candidate_operators.map((o) => o.member_id).sort()
    expect(opIds).toEqual([coordinator, venueHost].sort())
    expect(opIds).not.toContain(fixer)
    expect(opIds).not.toContain(customer)
  })
})

describe("matchManifest — childcare co-op (multi-count slots + boolean constraint + credentials)", () => {
  const coordinator = "mem_coord"
  const host = "mem_host"
  const caregiverA = "mem_care_a"
  const caregiverB = "mem_care_b"
  const caregiverC = "mem_care_c"

  const pool = (): MatcherDeclaration[] => [
    // Coordinator (deploys + schedules)
    decl({
      id: "d_coord",
      member_id: coordinator,
      kind_slug: "time.coordinator",
      attributes: { hours_per_week: 5 },
      lifecycle: "recurring",
    }),
    // Host home — childproofed (the manifest's boolean constraint)
    decl({
      id: "d_home",
      member_id: host,
      kind_slug: "space.home",
      attributes: { capacity: 4, childproofed: true, accessible: true },
      lifecycle: "durable-commitment",
    }),
    // Three caregivers — each contributes skill + recurring time + background check
    ...[
      [caregiverA, "d_skill_a", "d_time_a", "d_bg_a"],
      [caregiverB, "d_skill_b", "d_time_b", "d_bg_b"],
      [caregiverC, "d_skill_c", "d_time_c", "d_bg_c"],
    ].flatMap(([member, dSkill, dTime, dBg]) => [
      decl({
        id: dSkill,
        member_id: member,
        kind_slug: "skill.childcare",
        attributes: {
          years_experience: 4,
          ages_comfortable_with: ["toddler", "preschool"],
        },
        lifecycle: "durable-commitment",
      }),
      decl({
        id: dTime,
        member_id: member,
        kind_slug: "time.recurring",
        attributes: { hours_per_week: 5 },
        lifecycle: "recurring",
      }),
      decl({
        id: dBg,
        member_id: member,
        kind_slug: "credential.background-check",
        attributes: { cleared: true, scope: ["childcare"] },
        sensitivity_tier: "match-only",
        lifecycle: "durable-commitment",
      }),
    ]),
    // One CPR-certified caregiver
    decl({
      id: "d_cpr",
      member_id: caregiverA,
      kind_slug: "credential.cpr-certified",
      attributes: { levels: ["child", "infant"] },
      sensitivity_tier: "match-only",
      lifecycle: "durable-commitment",
    }),
  ]

  it("satisfies every required slot when 3 caregivers + 1 CPR cert + 3 background checks + host + coordinator are present", () => {
    const report = matchManifest(CHILDCARE, pool())
    expect(report.satisfied).toBe(true)
    for (const sr of report.slot_reports) {
      expect(sr.satisfied).toBe(true)
    }
  })

  it("counts multiple declarations against min_count=3 slots", () => {
    const report = matchManifest(CHILDCARE, pool())
    const skillSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "skill.childcare"
    )!
    expect(skillSlot.candidates.map((c) => c.declaration_id).sort()).toEqual([
      "d_skill_a",
      "d_skill_b",
      "d_skill_c",
    ])
    const bgSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "credential.background-check"
    )!
    expect(bgSlot.candidates).toHaveLength(3)
  })

  it("rejects the host's home when childproofed=false (boolean constraint)", () => {
    const p = pool()
    p.find((d) => d.id === "d_home")!.attributes = {
      capacity: 4,
      childproofed: false,
      accessible: true,
    }
    const report = matchManifest(CHILDCARE, p)
    const homeSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "space.home"
    )!
    expect(homeSlot.satisfied).toBe(false)
    expect(report.satisfied).toBe(false)
  })

  it("becomes unsatisfied when fewer than 3 caregivers contribute background checks", () => {
    const p = pool().filter((d) => d.id !== "d_bg_c")
    const report = matchManifest(CHILDCARE, p)
    const bgSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "credential.background-check"
    )!
    expect(bgSlot.candidates).toHaveLength(2)
    expect(bgSlot.satisfied).toBe(false)
    expect(report.satisfied).toBe(false)
  })

  it("becomes unsatisfied when no caregiver carries the CPR credential", () => {
    const p = pool().filter((d) => d.id !== "d_cpr")
    const report = matchManifest(CHILDCARE, p)
    const cprSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "credential.cpr-certified"
    )!
    expect(cprSlot.satisfied).toBe(false)
    expect(report.satisfied).toBe(false)
  })

  it("treats skill.peer-support as optional — manifest stays satisfied when absent", () => {
    const report = matchManifest(CHILDCARE, pool())
    const peerSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "skill.peer-support"
    )!
    expect(peerSlot.candidates).toEqual([])
    expect(peerSlot.satisfied).toBe(true)
    expect(report.satisfied).toBe(true)
  })

  it("picks coordinator + host as candidate operators; caregivers are participants", () => {
    const report = matchManifest(CHILDCARE, pool())
    const opIds = report.candidate_operators.map((o) => o.member_id).sort()
    expect(opIds).toContain(coordinator)
    expect(opIds).toContain(host)
    expect(opIds).not.toContain(caregiverA)
    expect(opIds).not.toContain(caregiverB)
    expect(opIds).not.toContain(caregiverC)
  })
})

describe("matchManifest — creator bounty (vote-weighted + capital + one-time creative work)", () => {
  const creator = "mem_creator"
  const curator = "mem_curator"
  const supporterA = "mem_sup_a"
  const supporterB = "mem_sup_b"
  const supporterC = "mem_sup_c"

  const pool = (): MatcherDeclaration[] => [
    decl({
      id: "d_skill",
      member_id: creator,
      kind_slug: "skill.creative.writing",
      attributes: { portfolio_url: "https://example.com/portfolio" },
      lifecycle: "durable-commitment",
    }),
    decl({
      id: "d_work",
      member_id: creator,
      kind_slug: "output-capacity.creative-work",
      attributes: {
        description: "A six-story chapbook",
        format: "digital-pdf",
      },
      lifecycle: "one-time",
    }),
    decl({
      id: "d_pledge_a",
      member_id: supporterA,
      kind_slug: "capital.bounty-contribution",
      attributes: { amount_minor: 5_000, currency_code: "USDC" },
      lifecycle: "one-time",
    }),
    decl({
      id: "d_pledge_b",
      member_id: supporterB,
      kind_slug: "capital.bounty-contribution",
      attributes: { amount_minor: 2_500, currency_code: "USDC" },
      lifecycle: "one-time",
    }),
    decl({
      id: "d_pledge_c",
      member_id: supporterC,
      kind_slug: "capital.bounty-contribution",
      attributes: { amount_minor: 1_000, currency_code: "USDC" },
      lifecycle: "one-time",
    }),
    decl({
      id: "d_curator",
      member_id: curator,
      kind_slug: "time.coordinator",
      attributes: { hours_per_week: 3 },
      lifecycle: "recurring",
    }),
  ]

  it("satisfies every required slot with creator + 3 pledges + curator + work commitment", () => {
    const report = matchManifest(BOUNTY, pool())
    expect(report.satisfied).toBe(true)
    for (const sr of report.slot_reports) {
      expect(sr.satisfied).toBe(true)
    }
  })

  it("matches the skill.creative.* wildcard against the writing leaf (third distinct wildcard root)", () => {
    const report = matchManifest(BOUNTY, pool())
    const skillSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "skill.creative.*"
    )!
    expect(skillSlot.candidates.map((c) => c.declaration_id)).toEqual(["d_skill"])
  })

  it("becomes unsatisfied when fewer than three supporters pledge (min_count: 3)", () => {
    const p = pool().filter((d) => d.id !== "d_pledge_c")
    const report = matchManifest(BOUNTY, p)
    const pledgeSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "capital.bounty-contribution"
    )!
    expect(pledgeSlot.candidates).toHaveLength(2)
    expect(pledgeSlot.satisfied).toBe(false)
    expect(report.satisfied).toBe(false)
  })

  it("the creator-verification credential is optional — manifest satisfied without it", () => {
    const report = matchManifest(BOUNTY, pool())
    const credSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "credential.creator-verification"
    )!
    expect(credSlot.candidates).toEqual([])
    expect(credSlot.satisfied).toBe(true)
    expect(report.satisfied).toBe(true)
  })

  it("picks creator + curator as candidate operators; supporters are participants", () => {
    const report = matchManifest(BOUNTY, pool())
    const opIds = report.candidate_operators.map((o) => o.member_id).sort()
    expect(opIds).toContain(creator) // role: operator
    expect(opIds).toContain(curator) // role: coordinator
    expect(opIds).not.toContain(supporterA) // role: contributor
    expect(opIds).not.toContain(supporterB)
    expect(opIds).not.toContain(supporterC)
  })

  it("enforces the recurring-lifecycle filter on time.coordinator", () => {
    const p = pool()
    p.find((d) => d.id === "d_curator")!.lifecycle = "one-time" // wrong lifecycle
    const report = matchManifest(BOUNTY, p)
    const curatorSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "time.coordinator"
    )!
    expect(curatorSlot.satisfied).toBe(false)
  })
})

describe("matchManifest — courier collective (depth-2 wildcard + driver's license + multi-count couriers)", () => {
  const dispatcher = "mem_dispatch"
  const courierA = "mem_courier_a"
  const courierB = "mem_courier_b"

  const pool = (): MatcherDeclaration[] => [
    // Dispatcher
    decl({
      id: "d_dispatch",
      member_id: dispatcher,
      kind_slug: "time.coordinator",
      attributes: { hours_per_week: 15 },
      lifecycle: "recurring",
    }),
    // Courier A — bicycle + driving skill + license + shift
    ...[
      [courierA, "d_skill_a", "d_lic_a", "d_veh_a", "d_time_a", "tool.vehicle.bicycle"],
      [courierB, "d_skill_b", "d_lic_b", "d_veh_b", "d_time_b", "tool.vehicle.cargo-bike"],
    ].flatMap(
      ([m, dSkill, dLic, dVeh, dTime, vehicleKind]) =>
        [
          decl({
            id: dSkill,
            member_id: m,
            kind_slug: "skill.driving",
            attributes: {
              years_experience: 3,
              vehicle_classes: ["bicycle", "cargo-bike"],
            },
            lifecycle: "durable-commitment",
          }),
          decl({
            id: dLic,
            member_id: m,
            kind_slug: "credential.drivers-license",
            attributes: {
              class: "C",
              jurisdiction: "US-NY",
              valid_until: "2030-01-01T00:00:00Z",
            },
            sensitivity_tier: "match-only",
            lifecycle: "durable-commitment",
          }),
          decl({
            id: dVeh,
            member_id: m,
            kind_slug: vehicleKind,
            attributes:
              vehicleKind === "tool.vehicle.cargo-bike"
                ? { payload_lbs: 200, cargo_volume_l: 100, ebike: true }
                : { ebike: false, gear_count: 21 },
            lifecycle: "durable-commitment",
          }),
          decl({
            id: dTime,
            member_id: m,
            kind_slug: "time.recurring",
            attributes: { hours_per_week: 10 },
            lifecycle: "recurring",
          }),
        ] as MatcherDeclaration[]
    ),
  ]

  it("satisfies every slot with dispatcher + 2 couriers each carrying skill + license + vehicle + time", () => {
    const report = matchManifest(COURIER, pool())
    expect(report.satisfied).toBe(true)
    for (const sr of report.slot_reports) {
      expect(sr.satisfied).toBe(true)
    }
  })

  it("matches the depth-2 wildcard tool.vehicle.* against bicycle + cargo-bike leaves", () => {
    const report = matchManifest(COURIER, pool())
    const vehSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "tool.vehicle.*"
    )!
    const matched = vehSlot.candidates.map((c) => c.declaration_id).sort()
    expect(matched).toEqual(["d_veh_a", "d_veh_b"])
  })

  it("depth-2 wildcard matches a truck declaration too (parent tool.vehicle and all subkinds)", () => {
    const p = pool()
    p.push(
      decl({
        id: "d_truck",
        member_id: courierA,
        kind_slug: "tool.vehicle.truck",
        attributes: { bed_length_ft: 6, payload_lbs: 1500 },
        lifecycle: "durable-commitment",
      })
    )
    const report = matchManifest(COURIER, p)
    const vehSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "tool.vehicle.*"
    )!
    expect(vehSlot.candidates.map((c) => c.declaration_id)).toContain("d_truck")
  })

  it("becomes unsatisfied with only one courier (min_count: 2)", () => {
    const p = pool().filter(
      (d) => !["d_skill_b", "d_lic_b", "d_veh_b", "d_time_b"].includes(d.id)
    )
    const report = matchManifest(COURIER, p)
    expect(report.satisfied).toBe(false)
  })

  it("dispatcher hours_per_week_min: 10 is enforced", () => {
    const p = pool()
    p.find((d) => d.id === "d_dispatch")!.attributes = { hours_per_week: 5 }
    const report = matchManifest(COURIER, p)
    const dispatchSlot = report.slot_reports.find(
      (s) => s.slot.kind_slug === "time.coordinator"
    )!
    expect(dispatchSlot.satisfied).toBe(false)
  })

  it("dispatcher is candidate operator; couriers are participants (operator role is not OPERATOR_LIKE for skill.driving slot)", () => {
    // Wait — actually `skill.driving` has role `operator` in the
    // manifest, and `operator` IS in OPERATOR_LIKE_ROLES. So couriers
    // ARE candidate operators here, along with the dispatcher
    // (coordinator role).
    const report = matchManifest(COURIER, pool())
    const opIds = report.candidate_operators.map((o) => o.member_id).sort()
    expect(opIds).toContain(dispatcher)
    // Each courier qualifies as a candidate operator because their
    // skill.driving + time.recurring declarations satisfy operator-
    // role slots.
    expect(opIds).toContain(courierA)
    expect(opIds).toContain(courierB)
  })
})

describe("proposalsFromReport", () => {
  it("returns one proposal per candidate operator", () => {
    const report = matchManifest(NURSERY, [
      decl({
        id: "d_land",
        member_id: "mem_op",
        kind_slug: "land.yard.residential",
        attributes: { acreage: 0.30 },
        lifecycle: "durable-commitment",
      }),
      decl({
        id: "d_skill",
        member_id: "mem_op",
        kind_slug: "skill.horticulture",
        attributes: { years_experience: 5 },
      }),
    ])
    const proposals = proposalsFromReport(report, new Date("2026-05-13"))
    expect(proposals).toHaveLength(1)
    expect(proposals[0].member_id).toBe("mem_op")
    expect(proposals[0].manifest_slug).toBe("yard-scrap-nursery")
    expect(proposals[0].state).toBe("pending")
    expect(proposals[0].score).toBe(0) // incomplete — missing many slots
  })

  it("scores complete reports as 1 and incomplete as 0", () => {
    const incompleteReport = matchManifest(NURSERY, [])
    const incompleteProposals = proposalsFromReport(incompleteReport)
    // With no decls there are no candidate operators either, so proposals is empty.
    expect(incompleteProposals).toEqual([])

    const partial = matchManifest(NURSERY, [
      decl({
        id: "d_land",
        member_id: "mem_op",
        kind_slug: "land.yard.residential",
        attributes: { acreage: 0.30 },
        lifecycle: "durable-commitment",
      }),
    ])
    const partialProposals = proposalsFromReport(partial)
    expect(partialProposals).toHaveLength(1)
    expect(partialProposals[0].score).toBe(0)
  })

  it("returns an empty proposal set when no member has an operator-like role declaration", () => {
    // Only a contributor declaration — no host / operator / coordinator.
    const report = matchManifest(NURSERY, [
      decl({
        id: "d_scrap",
        member_id: "mem_household",
        kind_slug: "output-capacity.yard-scrap",
        attributes: { cubic_yards_per_month: 0.5 },
        lifecycle: "recurring",
      }),
    ])
    expect(proposalsFromReport(report)).toEqual([])
  })
})

describe("operator-like role set", () => {
  it("includes the v0 manifest operator anchors (operator, host, coordinator, librarian, operator-or-shared)", () => {
    expect(OPERATOR_LIKE_ROLES.has("operator")).toBe(true)
    expect(OPERATOR_LIKE_ROLES.has("host")).toBe(true)
    expect(OPERATOR_LIKE_ROLES.has("coordinator")).toBe(true)
    expect(OPERATOR_LIKE_ROLES.has("librarian")).toBe(true)
    expect(OPERATOR_LIKE_ROLES.has("operator-or-shared")).toBe(true)
  })

  it("excludes contributor / lender / borrower / client / fixer / member / caregiver", () => {
    expect(OPERATOR_LIKE_ROLES.has("contributor")).toBe(false)
    expect(OPERATOR_LIKE_ROLES.has("lender")).toBe(false)
    expect(OPERATOR_LIKE_ROLES.has("borrower-side")).toBe(false)
    expect(OPERATOR_LIKE_ROLES.has("client")).toBe(false)
    expect(OPERATOR_LIKE_ROLES.has("fixer")).toBe(false)
    expect(OPERATOR_LIKE_ROLES.has("member")).toBe(false)
    // Caregivers are participants in a childcare co-op, not deployers.
    // The coordinator + host roles are the deployment anchors.
    expect(OPERATOR_LIKE_ROLES.has("caregiver")).toBe(false)
  })
})

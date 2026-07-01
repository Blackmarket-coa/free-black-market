/**
 * Packet assembly: honest-UI disclaimer + remaining-items checklist are always
 * present; domain sections degrade gracefully; the income figure traces to the
 * substrate revenue (which traces to the ledger).
 */
import { buildPacketExport, renderPacketHtml } from "../packet"
import { getQuestDefinition } from "../definitions"
import { makeSubstrate, makeEstablishedNursery } from "./_fixtures"

describe("buildPacketExport", () => {
  const fsa = getQuestDefinition("fsa-farm-loan")!

  it("assembles the lender packet with disclaimer and remaining items", () => {
    const packet = buildPacketExport(fsa, makeEstablishedNursery())!
    expect(packet.packet_key).toBe("lender-packet")
    expect(packet.disclaimer).toMatch(/assembles|assembled|does not guarantee/i)
    expect(packet.remaining_items).toEqual(
      expect.arrayContaining(["Completed FSA loan application forms"])
    )
    // Income statement figure equals the substrate revenue (ledger-traceable).
    const income = packet.sections.find((s) => s.key === "income_statement")!
    expect((income.data as any).lifetime_revenue).toBe(25_000)
  })

  it("marks domain sections unavailable for a universal-only vendor", () => {
    const packet = buildPacketExport(fsa, makeSubstrate())!
    const inv = packet.sections.find((s) => s.key === "inventory_valuation")!
    const prod = packet.sections.find((s) => s.key === "production_summary")!
    expect(inv.available).toBe(false)
    expect(prod.available).toBe(false)
    // Universal sections remain available even with no domain data.
    expect(packet.sections.find((s) => s.key === "income_statement")!.available).toBe(true)
  })

  it("returns null for a quest with no packet template (internal unlock)", () => {
    const trust = getQuestDefinition("trust-tier")!
    expect(buildPacketExport(trust, makeSubstrate())).toBeNull()
  })

  it("renders HTML with the disclaimer shown", () => {
    const packet = buildPacketExport(fsa, makeEstablishedNursery())!
    const html = renderPacketHtml(packet)
    expect(html).toContain("<!doctype html>")
    expect(html).toContain("Important:")
    expect(html).toContain("FSA Lender Packet")
  })
})

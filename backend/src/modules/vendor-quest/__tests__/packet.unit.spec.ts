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

  // A link the vendor cannot see is not a referral: the export carries the
  // definition's gatekeeper links and the print view shows label and URL.
  it("carries the gatekeeper links and prints them with their URLs", () => {
    const links = [
      { label: "Find a lender", url: "https://example.org/lenders?q=1&r=2" },
      { label: "Not a web link", url: "mailto:loans@example.org" },
    ]
    const withLinks = { ...fsa, gatekeeper: { ...fsa.gatekeeper, links } }
    const packet = buildPacketExport(withLinks, makeEstablishedNursery())!
    expect(packet.gatekeeper_links).toEqual(links)

    const html = renderPacketHtml(packet)
    expect(html).toContain("Where to take this packet")
    expect(html).toContain('<a href="https://example.org/lenders?q=1&amp;r=2">Find a lender</a>')
    expect(html).toContain("https://example.org/lenders?q=1&amp;r=2</li>")
    // Non-http(s) URLs are printed, never made clickable.
    expect(html).toContain("Not a web link — mailto:loans@example.org")
    expect(html).not.toContain('href="mailto:')
  })

  it("omits the links section when the definition has none", () => {
    const noLinks = { ...fsa, gatekeeper: { ...fsa.gatekeeper, links: [] } }
    const html = renderPacketHtml(buildPacketExport(noLinks, makeEstablishedNursery())!)
    expect(html).not.toContain("Where to take this packet")
  })
})

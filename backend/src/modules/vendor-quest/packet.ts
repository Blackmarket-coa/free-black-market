import type { QuestDefinition, VendorSubstrate } from "./types"

export interface PacketExport {
  quest_key: string
  packet_key: string
  title: string
  gatekeeper: string
  disclaimer: string
  /** Where to take the packet; printed under the disclaimer. */
  gatekeeper_links: { label: string; url: string }[]
  generated_at: string
  sections: {
    key: string
    title: string
    available: boolean
    data: unknown
    note?: string
  }[]
  remaining_items: string[]
}

/**
 * Assemble a quest's packet from its template + the vendor substrate.
 *
 * Generic and parameterized: it walks `definition.packetTemplate.sections`,
 * letting each section mark itself unavailable when a needed domain field is
 * absent (graceful degradation — a service vendor's packet simply omits/flags
 * inventory rather than failing). Always attaches the honest-UI disclaimer and
 * the remaining-items checklist. Returns null for internal-unlock quests that
 * define no packet (Q10 trust tier, Q13 commons).
 */
export function buildPacketExport(
  definition: QuestDefinition,
  substrate: VendorSubstrate
): PacketExport | null {
  const template = definition.packetTemplate
  if (!template) return null

  const sections = template.sections.map((section) => {
    let result
    try {
      result = section.build(substrate)
    } catch {
      result = { available: false, data: null, note: "Could not assemble this section." }
    }
    return {
      key: section.key,
      title: section.title,
      available: result.available,
      data: result.data,
      note: result.note,
    }
  })

  return {
    quest_key: definition.key,
    packet_key: template.key,
    title: template.title,
    gatekeeper: definition.gatekeeper.name,
    disclaimer: definition.gatekeeper.disclaimer,
    gatekeeper_links: definition.gatekeeper.links ?? [],
    generated_at: substrate.generated_at,
    sections,
    remaining_items: safeList(() => template.remainingItems(substrate)),
  }
}

/**
 * Render a packet as a print-optimized, standalone HTML document (browser
 * print-to-PDF). No external assets; the disclaimer is rendered prominently at
 * the top AND bottom so it survives any partial print.
 */
export function renderPacketHtml(packet: PacketExport): string {
  const esc = (s: unknown) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")

  const disclaimerBlock = `
    <div class="disclaimer">
      <strong>Important:</strong> ${esc(packet.disclaimer)}
    </div>`

  const sectionsHtml = packet.sections
    .map((s) => {
      const body = s.available
        ? `<pre>${esc(JSON.stringify(s.data, null, 2))}</pre>`
        : `<p class="unavailable">Not available for this vendor${
            s.note ? ` — ${esc(s.note)}` : ""
          }.</p>`
      return `<section><h2>${esc(s.title)}</h2>${body}</section>`
    })
    .join("\n")

  const remaining = packet.remaining_items.length
    ? `<ul>${packet.remaining_items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
    : `<p>No outstanding FBM-assembled items.</p>`

  // The URL is printed beside the label: a printed packet keeps no hrefs.
  // Only http(s) links become anchors; anything else is shown as text.
  const links = (packet.gatekeeper_links ?? []).filter((l) => l?.label && l?.url)
  const linksBlock = links.length
    ? `<section><h2>Where to take this packet</h2><ul>${links
        .map((l) =>
          /^https?:\/\//i.test(l.url)
            ? `<li><a href="${esc(l.url)}">${esc(l.label)}</a> — ${esc(l.url)}</li>`
            : `<li>${esc(l.label)} — ${esc(l.url)}</li>`
        )
        .join("")}</ul></section>`
    : ""

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(packet.title)}</title>
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; color: #1a1a1a; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
  .meta { color: #555; margin-bottom: 1rem; }
  .disclaimer { background: #fff8e1; border: 1px solid #e0c15c; border-radius: 6px; padding: 0.75rem 1rem; margin: 1rem 0; }
  section { border-top: 1px solid #eee; padding-top: 0.75rem; margin-top: 1rem; }
  h2 { font-size: 1.15rem; }
  pre { background: #f6f8fa; padding: 0.75rem; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; }
  .unavailable { color: #888; font-style: italic; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
  <h1>${esc(packet.title)}</h1>
  <div class="meta">Gatekeeper: ${esc(packet.gatekeeper)} · Generated ${esc(packet.generated_at)}</div>
  ${disclaimerBlock}
  ${linksBlock}
  ${sectionsHtml}
  <section><h2>Remaining items (you must provide these to the gatekeeper)</h2>${remaining}</section>
  ${disclaimerBlock}
</body>
</html>`
}

function safeList(fn: () => string[]): string[] {
  try {
    return fn() ?? []
  } catch {
    return []
  }
}

import type { QuestDefinition, VendorSubstrate } from "../types"
import { disclaimer } from "./shared"

/**
 * Q16 — Coalition Joint Drive (COLLECTIVE, coalition-only).
 *
 * The first quest that no single vendor can complete and no ad-hoc collective
 * can complete either: every gate reads `s.collective?.coalition`, which is
 * populated only when the collective is the FBM face of a Blackout coalition.
 * An unaffiliated group of sellers sees the quest, sees exactly what it needs,
 * and is honestly told it needs a coalition — rather than grinding toward a
 * gate that silently cannot open.
 *
 * It still runs through the generic engine. The engine learns nothing about
 * coalitions; `coalition` is a domain-optional field like `funds` or `permits`,
 * null for everyone else, and this definition is the only thing that reads it.
 *
 * The milestone is deliberately JOINT, not cumulative-individual: a drive that
 * one member funded alone does not open the gate, because `contributing_members`
 * counts distinct contributors. The point of a coalition drive is that the
 * coalition showed up.
 *
 * No packet. Like Q10 and Q13 this is an internal unlock — there is no outside
 * gatekeeper to submit a coalition drive to, and pretending otherwise would put
 * FBM's name on a document nobody asked for.
 */

const coalition = (s: VendorSubstrate) => s.collective?.coalition ?? null

const drivesCompletedAtLeast = (n: number) => (s: VendorSubstrate) =>
  (coalition(s)?.drives_completed ?? 0) >= n

const contributingMembersAtLeast = (n: number) => (s: VendorSubstrate) =>
  (coalition(s)?.contributing_members ?? 0) >= n

const coalitionDrive: QuestDefinition = {
  key: "coalition-drive",
  category: "Cooperative & Mission",
  title: "Coalition Joint Drive",
  outcome: "A coalition that funds and closes drives together",
  type: "collective",
  // Members' shop records are combined only to show the coalition's own
  // trading history alongside its drives; nothing here reads documents or
  // funds, so the consent ask stays as narrow as the gates.
  requiredConsentScopes: ["operating", "reputation"],
  gatekeeper: {
    name: "your coalition's stewards (internal)",
    disclaimer: disclaimer("Your coalition's stewards"),
    links: [],
  },
  usesFields: [],
  requirements: [
    {
      key: "coalition_linked",
      label: "A linked Blackout coalition",
      tag: "platform",
      satisfied: (s) => coalition(s) != null,
      note: "This quest is for coalitions. Link your collective to a coalition on Blackout to begin.",
    },
    {
      key: "member_shops",
      label: "Member shops on the collective storefront",
      tag: "platform",
      satisfied: (s) => (s.collective?.member_count ?? 0) >= 2,
      note: "At least two consenting members with FBM shops.",
    },
    {
      key: "joint_contribution",
      label: "A drive several members funded",
      tag: "platform",
      satisfied: contributingMembersAtLeast(3),
      note: "Counts distinct contributors — one member funding a drive alone does not open this.",
    },
    {
      key: "drive_closed",
      label: "A completed coalition drive",
      tag: "platform",
      satisfied: drivesCompletedAtLeast(1),
      note: "Reported by Blackout when a drive closes.",
    },
  ],
  stageGates: [
    {
      key: "assembled",
      label: "Assembled",
      order: 1,
      description: "A coalition with member shops behind it.",
      unlocks: (s) => coalition(s) != null && (s.collective?.member_count ?? 0) >= 2,
      missing: (s) => {
        const out: string[] = []
        if (coalition(s) == null) out.push("Link this collective to a Blackout coalition")
        if ((s.collective?.member_count ?? 0) < 2) out.push("At least 2 consenting members")
        return out
      },
    },
    {
      key: "mobilised",
      label: "Mobilised",
      order: 2,
      description: "A drive the coalition funded together and closed.",
      unlocks: (s) => drivesCompletedAtLeast(1)(s) && contributingMembersAtLeast(3)(s),
      missing: (s) => {
        const out: string[] = []
        if (!drivesCompletedAtLeast(1)(s)) out.push("1 completed coalition drive")
        if (!contributingMembersAtLeast(3)(s)) out.push("3 members contributing to a drive")
        return out
      },
    },
    {
      key: "sustained",
      label: "Sustained",
      order: 3,
      description: "A coalition that closes drives as a habit, not once.",
      unlocks: (s) => drivesCompletedAtLeast(3)(s) && contributingMembersAtLeast(5)(s),
      missing: (s) => {
        const out: string[] = []
        if (!drivesCompletedAtLeast(3)(s)) out.push("3 completed coalition drives")
        if (!contributingMembersAtLeast(5)(s)) out.push("5 members contributing to drives")
        return out
      },
    },
  ],
  packetTemplate: null,
}

export default coalitionDrive

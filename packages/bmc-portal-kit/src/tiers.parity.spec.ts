import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { TIERS } from "./tiers"

/**
 * The portal ladder must match the backend ladder that actually pays people.
 *
 * `GROWER_TIERS` in `backend/src/modules/progression/grower-karma.ts` feeds
 * `effectiveGrowerTier`, whose split `modules/payout-breakdown/grower-payout.ts`
 * posts as a real COMMISSION transfer. `TIERS` here is display only — it drives
 * `KarmaBar`, which renders "{remaining} to {next.name} ({next.split_pct}%
 * split)" on the nursery portal's Payouts page.
 *
 * When the two disagree, a grower is shown a threshold they won't be promoted
 * at and a split nobody will pay them. That is exactly what had happened:
 * Ancestor sat at 1000 KARMA / 85% here against 1500 / 72% in the backend,
 * while this file's own header claimed the two agreed.
 *
 * The backend is parsed from source rather than imported: it is a separate
 * workspace with its own Medusa toolchain, and pulling that in to read five
 * numbers would make this package's tests depend on the backend building.
 */
describe("KARMA ladder parity with the backend", () => {
  const backendSource = readFileSync(
    path.resolve(
      __dirname,
      "../../../backend/src/modules/progression/grower-karma.ts"
    ),
    "utf8"
  )

  /**
   * Parse `GROWER_TIERS`:
   *
   *   export const GROWER_TIERS = {
   *     Seedling: { min: 0, split_pct: 0.6 },
   *     ...
   *   } as const
   */
  const backendTiers: Array<{ name: string; min: number; split_pct: number }> =
    (() => {
      const block = backendSource.match(
        /export const GROWER_TIERS\s*=\s*\{([\s\S]*?)\}\s*as const/
      )
      if (!block) {
        throw new Error(
          "Could not find GROWER_TIERS in grower-karma.ts. If it was renamed or " +
            "restructured, update this test rather than deleting it — it is the " +
            "only thing stopping the portal from promising a split we don't pay."
        )
      }

      const rows = [
        ...block[1].matchAll(
          /(\w+)\s*:\s*\{\s*min\s*:\s*([\d._]+)\s*,\s*split_pct\s*:\s*([\d._]+)\s*\}/g
        ),
      ]

      if (rows.length === 0) {
        throw new Error("GROWER_TIERS matched but no tier rows parsed.")
      }

      return rows.map((row) => ({
        name: row[1],
        min: Number(row[2]),
        // Backend stores a fraction (0.6); the portal stores a percentage (60).
        split_pct: Number(row[3]) * 100,
      }))
    })()

  it("parses the backend ladder", () => {
    // Guards the regex itself: a silent zero-row parse would make every
    // assertion below vacuous.
    expect(backendTiers.length).toBeGreaterThanOrEqual(5)
  })

  it("has the same tiers, in the same order", () => {
    expect(TIERS.map((t) => t.name)).toEqual(backendTiers.map((t) => t.name))
  })

  it("promotes at the same KARMA thresholds", () => {
    const mismatches = TIERS.map((tier, i) => ({
      tier: tier.name,
      portal: tier.karma_required,
      backend: backendTiers[i].min,
    })).filter((row) => row.portal !== row.backend)

    expect(mismatches).toEqual([])
  })

  it("shows the same split percentages the payout code applies", () => {
    const mismatches = TIERS.map((tier, i) => ({
      tier: tier.name,
      portal: tier.split_pct,
      // Float maths on 0.62 * 100 lands at 62.000000000000004.
      backend: Math.round(backendTiers[i].split_pct * 100) / 100,
    })).filter((row) => Math.abs(row.portal - row.backend) > 0.001)

    expect(mismatches).toEqual([])
  })
})

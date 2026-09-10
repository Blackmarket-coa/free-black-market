import { execFileSync } from "child_process"
import path from "path"
import {
  THRESHOLD_PRIVILEGES,
  ENFORCED_PRIVILEGE_KEYS,
  enforcedOnly,
} from "../thresholds"

/**
 * A threshold privilege is a promise to the member: its `label` and `blurb` are
 * member-facing copy ("a lower cooperative commission rate"). Until something
 * reads the key and changes behaviour, publishing it as unlocked advertises a
 * benefit that does not exist.
 *
 * All six privileges shipped with no consumer at all — see
 * docs/TRANSMUTATION_STRATEGY.md §1a. The `enforced` flag is the fix, and this
 * spec is what keeps it honest: mark a key only in the same change that wires
 * its consumer.
 */
const REPO_SRC = path.resolve(__dirname, "../../..")

/** Files that may mention a featureKey without being a consumer of it. */
const NON_CONSUMER = /progression\/thresholds\.ts$|__tests__\//

const referencesOutsideCatalog = (featureKey: string): string[] => {
  let out = ""
  try {
    out = execFileSync(
      "grep",
      ["-rl", "--include=*.ts", "--include=*.tsx", "-F", featureKey, REPO_SRC],
      { encoding: "utf8" }
    )
  } catch {
    // grep exits 1 when nothing matches.
    return []
  }
  return out
    .split("\n")
    .filter(Boolean)
    .filter((file) => !NON_CONSUMER.test(file))
}

describe("threshold privilege enforcement", () => {
  it("marks a privilege enforced only when something outside the catalog reads it", () => {
    const wrongly: string[] = []
    for (const privilege of THRESHOLD_PRIVILEGES) {
      if (privilege.enforced !== true) continue
      if (referencesOutsideCatalog(privilege.featureKey).length === 0) {
        wrongly.push(privilege.featureKey)
      }
    }
    expect(wrongly).toEqual([])
  })

  it("does not publish a privilege that nothing honours", () => {
    const unhonoured = THRESHOLD_PRIVILEGES.filter((t) => t.enforced !== true).map(
      (t) => t.featureKey
    )
    expect(enforcedOnly(unhonoured)).toEqual([])
  })

  it("keeps the honoured set a subset of the catalog", () => {
    const catalog = new Set(THRESHOLD_PRIVILEGES.map((t) => t.featureKey))
    for (const key of ENFORCED_PRIVILEGE_KEYS) {
      expect(catalog.has(key)).toBe(true)
    }
  })

  it("records that no privilege is honoured yet, so the count is visible when one becomes so", () => {
    // Not a rule — a tripwire. When a consumer is wired and its key marked,
    // this number moves and the change is deliberate rather than incidental.
    expect(ENFORCED_PRIVILEGE_KEYS.size).toBe(0)
  })
})

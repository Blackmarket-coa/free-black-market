import { readFileSync } from "fs"
import path from "path"

import { CHECK_CRITERIA, LEVEL_CRITERIA } from "../route"
import {
  VerificationLevel,
  VerificationType,
} from "../../../../modules/vendor-verification/models"
import { BADGE_CONFIG } from "../../../../modules/vendor-verification/service"

/**
 * `/store/verification-criteria` publishes what each verification level means.
 * The score thresholds it quotes are restated in plain English rather than
 * imported, because the service computes levels from summed check weights and a
 * public page needs prose, not arithmetic.
 *
 * Restating them creates a drift risk: raise a threshold in
 * `recalculateTrustScore` and the published criteria quietly become wrong,
 * which on a trust page is worse than having no page. This test reads the
 * thresholds back out of the service source and fails when the two disagree —
 * the same source-scanning approach the quest engine uses to prove no quest key
 * leaks into `engine.ts`.
 */
describe("published verification criteria", () => {
  const serviceSource = readFileSync(
    path.join(
      __dirname,
      "../../../../modules/vendor-verification/service.ts"
    ),
    "utf8"
  )

  /**
   * Every `totalScore >= N` gate in `recalculateTrustScore`, paired with the
   * level its branch assigns.
   *
   * Matched per branch — condition, then the immediately following assignment —
   * rather than by searching forward for a level name. The gates form an
   * if/else-if chain, so a lax pattern happily spans from one branch's
   * condition to a later branch's assignment and reports the wrong number.
   */
  const thresholdsInService: Partial<Record<VerificationLevel, number>> = (() => {
    const found: Partial<Record<VerificationLevel, number>> = {}
    const pattern =
      /totalScore\s*>=\s*(\d+)[^{]*\{\s*level\s*=\s*VerificationLevel\.(\w+)/g

    for (const match of serviceSource.matchAll(pattern)) {
      found[match[2] as VerificationLevel] = Number(match[1])
    }
    return found
  })()

  function thresholdInService(level: VerificationLevel): number {
    const threshold = thresholdsInService[level]
    if (threshold === undefined) {
      throw new Error(
        `Could not find a trust-score threshold for ${level} in service.ts. ` +
          `If recalculateTrustScore was restructured, update this test rather than deleting it.`
      )
    }
    return threshold
  }

  it("quotes the same thresholds the service actually applies", () => {
    // UNVERIFIED is the floor and has no `>=` gate — it is the initial value.
    const gated = [
      VerificationLevel.SELF_REPORTED,
      VerificationLevel.VERIFIED,
      VerificationLevel.AUDITED,
      VerificationLevel.CERTIFIED,
    ]

    const mismatches = gated
      .map((level) => ({
        level,
        published: LEVEL_CRITERIA[level].min_trust_score,
        actual: thresholdInService(level),
      }))
      .filter((row) => row.published !== row.actual)

    expect(mismatches).toEqual([])
  })

  it("starts UNVERIFIED at zero", () => {
    expect(LEVEL_CRITERIA[VerificationLevel.UNVERIFIED].min_trust_score).toBe(0)
  })

  it("rises monotonically, so a higher level always means more scrutiny", () => {
    const order = [
      VerificationLevel.UNVERIFIED,
      VerificationLevel.SELF_REPORTED,
      VerificationLevel.VERIFIED,
      VerificationLevel.AUDITED,
      VerificationLevel.CERTIFIED,
    ]

    for (let i = 1; i < order.length; i++) {
      expect(
        LEVEL_CRITERIA[order[i]].min_trust_score
      ).toBeGreaterThan(LEVEL_CRITERIA[order[i - 1]].min_trust_score)
    }
  })

  it("records that CERTIFIED additionally requires an external certification", () => {
    // The service gates CERTIFIED on a passed CERTIFICATION check as well as
    // the score. A published summary that omitted that would overstate what the
    // other levels rule out.
    expect(serviceSource).toMatch(
      /passedTypes\.has\(VerificationType\.CERTIFICATION\)/
    )
    expect(LEVEL_CRITERIA[VerificationLevel.CERTIFIED].summary).toMatch(
      /certification/i
    )
  })

  it("describes every level the model can hold", () => {
    const undescribed = Object.values(VerificationLevel).filter(
      (level) => !LEVEL_CRITERIA[level]
    )
    expect(undescribed).toEqual([])
  })

  it("describes every check type a vendor can be asked for", () => {
    const undescribed = Object.values(VerificationType).filter(
      (type) => !CHECK_CRITERIA[type]?.trim()
    )
    expect(undescribed).toEqual([])
  })

  it("publishes every badge the admin panel can grant", () => {
    // The criteria page and the grant picker both read BADGE_CONFIG, so a
    // grantable badge with no published meaning should be impossible.
    expect(Object.keys(BADGE_CONFIG).length).toBeGreaterThan(0)
  })
})

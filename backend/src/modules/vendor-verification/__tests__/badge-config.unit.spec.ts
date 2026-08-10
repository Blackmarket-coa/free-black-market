import { BADGE_CONFIG } from "../service"
import { BadgeType, VerificationLevel } from "../models"

/**
 * `BADGE_CONFIG` is about to become a published artifact: the public
 * `/verification` criteria page, the admin grant picker, and the badge a buyer
 * clicks on all read from it. That makes gaps in it a trust problem rather than
 * a rendering bug — a badge with no description is the platform asserting
 * something and declining to say what.
 *
 * Each case collects the offending badge types and asserts on the list, so a
 * failure names every badge that needs fixing rather than only the first.
 */
describe("BADGE_CONFIG", () => {
  const entries = Object.entries(BADGE_CONFIG) as [
    BadgeType,
    (typeof BADGE_CONFIG)[BadgeType],
  ][]

  it("covers every badge type the model can store", () => {
    // A grantable type missing from the config would render as an unlabelled
    // badge, or crash the criteria page mapping over the enum.
    const missing = Object.values(BadgeType).filter((t) => !BADGE_CONFIG[t])

    expect(missing).toEqual([])
    expect(entries).toHaveLength(Object.values(BadgeType).length)
  })

  it("gives every badge a name and a description a buyer can act on", () => {
    const unnamed = entries
      .filter(([, config]) => config.name.trim().length === 0)
      .map(([type]) => type)
    // Long enough to be an explanation rather than a restated label.
    const thin = entries
      .filter(([, config]) => config.description.trim().length <= 20)
      .map(([type]) => type)

    expect(unnamed).toEqual([])
    expect(thin).toEqual([])
  })

  it("gives every badge a colour and an icon so it renders consistently", () => {
    const iconless = entries
      .filter(([, config]) => config.icon.trim().length === 0)
      .map(([type]) => type)
    const badColour = entries
      .filter(([, config]) => !/^#[0-9A-Fa-f]{6}$/.test(config.color))
      .map(([type]) => type)

    expect(iconless).toEqual([])
    expect(badColour).toEqual([])
  })

  it("uses a distinct name per badge", () => {
    // Two badges reading "Verified" would make the criteria page ambiguous
    // about which claim was actually checked.
    const names = entries.map(([, config]) => config.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it("points learn-more links at absolute URLs when present", () => {
    const relative = entries
      .filter(
        ([, config]) =>
          config.learnMoreUrl && !/^https?:\/\//.test(config.learnMoreUrl)
      )
      .map(([type]) => type)

    expect(relative).toEqual([])
  })
})

describe("VerificationLevel", () => {
  it("keeps the five progressive levels the trust summary labels", () => {
    // `getTrustSummary` maps every level to a buyer-facing label; adding a
    // level without a label would render `undefined` on a seller page.
    expect(Object.values(VerificationLevel)).toEqual([
      "UNVERIFIED",
      "SELF_REPORTED",
      "VERIFIED",
      "AUDITED",
      "CERTIFIED",
    ])
  })
})

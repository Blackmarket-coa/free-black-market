import { readFileSync } from "fs"
import { join } from "path"
import { OnboardingWizardStep } from "../models/onboarding-state"

const MIGRATION = join(
  __dirname,
  "../migrations/Migration20260807000100AddCottageFoodWizardStep.ts"
)
const ORIGINAL_MIGRATION = join(
  __dirname,
  "../migrations/Migration20260506500OnboardingWizardFields.ts"
)

/**
 * `wizard_step` is guarded by a named DB check constraint, so the enum and the
 * migration have to agree exactly. A value present in one but not the other
 * fails at runtime with a constraint violation the type system can't catch.
 */
describe("cottage_food onboarding wizard step", () => {
  it("sits between delivery and publish", () => {
    const order = Object.values(OnboardingWizardStep)
    expect(order).toEqual([
      "signup",
      "step_1",
      "step_2",
      "step_3",
      "cottage_food",
      "step_4",
      "published",
    ])
  })

  it("is admitted by the widened check constraint", () => {
    const sql = readFileSync(MIGRATION, "utf8")
    const allowed = sql.match(
      /ADD CONSTRAINT "tenancy_onboarding_state_wizard_step_chk"\s*\n?\s*CHECK \("wizard_step" IN \(([^)]*)\)\)/
    )
    expect(allowed).toBeTruthy()

    const values = allowed![1]
      .split(",")
      .map((v) => v.trim().replace(/'/g, ""))

    // Every enum value must be permitted by the constraint, and vice versa.
    expect(values.sort()).toEqual([...Object.values(OnboardingWizardStep)].sort())
  })

  it("only widens the original constraint — no previously valid step is dropped", () => {
    const original = readFileSync(ORIGINAL_MIGRATION, "utf8")
    const previous =
      original
        .match(/CHECK \("wizard_step" IN \(([^)]*)\)\)/)![1]
        .split(",")
        .map((v) => v.trim().replace(/'/g, ""))

    for (const step of previous) {
      expect(Object.values(OnboardingWizardStep)).toContain(step)
    }
  })

  it("parks stranded rows before narrowing the constraint on rollback", () => {
    const sql = readFileSync(MIGRATION, "utf8")
    const down = sql.slice(sql.indexOf("async down"))

    // Without this the down migration would fail on any seller sitting on the
    // removed step.
    expect(down).toMatch(/UPDATE "tenancy_onboarding_state"/)
    expect(down).toMatch(/SET "wizard_step" = 'step_3'/)
    expect(down).toMatch(/WHERE "wizard_step" = 'cottage_food'/)
    expect(down.indexOf("UPDATE")).toBeLessThan(down.indexOf("ADD CONSTRAINT"))
  })

  it("is counted by the funnel", () => {
    const service = readFileSync(join(__dirname, "../service.ts"), "utf8")
    const funnel = service.slice(
      service.indexOf("async wizardFunnel"),
      service.indexOf("async setSandboxMode")
    )
    for (const step of Object.values(OnboardingWizardStep)) {
      expect(funnel).toContain(`OnboardingWizardStep.${stepKey(step)}`)
    }
  })
})

/** Enum value → enum key, for asserting the funnel's exhaustive record. */
function stepKey(value: string): string {
  const entry = Object.entries(OnboardingWizardStep).find(([, v]) => v === value)
  return entry![0]
}

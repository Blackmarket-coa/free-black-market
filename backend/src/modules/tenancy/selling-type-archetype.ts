import { OnboardingSellingType } from "./models/onboarding-state"
import { ProductArchetypeCode } from "../product-archetype/models/product-archetype"

/**
 * The archetype each onboarding selling type implies.
 *
 * This map used to live in the vendor panel, as an `archetype_code` field on
 * `launch-wizard.tsx`'s `SELLING_TYPE_DEFAULTS` table — where **nothing read
 * it**. The wizard rendered the labels beside it and never sent the code
 * anywhere, so the panel carried a mapping that looked authoritative and
 * decided nothing. It is here now because a mapping between two backend enums
 * belongs on the backend, where the compiler can require it to be total and a
 * test can require its targets to be real.
 *
 * `SELLING_TYPE_ARCHETYPE` is typed as a total `Record`, so adding a member to
 * `OnboardingSellingType` without deciding its archetype is a type error
 * rather than a silent gap. That is deliberate: the vendor panel's own
 * `vendor-type-context.spec.ts` carries a regression note about a literal list
 * that "silently stopped covering any newly added archetype", and this is the
 * same failure mode in the other direction.
 *
 * See docs/TRANSMUTATION_STRATEGY.md §4.1.
 */
export const SELLING_TYPE_ARCHETYPE: Record<
  OnboardingSellingType,
  ProductArchetypeCode
> = {
  [OnboardingSellingType.PHYSICAL]: ProductArchetypeCode.NON_PERISHABLE,
  [OnboardingSellingType.DIGITAL]: ProductArchetypeCode.DIGITAL,
  [OnboardingSellingType.SERVICE]: ProductArchetypeCode.SERVICE,
  [OnboardingSellingType.EVENT_CLASS]: ProductArchetypeCode.TICKET,
  // Not NON_PERISHABLE: CIRCULAR_ECONOMY is seeded with
  // `requires_condition_grade`, and the cms-blueprint attaches
  // `attr_condition_grade` to the repaired-goods, salvaged-materials and
  // second-life-electronics categories. Routing salvage to general goods is
  // what loses the condition grade.
  [OnboardingSellingType.RECLAIMED]: ProductArchetypeCode.CIRCULAR_ECONOMY,
}

/** The archetype implied by a selling type, or null if none is recorded yet. */
export function archetypeForSellingType(
  sellingType: OnboardingSellingType | string | null | undefined
): ProductArchetypeCode | null {
  if (!sellingType) return null
  return (
    SELLING_TYPE_ARCHETYPE[sellingType as OnboardingSellingType] ?? null
  )
}

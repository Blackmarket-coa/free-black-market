/**
 * Vendor-archetype drift guard.
 *
 * The set of vendor types is restated in several hand-maintained places across
 * the backend, and the type system does NOT connect them — several are zod
 * enums or `Record<string, …>` lookups where a missing entry is a silent
 * runtime fallthrough rather than a compile error. `creator` demonstrated the
 * cost: it was added to the TS enum and the Postgres enum but missed in three
 * validators, the playbook backfill, and the public directory listing, leaving
 * creator sellers unable to register with that archetype and invisible to
 * customers.
 *
 * These tests are the mechanism that stops the next one. They are deliberately
 * derived from `VendorType` so a newly added archetype fails here until every
 * dependent site is updated.
 */

import { VendorType } from "../models/seller-metadata"
import { vendorTypeEnum as registerVendorTypeEnum } from "../../../api/vendor/register/validators"
import { vendorTypeEnum as sellersVendorTypeEnum } from "../../../api/vendor/sellers/validators"
import {
  LEGACY_VENDOR_TYPE_TO_PLAYBOOK,
  playbookForVendorType,
} from "../../playbook/features"
import { PLAYBOOK_RECIPES } from "../../playbook/recipes"
import { vendorTypeToStance } from "../../progression/stance"
import { ALL_STANCES } from "../../progression/stance"
import {
  DEDICATED_ENTITY_VENDOR_TYPES,
  METADATA_BACKED_VENDOR_TYPES,
} from "../../../api/store/vendors/route"

const ALL_VENDOR_TYPES = Object.values(VendorType) as string[]

describe("VendorType drift guards", () => {
  it("includes the archetype-neutral `general` type", () => {
    expect(ALL_VENDOR_TYPES).toContain("general")
  })

  it("does not use `default` as a value", () => {
    // The vendor-panel reserves the literal "default" as its sentinel for
    // "unrecognized vendor type". A real archetype named `default` would be
    // indistinguishable from that sentinel.
    expect(ALL_VENDOR_TYPES).not.toContain("default")
  })

  it("has no duplicate values", () => {
    expect(new Set(ALL_VENDOR_TYPES).size).toBe(ALL_VENDOR_TYPES.length)
  })
})

describe("zod validators match the VendorType enum", () => {
  // These were hand-maintained literal lists that silently drifted. They are
  // now derived, so these assertions verify the derivation stays wired up.
  it("the registration validator accepts exactly the enum values", () => {
    expect([...registerVendorTypeEnum.options].sort()).toEqual(
      [...ALL_VENDOR_TYPES].sort()
    )
  })

  it("the seller-creation validator accepts exactly the enum values", () => {
    expect([...sellersVendorTypeEnum.options].sort()).toEqual(
      [...ALL_VENDOR_TYPES].sort()
    )
  })

  it("accepts every archetype, including the ones that regressed before", () => {
    for (const type of ALL_VENDOR_TYPES) {
      expect(registerVendorTypeEnum.safeParse(type).success).toBe(true)
      expect(sellersVendorTypeEnum.safeParse(type).success).toBe(true)
    }
  })

  it("still rejects an unknown archetype", () => {
    expect(registerVendorTypeEnum.safeParse("not-a-type").success).toBe(false)
  })
})

describe("every archetype maps to a playbook", () => {
  it("has an explicit legacy-map entry — no silent stall fallback", () => {
    for (const type of ALL_VENDOR_TYPES) {
      expect(LEGACY_VENDOR_TYPE_TO_PLAYBOOK[type]).toBeDefined()
    }
  })

  it("maps only to playbooks that actually exist", () => {
    for (const type of ALL_VENDOR_TYPES) {
      const playbook = playbookForVendorType(type)
      expect(PLAYBOOK_RECIPES[playbook]).toBeDefined()
    }
  })

  it("maps `general` to the solo-seller recipe", () => {
    expect(playbookForVendorType("general")).toBe("stall")
  })
})

describe("every archetype is reachable in the public vendor directory", () => {
  // This is the bug that made `creator` sellers invisible to customers: the
  // listing endpoint enumerated a hardcoded subset, so any archetype outside
  // it returned nothing on both the filtered and unfiltered paths.
  it("is covered by exactly one fetch branch", () => {
    for (const type of ALL_VENDOR_TYPES) {
      const dedicated = DEDICATED_ENTITY_VENDOR_TYPES.includes(type)
      const metadataBacked = METADATA_BACKED_VENDOR_TYPES.includes(type)
      expect(dedicated || metadataBacked).toBe(true)
      expect(dedicated && metadataBacked).toBe(false)
    }
  })

  it("routes `general` through the seller_metadata branch", () => {
    expect(METADATA_BACKED_VENDOR_TYPES).toContain("general")
  })

  it("routes `creator` through the seller_metadata branch", () => {
    expect(METADATA_BACKED_VENDOR_TYPES).toContain("creator")
  })
})

describe("every archetype resolves to a stance", () => {
  it("returns a valid stance for each type", () => {
    for (const type of ALL_VENDOR_TYPES) {
      expect(ALL_STANCES).toContain(vendorTypeToStance(type))
    }
  })

  it("puts `general` on the producer track", () => {
    expect(vendorTypeToStance(VendorType.GENERAL)).toBe(
      vendorTypeToStance(VendorType.MAKER)
    )
  })
})

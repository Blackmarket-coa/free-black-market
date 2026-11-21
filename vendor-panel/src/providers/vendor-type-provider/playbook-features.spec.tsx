import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { renderToStaticMarkup } from "react-dom/server"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * SD-151 (4): the panel took a seller's features from the legacy
 * `vendor_type`, which sign-up derives from the playbook (hooks/api/auth.tsx)
 * and which maps Hub, Commons and Grove to `mutual_aid`. `mutual_aid` has no
 * Products, so a single-role seller on one of those playbooks had no Products
 * entry in the sidebar or the setup checklist, while the dashboard stayed in
 * setup until a product existed. The backend's recipes for all three have
 * Products.
 *
 * A seller's default features are now the vendor type's and the playbook
 * recipe's together. The recipe adds what the vendor type lacked; nothing the
 * vendor type showed goes away, though the recipes leave some of it out (Hub
 * and Kitchen have no Volunteers or Donations, Grove and Commons no Delivery
 * Zones, Service no Products or Inventory).
 */

const browser = await vi.hoisted(async () =>
  (await import("../../__tests__/browser-storage")).installBrowserStorage()
)

import { PLAYBOOK_TO_VENDOR_TYPE } from "../../hooks/api/auth"
import { playbookQueryKeys } from "../../hooks/api/playbook"
import { usersQueryKeys } from "../../hooks/api/users"
import { getVendorNavigationForTest } from "../../hooks/navigation/use-vendor-navigation"
import { getOnboardingSteps } from "../../routes/dashboard/config/dashboard-config"
import {
  getFeaturesByPlaybook,
  PlaybookProvider,
  usePlaybook,
} from "../playbook-provider"
import {
  ALL_FEATURE_KEYS,
  getDefaultFeatures,
  getFeaturesByType,
  resolveVendorFeatures,
  useVendorType,
  VendorTypeProvider,
  type VendorFeatures,
  type VendorType,
} from "./index"

const PLAYBOOKS = [
  "stall",
  "atelier",
  "grove",
  "workshop",
  "commons",
  "cycle",
  "kitchen",
  "harvest",
  "hub",
  "service",
  "creator",
] as const
type PlaybookName = (typeof PLAYBOOKS)[number]

/** The vendor type sign-up gives a seller who chose this playbook. */
const vendorTypeOf = (playbook: PlaybookName) =>
  PLAYBOOK_TO_VENDOR_TYPE[playbook] as VendorType

const enabled = (features: VendorFeatures) =>
  ALL_FEATURE_KEYS.filter((key) => features[key]).sort()

/**
 * The sidebar for these features: every entry and sub-entry, whatever the
 * seller's plan (`planLoaded: false` shows the plan-gated ones too).
 */
const sidebar = (vendorType: VendorType, features: VendorFeatures) => {
  const { coreRoutes, extensionRoutes } = getVendorNavigationForTest({
    vendorType,
    features,
    planLoaded: false,
  })
  const routes = [...coreRoutes, ...extensionRoutes]
  return {
    entries: routes.map((route) => route.to),
    all: routes.flatMap((route) => [
      route.to,
      ...(route.items ?? []).map((item) => item.to),
    ]),
  }
}

/** What a single-role seller on this playbook is shown, with no selection of their own. */
const shownTo = (playbook: PlaybookName) =>
  resolveVendorFeatures({
    vendorType: vendorTypeOf(playbook),
    playbook,
    enabledExtensions: null,
  })

const RECIPES = join(
  __dirname,
  "../../../../backend/src/modules/playbook/recipes"
)
/**
 * The features a recipe file turns on: the keys set to `true` inside its
 * `default_features` block, and nothing else in the file. A recipe is free to
 * carry fields this does not know (the backend's `default_listing_type`).
 */
const featuresIn = (source: string, name: string) => {
  const block = /default_features:\s*\{([^}]*)\}/.exec(source)
  expect(block, `${name} default_features`).not.toBeNull()
  return [...block![1].matchAll(/(\w+):\s*true/g)].map((m) => m[1]).sort()
}
const recipeFeatures = (playbook: PlaybookName) =>
  featuresIn(readFileSync(join(RECIPES, `${playbook}.ts`), "utf8"), playbook)

beforeEach(() => browser.store.clear())
afterAll(() => browser.restore())

describe("a single-role seller's default features", () => {
  it.each(PLAYBOOKS)(
    "%s: every feature and sidebar entry its vendor type showed is still there",
    (playbook) => {
      const vendorType = vendorTypeOf(playbook)
      const before = getFeaturesByType(vendorType)
      const features = shownTo(playbook)

      expect(enabled(features)).toEqual(
        expect.arrayContaining(enabled(before))
      )
      const still = sidebar(vendorType, features).all
      for (const entry of sidebar(vendorType, before).all) {
        expect(still, `${playbook} keeps ${entry}`).toContain(entry)
      }
    }
  )

  it.each(PLAYBOOKS)(
    "%s: every feature its recipe gives is there, with its sidebar entries",
    (playbook) => {
      const vendorType = vendorTypeOf(playbook)
      const features = shownTo(playbook)

      // From the backend's recipe file itself.
      expect(enabled(features)).toEqual(
        expect.arrayContaining(recipeFeatures(playbook))
      )
      const shown = sidebar(vendorType, features).all
      for (const entry of sidebar(vendorType, getFeaturesByPlaybook(playbook))
        .all) {
        expect(shown, `${playbook} has ${entry}`).toContain(entry)
      }
    }
  )

  it.each(PLAYBOOKS)("%s: and nothing else", (playbook) => {
    expect(enabled(shownTo(playbook))).toEqual(
      [
        ...new Set([
          ...enabled(getFeaturesByType(vendorTypeOf(playbook))),
          ...recipeFeatures(playbook),
        ]),
      ].sort()
    )
  })

  it.each(["hub", "commons", "grove"] as const)(
    "a single-role %s seller (vendor_type mutual_aid) has Products, in the sidebar and in the setup checklist",
    (playbook) => {
      // What the panel showed: the vendor type's features, without Products.
      const before = getFeaturesByType("mutual_aid")
      expect(before.hasProducts).toBe(false)
      expect(sidebar("mutual_aid", before).entries).not.toContain("/products")

      const features = shownTo(playbook)

      expect(features.hasProducts).toBe(true)
      expect(sidebar("mutual_aid", features).entries).toContain("/products")
      expect(
        getOnboardingSteps("mutual_aid", features).map((step) => step.key)
      ).toContain("products")
    }
  )

  /**
   * The sidebar entries each playbook's sellers gain over what their vendor
   * type showed. None loses any.
   */
  const withProducts = [
    "/cottage-food",
    "/nursery/listings",
    "/price-lists",
    "/production",
    "/products",
    "/promotions",
    "/reviews",
  ]
  it.each([
    ["stall", []],
    ["atelier", []],
    ["workshop", []],
    ["cycle", []],
    ["harvest", []],
    ["grove", withProducts],
    ["commons", withProducts],
    ["hub", withProducts],
    ["kitchen", ["/shows"]],
    ["service", ["/order-cycles"]],
    ["creator", ["/order-cycles", "/shows"]],
  ] as Array<[PlaybookName, string[]]>)(
    "%s gains exactly %j, and loses nothing",
    (playbook, gained) => {
      const vendorType = vendorTypeOf(playbook)
      const before = sidebar(vendorType, getFeaturesByType(vendorType)).entries
      const after = sidebar(vendorType, shownTo(playbook)).entries

      expect(after.filter((entry) => !before.includes(entry)).sort()).toEqual(
        gained
      )
      expect(before.filter((entry) => !after.includes(entry))).toEqual([])
    }
  )

  it("what the recipe alone would take away stays: Volunteers and Donations for Hub and Kitchen, Delivery Zones for Grove and Commons, Products and Inventory for Service", () => {
    const entries = (playbook: PlaybookName) =>
      sidebar(vendorTypeOf(playbook), shownTo(playbook)).entries

    for (const playbook of ["hub", "kitchen"] as const) {
      expect(entries(playbook)).toEqual(
        expect.arrayContaining([
          "/volunteers",
          "/donations",
          "/aid-network",
          "/funds",
        ])
      )
    }
    expect(entries("kitchen")).toContain("/order-cycles")
    for (const playbook of ["grove", "commons"] as const) {
      expect(entries(playbook)).toEqual(
        expect.arrayContaining(["/deliveries", "/delivery-zones"])
      )
    }
    expect(entries("service")).toEqual(
      expect.arrayContaining(["/products", "/inventory"])
    )
  })

  it("are the vendor type's alone for a seller with no playbook assignment", () => {
    for (const playbook of [null, undefined, "default", "no-such-playbook"]) {
      expect(
        resolveVendorFeatures({
          vendorType: "mutual_aid",
          playbook,
          enabledExtensions: null,
        })
      ).toEqual(getFeaturesByType("mutual_aid"))
    }
  })

  it("give way to the seller's own selection, an empty one included", () => {
    expect(
      enabled(
        resolveVendorFeatures({
          vendorType: "mutual_aid",
          playbook: "hub",
          enabledExtensions: ["hasMenu", "some-plugin-slug"],
        })
      )
    ).toEqual(["hasMenu"])
    expect(
      enabled(
        resolveVendorFeatures({
          vendorType: "mutual_aid",
          playbook: "hub",
          enabledExtensions: [],
        })
      )
    ).toEqual([])
  })

  it("leave the vendor type's own table untouched", () => {
    getDefaultFeatures("mutual_aid", "hub")

    expect(getFeaturesByType("mutual_aid").hasProducts).toBe(false)
  })
})

/**
 * The panel mirrors the backend's recipes. Read from the recipe files so that
 * a recipe that changes without the panel fails here.
 */
describe("the panel's mirror of the backend's recipes", () => {
  it("finds the backend's recipe files", () => {
    expect(existsSync(RECIPES)).toBe(true)
  })

  it.each(PLAYBOOKS)("%s: exactly what its recipe enables", (playbook) => {
    expect(enabled(getFeaturesByPlaybook(playbook))).toEqual(
      recipeFeatures(playbook)
    )
  })

  it("reads only the feature keys of a recipe, whatever else the file carries", () => {
    // A recipe as `fix/p0-onboarding-backend` writes them, with its
    // `default_listing_type`, and with things outside the block that must not
    // be taken for features.
    const recipe = `
      export const HUB: PlaybookRecipe = {
        id: "hub",
        commission_rate: 3,
        allow_credits_payout: true,
        default_features: {
          hasProducts: true,
          hasInventory: true,
          hasDeliveryZones: true,
          hasSupport: true,
          hasRequests: true,
        },
        allowed_listing_types: [
          "physical_product",
          "event",
        ],
        default_listing_type: "physical_product",
        some_later_field: { hasVolunteers: true },
        storefront_blurb_default: "A federation.",
      }
    `

    expect(featuresIn(recipe, "hub")).toEqual(recipeFeatures("hub"))
    expect(featuresIn(recipe, "hub")).toEqual([
      "hasDeliveryZones",
      "hasInventory",
      "hasProducts",
      "hasRequests",
      "hasSupport",
    ])
  })
})

describe("the providers read the seller's playbook assignment", () => {
  const seen: {
    features?: VendorFeatures
    defaults?: VendorFeatures
    playbook?: string
  } = {}
  const Probe = () => {
    const vendor = useVendorType()
    seen.features = vendor.features
    seen.defaults = vendor.defaultFeatures
    seen.playbook = usePlaybook().playbook
    return null
  }
  /** A signed-in seller as `/vendor/sellers/me` and `/vendor/playbook/assign` answer. */
  const renderFor = (
    seller: Record<string, unknown>,
    recipe: string | null
  ) => {
    const client = new QueryClient()
    client.setQueryData(usersQueryKeys.me(), { seller })
    client.setQueryData(playbookQueryKeys.assignment, {
      playbook_assignment: recipe ? { recipe_id: recipe } : null,
    })
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <VendorTypeProvider>
          <PlaybookProvider>
            <Probe />
          </PlaybookProvider>
        </VendorTypeProvider>
      </QueryClientProvider>
    )
    return seen
  }

  it("a Hub seller as approval leaves them (mutual_aid, enabled_extensions null) has the Hub recipe's features beside mutual aid's", () => {
    // SD-151's vendor D: { vendor_type: "mutual_aid", enabled_extensions: null }.
    const { features, defaults, playbook } = renderFor(
      { id: "sel_d", vendor_type: "mutual_aid", enabled_extensions: null },
      "hub"
    )

    expect(enabled(features!)).toEqual(
      [
        // mutual_aid's
        "hasInventory",
        "hasVolunteers",
        "hasDeliveryZones",
        "hasDonations",
        "hasRequests",
        // added by the Hub recipe
        "hasProducts",
        "hasSupport",
      ].sort()
    )
    expect(defaults).toEqual(features)
    // The playbook provider resolved Hub through the legacy map as Grove.
    expect(playbook).toBe("hub")
  })

  it("a Service seller (vendor_type maker) keeps Products and Inventory, and gains what the Service recipe gives", () => {
    const { features } = renderFor(
      { id: "sel_c", vendor_type: "maker", enabled_extensions: null },
      "service"
    )

    expect(enabled(features!)).toEqual(
      [
        "hasProducts",
        "hasInventory",
        "hasSupport",
        "hasSubscriptions",
        "hasRequests",
      ].sort()
    )
  })

  it("a multi-role seller keeps the union approval wrote", () => {
    const union = ["hasProducts", "hasInventory", "hasSupport", "hasMenu"]
    const { features } = renderFor(
      { id: "sel_b", vendor_type: "maker", enabled_extensions: union },
      "stall"
    )

    expect(enabled(features!)).toEqual([...union].sort())
  })

  it("a seller with no assignment keeps the vendor type's features", () => {
    const { features, playbook } = renderFor(
      { id: "sel_old", vendor_type: "mutual_aid", enabled_extensions: null },
      null
    )

    expect(features).toEqual(getFeaturesByType("mutual_aid"))
    expect(playbook).toBe("grove")
  })
})

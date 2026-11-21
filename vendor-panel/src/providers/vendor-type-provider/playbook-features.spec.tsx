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
 * Products. The features now come from the seller's playbook assignment.
 */

const browser = await vi.hoisted(async () =>
  (await import("../../__tests__/browser-storage")).installBrowserStorage()
)

import { playbookQueryKeys } from "../../hooks/api/playbook"
import { usersQueryKeys } from "../../hooks/api/users"
import { getVendorNavigationForTest } from "../../hooks/navigation/use-vendor-navigation"
import { getOnboardingSteps } from "../../routes/dashboard/config/dashboard-config"
import { PlaybookProvider, usePlaybook } from "../playbook-provider"
import {
  ALL_FEATURE_KEYS,
  getFeaturesByType,
  getFeaturesForPlaybook,
  resolveVendorFeatures,
  useVendorType,
  VendorTypeProvider,
  type VendorFeatures,
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

const enabled = (features: VendorFeatures) =>
  ALL_FEATURE_KEYS.filter((key) => features[key]).sort()
const navTargets = (features: VendorFeatures) =>
  getVendorNavigationForTest({ vendorType: "mutual_aid", features }).coreRoutes.map(
    (route) => route.to
  )

beforeEach(() => browser.store.clear())
afterAll(() => browser.restore())

describe("a seller's default features", () => {
  it.each(["hub", "commons", "grove"] as const)(
    "a single-role %s seller (vendor_type mutual_aid, no selection of their own) has Products",
    (playbook) => {
      // What the panel showed: the vendor type's features, without Products.
      const before = getFeaturesByType("mutual_aid")
      expect(before.hasProducts).toBe(false)
      expect(navTargets(before)).not.toContain("/products")

      const features = resolveVendorFeatures({
        vendorType: "mutual_aid",
        playbook,
        enabledExtensions: null,
      })

      expect(features.hasProducts).toBe(true)
      // The sidebar entry, and the setup checklist's step.
      expect(navTargets(features)).toContain("/products")
      expect(
        getOnboardingSteps("mutual_aid", features).map((step) => step.key)
      ).toContain("products")
    }
  )

  it("are the vendor type's for a seller with no playbook assignment", () => {
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

  it("keeps the Products entry for Service, whose recipe has no Products module", () => {
    expect(getFeaturesForPlaybook("service").hasProducts).toBe(true)
  })
})

/**
 * The panel mirrors the backend's recipes. Read from the recipe files so that
 * a recipe that changes without the panel fails here.
 */
describe("the panel's playbook features and the backend's recipes", () => {
  const RECIPES = join(
    __dirname,
    "../../../../backend/src/modules/playbook/recipes"
  )
  const recipeFeatures = (playbook: string) => {
    const source = readFileSync(join(RECIPES, `${playbook}.ts`), "utf8")
    const block = /default_features:\s*\{([^}]*)\}/.exec(source)
    expect(block, `${playbook}.ts default_features`).not.toBeNull()
    return [...block![1].matchAll(/(\w+):\s*true/g)].map((m) => m[1]).sort()
  }

  it("finds the backend's recipe files", () => {
    expect(existsSync(RECIPES)).toBe(true)
  })

  it.each(PLAYBOOKS)("%s shows what its recipe enables", (playbook) => {
    const recipe = recipeFeatures(playbook)
    const panel = enabled(getFeaturesForPlaybook(playbook))

    // The one addition is documented on getFeaturesForPlaybook.
    const expected =
      playbook === "service" ? [...recipe, "hasProducts"].sort() : recipe
    expect(panel).toEqual(expected)
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

  it("a Hub seller as approval leaves them (mutual_aid, enabled_extensions null) gets the Hub recipe's features", () => {
    // SD-151's vendor D: { vendor_type: "mutual_aid", enabled_extensions: null }.
    const { features, defaults, playbook } = renderFor(
      { id: "sel_d", vendor_type: "mutual_aid", enabled_extensions: null },
      "hub"
    )

    expect(enabled(features!)).toEqual(
      [
        "hasDeliveryZones",
        "hasInventory",
        "hasProducts",
        "hasRequests",
        "hasSupport",
      ].sort()
    )
    expect(defaults).toEqual(features)
    // The playbook provider resolved Hub through the legacy map as Grove.
    expect(playbook).toBe("hub")
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

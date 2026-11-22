import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { readFileSync } from "fs"
import { join } from "path"
import { renderToStaticMarkup } from "react-dom/server"
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

/**
 * Fulfillment-set and service-zone names are unique across the marketplace,
 * so the guided setup and Settings, Locations put the location's or set's id
 * in them: "Home shipping (sloc_…)", "US (fuset_…)". The review saw Settings
 * show those ids to the vendor. The names keep their ids; the vendor reads
 * and edits them without.
 */

const browser = await vi.hoisted(async () =>
  (await import("../../../../../__tests__/browser-storage")).installBrowserStorage()
)
vi.mock("../../../../../lib/logger", () => ({
  devLogger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
// The drawer around the form, and the form element, without a router.
const captured = vi.hoisted(() => ({
  onSubmit: undefined as undefined | (() => Promise<void>),
  handleSuccess: vi.fn(),
}))
vi.mock("../../../../../components/modals", async () => {
  const { FormProvider } = await import("react-hook-form")
  const Pass = ({ children }: { children?: unknown }) => children as never
  return {
    RouteDrawer: Object.assign(Pass, {
      Form: ({ form, children }: { form: never; children?: unknown }) => (
        <FormProvider {...(form as object as never)}>{children as never}</FormProvider>
      ),
      Body: Pass,
      Footer: Pass,
      Close: Pass,
    }),
    useRouteModal: () => ({ handleSuccess: captured.handleSuccess }),
  }
})
vi.mock("../../../../../components/utilities/keybound-form", () => ({
  KeyboundForm: ({
    onSubmit,
    children,
  }: {
    onSubmit: () => Promise<void>
    children?: unknown
  }) => {
    captured.onSubmit = onSubmit
    return <form>{children as never}</form>
  },
}))

import { createBackend, json } from "../../../../../__tests__/backend"
import { setAuthToken } from "../../../../../lib/client"
import { queryClient } from "../../../../../lib/query-client"
import {
  renamedZone,
  serviceZoneName,
  shownName,
} from "../../../../../lib/selling-setup"
import { EditServiceZoneForm } from "./edit-service-zone-form"

const backend = createBackend()

beforeEach(() => {
  browser.store.clear()
  setAuthToken("tok-seller")
  backend.reset()
  vi.stubGlobal("fetch", backend.fetch)
  captured.onSubmit = undefined
})
afterEach(() => {
  vi.unstubAllGlobals()
})
afterAll(() => browser.restore())

describe("set and zone names in Settings, Locations", () => {
  it("are read without the id that keeps them unique, and other names as they are", () => {
    expect(shownName(serviceZoneName("us", "fuset_01M80745NMZM1AZ82B2CVYZNV0"))).toBe("US")
    expect(shownName("Home shipping (sloc_01M80745HN59V4N3X56NE0MAY1)")).toBe("Home shipping")
    expect(shownName("Home pick up (sloc_1)")).toBe("Home pick up")
    // A name a vendor typed, brackets and all.
    expect(shownName("North (inner ring)")).toBe("North (inner ring)")
    expect(shownName("US")).toBe("US")
    expect(shownName(undefined)).toBe("")
  })

  it("a renamed zone keeps the id its name carried, and a typed name gets none", () => {
    expect(renamedZone(" Domestic ", "US (fuset_2)")).toBe("Domestic (fuset_2)")
    expect(renamedZone("US", "US (fuset_2)")).toBe("US (fuset_2)")
    expect(renamedZone("Domestic", "North")).toBe("Domestic")
  })

  it("the zone edit form shows the name without its id, and saves it with the id", async () => {
    backend.on(
      "POST",
      "/vendor/fulfillment-sets/fuset_2/service-zones/serzo_3",
      () => json(200, { fulfillment_set: { id: "fuset_2" } })
    )
    const zone = {
      id: "serzo_3",
      name: "US (fuset_2)",
      geo_zones: [],
      shipping_options: [],
    } as never

    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <EditServiceZoneForm zone={zone} fulfillmentSetId="fuset_2" locationId="sloc_1" />
      </QueryClientProvider>
    )

    expect(html).toContain('value="US"')
    expect(html).not.toContain("fuset_2")

    // Saved unchanged: the name keeps its id, so no other store's "US" collides.
    await captured.onSubmit!()
    await vi.waitFor(() => expect(backend.sent).toHaveLength(1))
    expect(backend.sent[0]).toMatchObject({
      method: "POST",
      path: "/vendor/fulfillment-sets/fuset_2/service-zones/serzo_3",
      body: { name: "US (fuset_2)" },
    })
    queryClient.clear()
  })

  it("every screen that shows a set or zone name shows it without the id", () => {
    const read = (path: string) =>
      readFileSync(join(__dirname, "../../..", path), "utf8")
    const screens = [
      "location-detail/components/location-general-section/location-general-section.tsx",
      "location-service-zone-manage-areas/components/edit-region-areas-form/edit-service-zone-areas-form.tsx",
      "location-service-zone-shipping-option-create/components/create-shipping-options-form/create-shipping-option-details-form.tsx",
    ]
    for (const screen of screens) {
      const source = read(screen)
      // Each name is passed through shownName, and none is used raw.
      expect(source, screen).toContain("shownName(")
      expect(source.match(/[^(]zone\.name\b/g) ?? [], screen).toEqual([])
      expect(source.match(/[^(]fulfillmentSet\?\.name\b/g) ?? [], screen).toEqual([])
    }
  })
})

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
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
 * How the launch wizard hands its steps their work (SD-151 (4)): the product
 * the listing step made is what the delivery step stocks and the publish step
 * publishes, and a step is recorded only after the step before it answered.
 * The steps themselves are in launch-wizard.spec.tsx; here they are replaced
 * by stand-ins that hand their props to the spec.
 */

const browser = await vi.hoisted(async () =>
  (await import("../../__tests__/browser-storage")).installBrowserStorage()
)
vi.mock("../../lib/logger", () => ({
  devLogger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const steps = vi.hoisted(() => ({
  listing: undefined as undefined | Record<string, any>,
  delivery: undefined as undefined | Record<string, any>,
  publish: undefined as undefined | Record<string, any>,
}))
vi.mock("./launch-wizard-steps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./launch-wizard-steps")>()),
  ListingStep: (props: Record<string, any>) => {
    steps.listing = props
    return "LISTING STEP"
  },
  DeliveryStep: (props: Record<string, any>) => {
    steps.delivery = props
    return "DELIVERY STEP"
  },
  PublishStep: (props: Record<string, any>) => {
    steps.publish = props
    return "PUBLISH STEP"
  },
  PublishedScreen: () => "PUBLISHED SCREEN",
}))

import { createBackend } from "../../__tests__/backend"
import { createFakeStore } from "../../__tests__/fake-store"
import { setAuthToken } from "../../lib/client"
import { LaunchWizard } from "./launch-wizard"
import { readWizardProduct, writeWizardProduct } from "./launch-wizard-steps"

const backend = createBackend()
let store: ReturnType<typeof createFakeStore>
let client: QueryClient

const render = () =>
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <LaunchWizard />
    </QueryClientProvider>
  )
/** The wizard once its reads have answered, at the step the backend holds. */
const showAt = async (step: string) => {
  store.db.onboarding.wizard_step = step
  store.db.onboarding.selling_type = "physical"
  render()
  await Promise.all(
    client
      .getQueryCache()
      .getAll()
      .map((query) => query.fetch().catch(() => undefined))
  )
  backend.sent.length = 0
  return render()
}
const patches = () =>
  backend.sent.filter((s) => s.method === "PATCH").map((s) => s.body)

beforeEach(() => {
  browser.store.clear()
  setAuthToken("tok-seller")
  backend.reset()
  vi.stubGlobal("fetch", backend.fetch)
  store = createFakeStore(backend)
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  steps.listing = steps.delivery = steps.publish = undefined
})
afterEach(() => {
  vi.unstubAllGlobals()
})
afterAll(() => browser.restore())

describe("the launch wizard and its steps", () => {
  it("remembers the product the listing step created, then records the step", async () => {
    expect(await showAt("step_2")).toContain("LISTING STEP")
    expect(steps.listing).toMatchObject({ sellingType: "physical", existing: null })

    await steps.listing!.onCreated({
      id: "prod_made",
      title: "Wildflower Honey",
      pendingStock: 10,
    })

    expect(readWizardProduct("onb_1")).toEqual({
      id: "prod_made",
      title: "Wildflower Honey",
      pendingStock: 10,
    })
    expect(patches()).toEqual([{ step: "step_3" }])
    // Shown again, the wizard is on delivery, with that product.
    expect(render()).toContain("DELIVERY STEP")
    expect(steps.delivery!.product).toMatchObject({
      id: "prod_made",
      pendingStock: 10,
    })
  })

  it("hands the listing step the product already made, so that it makes no second one, and forgets it only when asked", async () => {
    writeWizardProduct("onb_1", { id: "prod_made", title: "Wildflower Honey" })

    await showAt("step_2")
    expect(steps.listing!.existing).toMatchObject({ id: "prod_made" })

    steps.listing!.onStartOver()
    expect(readWizardProduct("onb_1")).toBeNull()
    expect(patches()).toEqual([])
  })

  it("does not read another seller's product from this browser", async () => {
    writeWizardProduct("onb_other", { id: "prod_theirs", title: "Theirs" })

    await showAt("step_2")

    expect(steps.listing!.existing).toBeNull()
  })

  it("goes from delivery to publish with the same product, and keeps the stock it recorded", async () => {
    writeWizardProduct("onb_1", {
      id: "prod_made",
      title: "Wildflower Honey",
      pendingStock: 10,
    })
    expect(await showAt("step_3")).toContain("DELIVERY STEP")

    steps.delivery!.onStockRecorded({
      id: "prod_made",
      title: "Wildflower Honey",
      pendingStock: null,
    })
    await steps.delivery!.onContinue()

    expect(patches()).toEqual([{ step: "step_4" }])
    expect(render()).toContain("PUBLISH STEP")
    expect(steps.publish!.product).toEqual({
      id: "prod_made",
      title: "Wildflower Honey",
      pendingStock: null,
    })
  })

  it("shows the last screen only with the published state the backend answered", async () => {
    writeWizardProduct("onb_1", { id: "prod_made", title: "Wildflower Honey" })
    expect(await showAt("step_4")).toContain("PUBLISH STEP")
    expect(render()).not.toContain("PUBLISHED SCREEN")

    steps.publish!.onPublished({
      ...store.db.onboarding,
      wizard_step: "published",
      first_published_listing_id: "prod_made",
    })

    expect(render()).toContain("PUBLISHED SCREEN")
    // The publish step's own requests did the writing: the wizard adds none.
    expect(backend.sent).toEqual([])
  })

  it("sends a vendor with no product back from publish to the listing step", async () => {
    await showAt("step_4")

    steps.publish!.onMakeListing()
    await vi.waitFor(() => expect(client.isMutating()).toBe(0))

    expect(patches()).toEqual([{ step: "step_2" }])
    expect(render()).toContain("LISTING STEP")
  })
})

import SellerFeedNotificationProviderService from "../service"
import sellerFeedProvider from "../index"

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as never

describe("modules/seller-feed notification provider", () => {
  // This provider is registered unconditionally in medusa-config.ts, so a
  // load-time or construction error here takes down every boot of the app —
  // including the whole integration suite, which cannot run in every
  // environment. These are cheap guards against that.
  it("exports the provider shape the notification module's loader expects", () => {
    // `medusa-config.ts` registers this unconditionally under
    // `@medusajs/medusa/notification`, so `module` must name that module and
    // `services` must carry the provider class. Asserted structurally because
    // the failure mode otherwise only appears when the app boots — which in
    // this repo means the whole integration suite, and that cannot run
    // everywhere.
    expect(sellerFeedProvider).toMatchObject({
      module: "notification",
      services: [SellerFeedNotificationProviderService],
    })
  })

  it("declares a stable identifier", () => {
    expect(SellerFeedNotificationProviderService.identifier).toBe(
      "notification-seller-feed"
    )
  })

  it("constructs with only a logger", () => {
    expect(() => new SellerFeedNotificationProviderService({ logger })).not.toThrow()
  })

  it("accepts any options — it holds no credentials", () => {
    expect(() =>
      SellerFeedNotificationProviderService.validateOptions({})
    ).not.toThrow()
    expect(() =>
      SellerFeedNotificationProviderService.validateOptions({ channels: ["seller_feed"] })
    ).not.toThrow()
  })

  it("reports success without contacting anything — the row is the delivery", async () => {
    const service = new SellerFeedNotificationProviderService({ logger })
    const result = await service.send({
      to: "sel_1",
      channel: "seller_feed",
      template: "seller_document_expiring_action_required",
      data: {},
    } as never)
    expect(result).toEqual({})
  })

  it("does not throw when the logger has no debug method", async () => {
    const bare = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never
    const service = new SellerFeedNotificationProviderService({ logger: bare })
    await expect(
      service.send({ to: "sel_1", channel: "seller_feed", template: "t", data: {} } as never)
    ).resolves.toEqual({})
  })
})

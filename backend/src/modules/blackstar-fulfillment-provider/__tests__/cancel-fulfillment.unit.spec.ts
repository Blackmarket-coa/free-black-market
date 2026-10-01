import BlackstarFulfillmentProviderService from "../service"

/**
 * The provider's `cancelFulfillment` is a no-op: the cancel's work runs on
 * `order.fulfillment_canceled` (subscribers/blackstar-fulfillment-canceled.ts)
 * because Medusa hands the provider the fulfillment module's cradle, where no
 * FBM module resolves.
 */
describe("BlackstarFulfillmentProviderService.cancelFulfillment", () => {
  it("returns {} without reaching into the fulfillment module's cradle", async () => {
    const touched: string[] = []
    // A cradle looks registrations up by property name; record any lookup.
    const cradle = new Proxy(
      {},
      {
        get: (_target, prop) => {
          touched.push(String(prop))
          throw new Error(`Could not resolve '${String(prop)}'`)
        },
      }
    )
    const provider = new BlackstarFulfillmentProviderService(cradle)
    await expect(provider.cancelFulfillment()).resolves.toEqual({})
    expect(touched).toEqual([])
  })
})

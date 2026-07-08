import { createStellarSettlementService } from "../stellar-settlement"

/**
 * C-4: on-chain settlement must never silently anchor real value against
 * Stellar TESTNET in production. These cover the fail-fast branches added to
 * `createStellarSettlementService`.
 */
describe("createStellarSettlementService production guard", () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV }
  })

  afterAll(() => {
    process.env = OLD_ENV
  })

  it("throws in production when settlement is enabled but network is not mainnet", () => {
    process.env.NODE_ENV = "production"
    process.env.ENABLE_STELLAR_SETTLEMENT = "true"
    delete process.env.STELLAR_NETWORK
    process.env.STELLAR_USDC_ISSUER = "GISSUER"

    expect(() => createStellarSettlementService()).toThrow(/mainnet/i)
  })

  it("throws in production when settlement is enabled on mainnet but USDC issuer is unset", () => {
    process.env.NODE_ENV = "production"
    process.env.ENABLE_STELLAR_SETTLEMENT = "true"
    process.env.STELLAR_NETWORK = "mainnet"
    delete process.env.STELLAR_USDC_ISSUER

    expect(() => createStellarSettlementService()).toThrow(/STELLAR_USDC_ISSUER/)
  })

  it("does not hit the production guard when settlement is disabled (non-mainnet allowed)", () => {
    // With settlement disabled the guard is bypassed; the mainnet/issuer
    // requirements only apply when ENABLE_STELLAR_SETTLEMENT === "true".
    process.env.NODE_ENV = "production"
    process.env.ENABLE_STELLAR_SETTLEMENT = "false"
    delete process.env.STELLAR_NETWORK
    delete process.env.STELLAR_USDC_ISSUER

    // A valid signer secret is still required to construct the underlying
    // Stellar client, so assert specifically that the guard error is NOT thrown.
    expect(() => createStellarSettlementService()).not.toThrow(/mainnet|STELLAR_USDC_ISSUER/)
  })
})

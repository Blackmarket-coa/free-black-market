import {
  mintNodeCredential,
  provisionNodeOperator,
  shouldProvisionNodeOperator,
} from "../provision-node-operator"
import { BLACKSTAR_FULFILLMENT_MODULE } from "../../modules/blackstar-fulfillment"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../modules/marketplace-webhooks"

/**
 * Who gets handed credentials to the logistics network.
 *
 * Seller approval is automatic, so this gate is the only thing between "signed
 * up to sell bread" and "holds a key that signs for a Blackstar node".
 */
describe("shouldProvisionNodeOperator", () => {
  it("is off unless asked for", () => {
    expect(shouldProvisionNodeOperator()).toBe(false)
    expect(shouldProvisionNodeOperator(false)).toBe(false)
    expect(shouldProvisionNodeOperator(undefined)).toBe(false)
  })

  it("follows the seller's own answer", () => {
    expect(shouldProvisionNodeOperator(true)).toBe(true)
  })

  it("does not treat a truthy non-boolean as consent", () => {
    // The flag rides in from a JSON body; "false", 0 and "" must not decide
    // this, and neither should a stray string.
    for (const value of ["true", 1, "yes", {}] as unknown[]) {
      expect(shouldProvisionNodeOperator(value as boolean)).toBe(false)
    }
  })
})

describe("mintNodeCredential", () => {
  it("issues a distinct, well-shaped credential every time", () => {
    const keys = new Set<string>()
    const secrets = new Set<string>()
    for (let i = 0; i < 25; i += 1) {
      const { keyId, secret } = mintNodeCredential()
      expect(keyId).toMatch(/^bsk_[0-9a-f]{20}$/)
      expect(secret).toMatch(/^[0-9a-f]{64}$/)
      keys.add(keyId)
      secrets.add(secret)
    }
    expect(keys.size).toBe(25)
    expect(secrets.size).toBe(25)
  })
})

describe("provisionNodeOperator", () => {
  const queued = { id: "whd_1", subscription_id: "blackstar-global" }

  function containerWith(emit: jest.Mock, blackstar?: { issue?: jest.Mock; revoke?: jest.Mock }) {
    return {
      resolve: (token: string) => {
        if (token === BLACKSTAR_FULFILLMENT_MODULE) {
          if (!blackstar?.issue) throw new Error("no blackstar module")
          return {
            issueNodeOperatorCredential: blackstar.issue,
            revokeNodeOperatorCredential: blackstar.revoke ?? jest.fn(async () => undefined),
          }
        }
        if (token === MARKETPLACE_WEBHOOKS_MODULE) return { emitBlackstar: emit }
        throw new Error(`unexpected resolve(${token})`)
      },
    } as never
  }

  const input = {
    sellerId: "sel_1",
    sellerName: "Cross Town",
    memberEmail: "ops@crosstown.test",
    memberName: "Sam",
  }

  const origEnv = { ...process.env }
  beforeEach(() => {
    // The emit as a deployment connected to Blackstar has it.
    process.env.BLACKSTAR_WEBHOOK_SECRET = "blackstar_bridge_test_secret_0123"
    process.env.BLACKSTAR_API_BASE = "https://blackstar.example"
  })
  afterEach(() => {
    process.env = { ...origEnv }
  })

  it("issues and emits nothing when the seller did not opt in", async () => {
    const emit = jest.fn()
    const issue = jest.fn()
    const result = await provisionNodeOperator(containerWith(emit, { issue }), input)
    expect(result).toEqual({ emitted: false, reason: "not_opted_in" })
    expect(issue).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it("enrolls no one for being a logistics vendor: only the answer counts", async () => {
    // `vendor_type === "logistics"` used to provision with the question
    // answered no. The input has no vendor type any more; one passed anyway
    // changes nothing.
    const emit = jest.fn()
    const issue = jest.fn()
    for (const optedIn of [false, undefined]) {
      const result = await provisionNodeOperator(containerWith(emit, { issue }), {
        ...input,
        optedIn,
        vendorType: "logistics",
      } as never)
      expect(result).toEqual({ emitted: false, reason: "not_opted_in" })
    }
    expect(issue).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it("emits exactly one event keyed on the seller id", async () => {
    const emit = jest.fn(async () => queued)
    const issue = jest.fn(async () => ({ key_id: "bsk_abc", secret: "s".repeat(64) }))
    const result = await provisionNodeOperator(containerWith(emit, { issue }), {
      ...input,
      optedIn: true,
    })

    expect(result.emitted).toBe(true)
    expect(emit).toHaveBeenCalledTimes(1)
    const [type, payload] = emit.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(type).toBe("node.operator.approved")
    // The idempotency key on Blackstar's side: a redelivery must not mint a
    // second operator for the same seller.
    expect(payload.external_ref).toBe("sel_1")
  })

  it("sends the credential it persisted, not a throwaway", async () => {
    const emit = jest.fn(async () => queued)
    const issue = jest.fn(async () => ({ key_id: "bsk_stored", secret: "a".repeat(64) }))
    const result = await provisionNodeOperator(containerWith(emit, { issue }), {
      ...input,
      optedIn: true,
    })

    // Minting inline put the secret on the wire and forgot it, so no operator
    // could ever be told what their own credential was.
    expect(issue).toHaveBeenCalledWith({ seller_id: "sel_1" })
    expect(result).toEqual({ emitted: true, keyId: "bsk_stored", secret: "a".repeat(64) })
    const [, payload] = emit.mock.calls[0] as unknown as [string, { credential: { key_id: string } }]
    expect(payload.credential.key_id).toBe("bsk_stored")
  })

  it("still provisions when the credential cannot be persisted", async () => {
    // A storage failure must not leave a seller who opted in with no node.
    const emit = jest.fn(async () => queued)
    const result = await provisionNodeOperator(containerWith(emit), {
      ...input,
      optedIn: true,
    })
    expect(result.emitted).toBe(true)
    expect(result.keyId).toMatch(/^bsk_/)
  })

  it.each([["BLACKSTAR_WEBHOOK_SECRET"], ["BLACKSTAR_API_BASE"]])(
    "issues no credential and says it emitted nothing when %s is unset",
    async (missing) => {
      // It used to issue a credential, queue nothing, and report
      // `emitted: true`: a secret nobody held, behind a log line saying sent.
      delete process.env[missing]
      const emit = jest.fn(async () => null)
      const issue = jest.fn(async () => ({ key_id: "bsk_abc", secret: "s".repeat(64) }))

      const result = await provisionNodeOperator(containerWith(emit, { issue }), {
        ...input,
        optedIn: true,
      })

      expect(result).toEqual({ emitted: false, reason: "blackstar_not_configured" })
      expect(issue).not.toHaveBeenCalled()
      expect(emit).not.toHaveBeenCalled()
    }
  )

  it("takes back the credential if the event was not queued after all", async () => {
    // The emit answers null when it finds itself unconfigured: `emitted`
    // follows what was queued, not what was attempted.
    const emit = jest.fn(async () => null)
    const issue = jest.fn(async () => ({ key_id: "bsk_abc", secret: "s".repeat(64) }))
    const revoke = jest.fn(async () => undefined)

    const result = await provisionNodeOperator(containerWith(emit, { issue, revoke }), {
      ...input,
      optedIn: true,
    })

    expect(result).toEqual({ emitted: false, reason: "blackstar_not_configured" })
    expect(revoke).toHaveBeenCalledWith("sel_1")
  })

  it("takes back the credential when queueing the event throws, and lets the error out", async () => {
    const emit = jest.fn(async () => {
      throw new Error("database is down")
    })
    const issue = jest.fn(async () => ({ key_id: "bsk_abc", secret: "s".repeat(64) }))
    const revoke = jest.fn(async () => undefined)

    await expect(
      provisionNodeOperator(containerWith(emit, { issue, revoke }), { ...input, optedIn: true })
    ).rejects.toThrow("database is down")
    expect(revoke).toHaveBeenCalledWith("sel_1")
  })
})

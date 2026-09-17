import {
  mintNodeCredential,
  provisionNodeOperator,
  shouldProvisionNodeOperator,
} from "../provision-node-operator"

/**
 * Who gets handed credentials to the logistics network.
 *
 * Seller approval is automatic, so this gate is the only thing between "signed
 * up to sell bread" and "holds a key that signs for a Blackstar node".
 */
describe("shouldProvisionNodeOperator", () => {
  it("is off unless asked for", () => {
    expect(shouldProvisionNodeOperator("general")).toBe(false)
    expect(shouldProvisionNodeOperator("kitchen", false)).toBe(false)
    expect(shouldProvisionNodeOperator("general", undefined)).toBe(false)
  })

  it("follows the opt-in regardless of what the seller sells", () => {
    // The point of moving off vendor_type: a kitchen that also drives could not
    // express that, because vendor_type is one archetype chosen once.
    expect(shouldProvisionNodeOperator("kitchen", true)).toBe(true)
    expect(shouldProvisionNodeOperator("garden", true)).toBe(true)
  })

  it("still honours the old logistics archetype", () => {
    // Sellers registered under the previous rule must not silently lose access.
    expect(shouldProvisionNodeOperator("logistics")).toBe(true)
  })

  it("does not treat a truthy non-boolean as consent", () => {
    // The flag rides in from a JSON body; "false", 0 and "" must not decide
    // this, and neither should a stray string.
    for (const value of ["true", 1, "yes", {}] as unknown[]) {
      expect(shouldProvisionNodeOperator("general", value as boolean)).toBe(false)
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
  function containerWith(emit: jest.Mock, issue?: jest.Mock) {
    return {
      resolve: (token: string) => {
        if (token === "blackstar_fulfillment" || token === "blackstarFulfillment") {
          if (!issue) throw new Error("no blackstar module")
          return { issueNodeOperatorCredential: issue }
        }
        return { emitBlackstar: emit }
      },
    } as never
  }

  const input = {
    sellerId: "sel_1",
    sellerName: "Cross Town",
    memberEmail: "ops@crosstown.test",
    memberName: "Sam",
    vendorType: "general",
  }

  it("emits nothing when the seller did not opt in", async () => {
    const emit = jest.fn()
    const result = await provisionNodeOperator(containerWith(emit), input)
    expect(result.emitted).toBe(false)
    expect(emit).not.toHaveBeenCalled()
  })

  it("emits exactly one event keyed on the seller id", async () => {
    const emit = jest.fn()
    const issue = jest.fn(async () => ({ key_id: "bsk_abc", secret: "s".repeat(64) }))
    const result = await provisionNodeOperator(containerWith(emit, issue), {
      ...input,
      optedIn: true,
    })

    expect(result.emitted).toBe(true)
    expect(emit).toHaveBeenCalledTimes(1)
    const [type, payload] = emit.mock.calls[0]
    expect(type).toBe("node.operator.approved")
    // The idempotency key on Blackstar's side: a redelivery must not mint a
    // second operator for the same seller.
    expect((payload as Record<string, unknown>).external_ref).toBe("sel_1")
  })

  it("sends the credential it persisted, not a throwaway", async () => {
    const emit = jest.fn()
    const issue = jest.fn(async () => ({ key_id: "bsk_stored", secret: "a".repeat(64) }))
    const result = await provisionNodeOperator(containerWith(emit, issue), {
      ...input,
      optedIn: true,
    })

    // Minting inline put the secret on the wire and forgot it, so no operator
    // could ever be told what their own credential was.
    expect(issue).toHaveBeenCalledWith({ seller_id: "sel_1" })
    expect(result.keyId).toBe("bsk_stored")
    const payload = emit.mock.calls[0][1] as { credential: { key_id: string } }
    expect(payload.credential.key_id).toBe("bsk_stored")
  })

  it("still provisions when the credential cannot be persisted", async () => {
    // A storage failure must not leave a seller who opted in with no node.
    const emit = jest.fn()
    const result = await provisionNodeOperator(containerWith(emit), {
      ...input,
      optedIn: true,
    })
    expect(result.emitted).toBe(true)
    expect(result.keyId).toMatch(/^bsk_/)
  })
})

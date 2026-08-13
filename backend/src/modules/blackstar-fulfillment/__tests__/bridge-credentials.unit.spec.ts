import BlackstarFulfillmentModuleService from "../service"
import { bridgeCredentialCipher } from "../bridge-credential-cipher"

/**
 * In-memory harness for the bridge-credential lifecycle — same pattern as
 * blackstar-emit.unit.spec.ts: real class via Object.create, auto-generated
 * CRUD patched onto the instance.
 */
function makeService() {
  const rows: any[] = []
  const svc = Object.create(
    BlackstarFulfillmentModuleService.prototype
  ) as BlackstarFulfillmentModuleService

  ;(svc as any).listBlackstarBridgeCredentials = async (
    filters: Record<string, any> = {}
  ) =>
    rows.filter((r) =>
      Object.entries(filters).every(([k, v]) => v === undefined || r[k] === v)
    )
  ;(svc as any).createBlackstarBridgeCredentials = async (inputs: any[]) =>
    inputs.map((input) => {
      const row = { id: `bbc_${rows.length + 1}`, ...input }
      rows.push(row)
      return row
    })
  ;(svc as any).updateBlackstarBridgeCredentials = async (updates: any[]) =>
    updates.map((update) => {
      const r = rows.find((x) => x.id === update.id)
      if (r) Object.assign(r, update)
      return r
    })

  return { svc, rows }
}

describe("BlackstarFulfillmentModuleService — bridge credentials", () => {
  const origEnv = { ...process.env }
  beforeEach(() => {
    process.env.BRIDGE_CREDENTIAL_KEY = "bridge_test_key_material_0123456789"
  })
  afterEach(() => {
    process.env = { ...origEnv }
  })

  it("issues a credential: plaintext returned once, ciphertext stored", async () => {
    const { svc, rows } = makeService()
    const issued = await svc.issueBridgeCredential({ label: "Blackstar production" })

    expect(issued.key_id).toMatch(/^fbk_[0-9a-f]{20}$/)
    expect(issued.secret).toMatch(/^[0-9a-f]{64}$/)

    expect(rows).toHaveLength(1)
    expect(rows[0].secret).not.toBe(issued.secret)
    expect(bridgeCredentialCipher.isEncrypted(rows[0].secret)).toBe(true)
    expect(rows[0].status).toBe("active")
  })

  it("resolves an active credential's secret by key id (decrypt round-trip)", async () => {
    const { svc } = makeService()
    const issued = await svc.issueBridgeCredential({ label: "peer" })

    const found = await svc.findActiveBridgeSecret(issued.key_id)
    expect(found).toEqual({ id: issued.id, secret: issued.secret })
  })

  it("resolves unknown and revoked key ids to null", async () => {
    const { svc } = makeService()
    const issued = await svc.issueBridgeCredential({ label: "peer" })

    expect(await svc.findActiveBridgeSecret("fbk_nope")).toBeNull()

    await svc.revokeBridgeCredential(issued.key_id)
    expect(await svc.findActiveBridgeSecret(issued.key_id)).toBeNull()
  })

  it("rotates with overlap: same label, old credential stays active", async () => {
    const { svc, rows } = makeService()
    const first = await svc.issueBridgeCredential({ label: "Blackstar production" })
    const second = await svc.rotateBridgeCredential(first.key_id)

    expect(second.label).toBe("Blackstar production")
    expect(second.key_id).not.toBe(first.key_id)
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2)

    // Both generations verify until the old one is explicitly revoked.
    expect(await svc.findActiveBridgeSecret(first.key_id)).not.toBeNull()
    expect(await svc.findActiveBridgeSecret(second.key_id)).not.toBeNull()
  })

  it("stamps last_used_at via touchBridgeCredential", async () => {
    const { svc, rows } = makeService()
    const issued = await svc.issueBridgeCredential({ label: "peer" })

    await svc.touchBridgeCredential(issued.id)
    expect(rows[0].last_used_at).toBeInstanceOf(Date)
  })
})

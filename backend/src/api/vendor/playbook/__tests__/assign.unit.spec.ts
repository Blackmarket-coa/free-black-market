/**
 * `POST /vendor/playbook/assign` — `enabled_extensions` sync.
 *
 * Regression cover for the clobber defect: assigning a single role wrote
 * `enabled_extensions: null`, which discarded both the vendor's custom feature
 * picks and — more damagingly — the record of every plugin they had installed,
 * since plugin slugs share that column.
 *
 * `null` remains correct when there is nothing to preserve: it means "fall back
 * to the playbook's defaults", which is exactly the intent of a single-role
 * assignment.
 */

import { POST } from "../assign/route"
import { defaultFeatureKeysForPlaybook } from "../../../../shared/extension-keys"
import { SELLER_EXTENSION_MODULE } from "../../../../modules/seller-extension"
import { PLAYBOOK_MODULE } from "../../../../modules/playbook"

jest.mock("../../../../shared", () => ({
  requireSellerId: jest.fn(async () => "sel_123"),
}))

const assignPlaybookRun = jest.fn(async () => ({
  result: { playbook_assignment: { id: "pba_1" } },
}))
jest.mock("../../../../workflows/assign-playbook", () => ({
  assignPlaybookWorkflow: () => ({ run: assignPlaybookRun }),
}))

const createRes = () => {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res as {
    statusCode: number
    body: Record<string, unknown>
    status: (c: number) => unknown
    json: (p: unknown) => unknown
  }
}

const makeHarness = (storedExtensions: unknown) => {
  const updated: Record<string, unknown>[] = []

  const sellerExt = {
    listSellerMetadatas: async () => [
      { id: "smeta_1", seller_id: "sel_123", enabled_extensions: storedExtensions },
    ],
    updateSellerMetadatas: async (data: Record<string, unknown>) => {
      updated.push(Array.isArray(data) ? data[0] : data)
      return data
    },
  }

  const playbookService = {
    listPlaybooks: async () => [],
    retrievePlaybook: async () => ({ id: "stall" }),
  }

  const makeReq = (body: Record<string, unknown>) => ({
    body,
    auth_context: { actor_id: "sel_123" },
    scope: {
      resolve: (key: string) => {
        if (key === SELLER_EXTENSION_MODULE) return sellerExt
        if (key === PLAYBOOK_MODULE) return playbookService
        return undefined
      },
    },
  })

  return { makeReq, updated }
}

describe("playbook assign — enabled_extensions sync", () => {
  beforeEach(() => {
    assignPlaybookRun.mockClear()
  })

  it("preserves installed plugin slugs across a single-role assignment", async () => {
    // The defect: this used to write `null`, losing "sales-analytics" entirely.
    const { makeReq, updated } = makeHarness(["hasProducts", "sales-analytics"])
    const res = createRes()

    await POST(
      makeReq({ recipe_id: "stall", roles: ["stall"] }) as never,
      res as never
    )

    expect(updated).toHaveLength(1)
    const persisted = updated[0].enabled_extensions as string[]
    expect(persisted).toContain("sales-analytics")
    // Defaults are materialised alongside, so the slug never stands alone.
    for (const key of defaultFeatureKeysForPlaybook("stall")) {
      expect(persisted).toContain(key)
    }
  })

  it("still clears to null when there is nothing to preserve", async () => {
    const { makeReq, updated } = makeHarness(["hasProducts", "hasMenu"])
    const res = createRes()

    await POST(
      makeReq({ recipe_id: "stall", roles: ["stall"] }) as never,
      res as never
    )

    expect(updated[0].enabled_extensions).toBeNull()
  })

  it("carries plugin slugs into a multi-role union", async () => {
    const { makeReq, updated } = makeHarness(["sales-analytics"])
    const res = createRes()

    await POST(
      makeReq({ recipe_id: "stall", roles: ["stall", "kitchen"] }) as never,
      res as never
    )

    const persisted = updated[0].enabled_extensions as string[]
    expect(persisted).toContain("sales-analytics")
    expect(persisted).toContain("hasMenu") // from the kitchen recipe
  })

  it("leaves extensions untouched when no roles are supplied", async () => {
    const { makeReq, updated } = makeHarness(["sales-analytics"])
    const res = createRes()

    await POST(makeReq({ recipe_id: "stall" }) as never, res as never)

    expect(updated).toHaveLength(0)
  })
})

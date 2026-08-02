import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { getSellerRegistrationStatus } from "../seller-registration"
import { REQUEST_MODULE } from "../../modules/request"

type Mocks = {
  sellers: Record<string, { id: string; store_status?: string | null }>
  membersByEmail: Record<string, string>
  membersById: Record<string, string>
  identities: Array<Record<string, unknown>>
  requests: Array<Record<string, unknown>>
}

const buildReq = (
  authContext: Record<string, unknown> | undefined,
  mocks: Mocks
) => {
  const pgRaw = jest.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes("LOWER(email)")) {
      const email = String(params[0] ?? "").toLowerCase()
      const sellerId = mocks.membersByEmail[email]
      return { rows: sellerId ? [{ seller_id: sellerId }] : [] }
    }
    if (sql.includes("WHERE email")) {
      // Old exact-match form should no longer be used, but keep it working
      const sellerId = mocks.membersByEmail[String(params[0] ?? "")]
      return { rows: sellerId ? [{ seller_id: sellerId }] : [] }
    }
    if (sql.includes("FROM member")) {
      const sellerId = mocks.membersById[String(params[0] ?? "")]
      return { rows: sellerId ? [{ seller_id: sellerId }] : [] }
    }
    return { rows: [] }
  })

  const query = {
    graph: jest.fn(async ({ filters }: { filters: { id: string } }) => {
      const seller = mocks.sellers[filters.id]
      return { data: seller ? [seller] : [] }
    }),
  }

  const authModule = {
    listAuthIdentities: jest.fn(async ({ id }: { id: string[] }) =>
      mocks.identities.filter((i) => id.includes(String(i.id)))
    ),
    updateAuthIdentities: jest.fn(async () => []),
  }

  const requestService = {
    listRequests: jest.fn(async () => mocks.requests),
  }

  const registry: Record<string, unknown> = {
    [ContainerRegistrationKeys.PG_CONNECTION]: { raw: pgRaw },
    [ContainerRegistrationKeys.QUERY]: query,
    [Modules.AUTH]: authModule,
    [REQUEST_MODULE]: requestService,
  }

  const req = {
    headers: {},
    query: {},
    auth_context: authContext,
    scope: {
      resolve: (key: string) => {
        if (!(key in registry)) {
          throw new Error(`Unexpected container resolution in test: ${key}`)
        }
        return registry[key]
      },
    },
  } as any

  return { req, pgRaw, query, authModule, requestService }
}

describe("getSellerRegistrationStatus", () => {
  it("returns 401 when there is no token and no auth context", async () => {
    const { req } = buildReq(undefined, {
      sellers: {},
      membersByEmail: {},
      membersById: {},
      identities: [],
      requests: [],
    })

    const { status, statusCode } = await getSellerRegistrationStatus(req)

    expect(statusCode).toBe(401)
    expect(status.status).toBe("unauthenticated")
  })

  it("falls through a stale seller claim to the identity's app_metadata instead of 404ing", async () => {
    const { req } = buildReq(
      { actor_id: "sel_dead", auth_identity_id: "authid_1" },
      {
        sellers: { sel_live: { id: "sel_live", store_status: "ACTIVE" } },
        membersByEmail: {},
        membersById: {},
        identities: [
          { id: "authid_1", app_metadata: { seller_id: "sel_live" } },
        ],
        requests: [],
      }
    )

    const { status, statusCode } = await getSellerRegistrationStatus(req)

    expect(statusCode).toBe(200)
    expect(status.status).toBe("approved")
    expect(status.seller_id).toBe("sel_live")
  })

  it("resolves a member id stored in app_metadata.seller_id through the member table", async () => {
    const { req } = buildReq(
      { auth_identity_id: "authid_1" },
      {
        sellers: { sel_live: { id: "sel_live", store_status: "ACTIVE" } },
        membersByEmail: {},
        membersById: { mem_1: "sel_live" },
        identities: [{ id: "authid_1", app_metadata: { seller_id: "mem_1" } }],
        requests: [],
      }
    )

    const { status, statusCode } = await getSellerRegistrationStatus(req)

    expect(statusCode).toBe(200)
    expect(status.status).toBe("approved")
    expect(status.seller_id).toBe("sel_live")
  })

  it("self-heals an accepted request case-insensitively and preserves existing app_metadata", async () => {
    const { req, authModule, pgRaw } = buildReq(
      { auth_identity_id: "authid_1" },
      {
        sellers: { sel_live: { id: "sel_live", store_status: "ACTIVE" } },
        membersByEmail: { "user@x.com": "sel_live" },
        membersById: {},
        identities: [
          {
            id: "authid_1",
            app_metadata: { customer_id: "cus_1" },
            provider_identities: [{ entity_id: "user@x.com" }],
          },
        ],
        requests: [
          {
            id: "req_1",
            status: "accepted",
            data: { member: { email: "User@X.com" } },
            created_at: new Date("2026-01-01T00:00:00Z"),
          },
        ],
      }
    )

    const { status, statusCode } = await getSellerRegistrationStatus(req)

    expect(statusCode).toBe(200)
    expect(status.status).toBe("approved")
    expect(status.seller_id).toBe("sel_live")

    // The member lookup must be case-insensitive
    const memberLookups = pgRaw.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM member")
    )
    expect(memberLookups.length).toBeGreaterThan(0)
    expect(String(memberLookups[0][0])).toContain("LOWER(email)")

    // The re-link must merge, not replace, app_metadata
    expect(authModule.updateAuthIdentities).toHaveBeenCalledWith([
      {
        id: "authid_1",
        app_metadata: { customer_id: "cus_1", seller_id: "sel_live" },
      },
    ])
  })

  it("returns 404 only when a stale claim cannot be resolved through any path", async () => {
    const { req } = buildReq(
      { actor_id: "sel_dead", auth_identity_id: "authid_gone" },
      {
        sellers: {},
        membersByEmail: {},
        membersById: {},
        identities: [],
        requests: [],
      }
    )

    const { status, statusCode } = await getSellerRegistrationStatus(req)

    expect(statusCode).toBe(404)
    expect(status.status).toBe("error")
    expect(status.seller_id).toBe("sel_dead")
  })
})

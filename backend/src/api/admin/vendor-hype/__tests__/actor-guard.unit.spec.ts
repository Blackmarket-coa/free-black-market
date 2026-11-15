/**
 * Every admin vendor-hype route refuses a request with no actor type.
 *
 * Their guards read `if (actorType && actorType !== "user" && ...)`, so an
 * empty auth context skipped the check entirely (PRE_LAUNCH_AUDIT SEC-5
 * residual). Medusa's /admin authentication normally sets the actor, so this
 * is the second line — which is what a second line is for.
 */
import * as profiles from "../profiles/route"
import * as settle from "../markets/[id]/settle/route"
import * as reverse from "../markets/[id]/settlements/[settlementId]/reverse/route"
import * as safety from "../safety/route"
import * as oracleKeys from "../oracle-keys/route"
import * as rotate from "../oracle-keys/rotate/route"
import * as payoutsAudit from "../payouts/audit/route"

type Handler = (req: unknown, res: unknown) => Promise<unknown>
type Res = { statusCode: number; status: (c: number) => Res; json: (b: unknown) => Res }

const createRes = (): Res => {
  const res = { statusCode: 200 } as Res
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = () => res
  return res
}

const ROUTES: Record<string, Record<string, unknown>> = {
  profiles,
  settle,
  reverse,
  safety,
  "oracle-keys": oracleKeys,
  "oracle-keys/rotate": rotate,
  "payouts/audit": payoutsAudit,
}

const CASES: [string, string, Handler][] = Object.entries(ROUTES).flatMap(([name, mod]) =>
  ["GET", "POST", "PUT", "PATCH", "DELETE"]
    .filter((verb) => typeof mod[verb] === "function")
    .map((verb) => [name, verb, mod[verb] as Handler] as [string, string, Handler])
)

const resolveNever = () => {
  throw new Error("the guard must refuse before resolving anything")
}

describe("admin vendor-hype routes: actor guard", () => {
  it("covers every exported verb of all seven routes", () => {
    expect(new Set(CASES.map(([name]) => name)).size).toBe(7)
  })

  it.each(CASES)("%s %s refuses an empty auth context with 403", async (_name, _verb, handler) => {
    const res = createRes()
    await handler({ params: { id: "m_1", settlementId: "s_1" }, query: {}, body: {}, scope: { resolve: resolveNever } }, res)
    expect(res.statusCode).toBe(403)
  })

  it.each(CASES)("%s %s lets a Medusa admin session (actor_type user) past the guard", async (_name, _verb, handler) => {
    const res = createRes()
    try {
      await handler(
        {
          auth_context: { actor_type: "user", actor_id: "user_1" },
          params: { id: "m_1", settlementId: "s_1" },
          query: {},
          body: {},
          scope: { resolve: () => new Proxy({}, { get: () => async () => [] }) },
        },
        res
      )
    } catch {
      // Past the guard, an empty body may fail validation; that is not a 403.
    }
    expect(res.statusCode).not.toBe(403)
  })
})

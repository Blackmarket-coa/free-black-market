/**
 * Vote-comment visibility.
 *
 * `garden_vote.comment_visibility` is an enum of public | members_only |
 * private. The GET selected the column and never applied it, so a comment a
 * voter marked private was served to anonymous callers alongside their
 * `customer_id`. This route sits under `/store/proposals`, which
 * `api/middlewares.ts` gates on write verbs only.
 */
import { GET } from "../route"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type Vote = {
  id: string
  customer_id: string
  vote: string
  voting_power: number
  comment: string | null
  comment_visibility: string
}

const createRes = () => {
  const res: { statusCode: number; body: unknown } & Record<string, unknown> = {
    statusCode: 200,
    body: undefined,
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  return res
}

const makeReq = (votes: Vote[]) => ({
  params: { id: "prop_1" },
  scope: {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) {
        return { graph: async () => ({ data: votes }) }
      }
      throw new Error(`unresolvable: ${String(key)}`)
    },
  },
})

const vote = (over: Partial<Vote> = {}): Vote => ({
  id: "v_1",
  customer_id: "cus_1",
  vote: "for",
  voting_power: 1,
  comment: "I have concerns about the budget",
  comment_visibility: "public",
  ...over,
})

const votesOf = (res: ReturnType<typeof createRes>) =>
  (res.body as { votes: Array<Vote & { comment_withheld?: boolean }> }).votes

describe("GET /store/proposals/:id/votes — comment visibility", () => {
  it("serves a public comment", async () => {
    const res = createRes()
    await GET(makeReq([vote()]) as never, res as never)
    expect(votesOf(res)[0].comment).toBe("I have concerns about the budget")
    expect(votesOf(res)[0].comment_withheld).toBeUndefined()
  })

  it("withholds a private comment", async () => {
    const res = createRes()
    await GET(makeReq([vote({ comment_visibility: "private" })]) as never, res as never)
    expect(votesOf(res)[0].comment).toBeNull()
    expect(votesOf(res)[0].comment_withheld).toBe(true)
    expect(JSON.stringify(res.body)).not.toContain("concerns about the budget")
  })

  it("withholds a members_only comment on an unauthenticated route", async () => {
    // This route cannot yet tell a member from a stranger, so members_only
    // is treated as non-public. When it can, that case can widen.
    const res = createRes()
    await GET(makeReq([vote({ comment_visibility: "members_only" })]) as never, res as never)
    expect(votesOf(res)[0].comment).toBeNull()
  })

  it("still returns the ballot itself — only the comment is withheld", async () => {
    // A governance record that quietly dropped ballots would be worse than
    // one that shows a comment as withheld.
    const res = createRes()
    await GET(makeReq([vote({ comment_visibility: "private" })]) as never, res as never)
    const [only] = votesOf(res)
    expect(only.vote).toBe("for")
    expect(only.voting_power).toBe(1)
    expect(only.customer_id).toBe("cus_1")
  })

  it("applies per vote, not per proposal", async () => {
    const res = createRes()
    await GET(
      makeReq([
        vote({ id: "v_pub", comment: "open", comment_visibility: "public" }),
        vote({ id: "v_priv", comment: "closed", comment_visibility: "private" }),
      ]) as never,
      res as never
    )
    const byId = Object.fromEntries(votesOf(res).map((v) => [v.id, v]))
    expect(byId.v_pub.comment).toBe("open")
    expect(byId.v_priv.comment).toBeNull()
  })

  it("returns an empty list for a proposal with no votes", async () => {
    const res = createRes()
    await GET(makeReq([]) as never, res as never)
    expect(votesOf(res)).toEqual([])
  })
})

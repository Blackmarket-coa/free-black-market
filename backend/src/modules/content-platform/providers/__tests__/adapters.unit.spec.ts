import { TikTokProvider } from "../tiktok"
import { YouTubeProvider } from "../youtube"
import { TwitchProvider } from "../twitch"
import { InstagramProvider } from "../instagram"
import {
  ProviderHttpError,
  expiresAtFromSeconds,
  toCount,
  toMetrics,
} from "../http"
import type { NormalizedPlatformAccount } from "../types"

type MockResponse = { ok?: boolean; status?: number; body: unknown }

let fetchCalls: Array<{ url: string; init?: RequestInit }>

/** Queue sequential fetch responses and record the requests made. */
function queueFetch(responses: MockResponse[]): void {
  fetchCalls = []
  let i = 0
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init })
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    } as any
  })
}

const account = (over: Partial<NormalizedPlatformAccount> = {}): NormalizedPlatformAccount => ({
  id: "acc_1",
  creator_seller_id: "seller_1",
  platform: "tiktok",
  external_account_id: "ext_1",
  handle: "creator",
  access_token_encrypted: "tok_abc",
  refresh_token_encrypted: null,
  token_expires_at: null,
  scopes: null,
  inbound_webhook_secret: null,
  metadata: null,
  ...over,
})

beforeEach(() => {
  process.env.TIKTOK_CLIENT_KEY = "tt_key"
  process.env.TIKTOK_CLIENT_SECRET = "tt_secret"
  process.env.GOOGLE_CLIENT_ID = "goog_id"
  process.env.GOOGLE_CLIENT_SECRET = "goog_secret"
  process.env.TWITCH_CLIENT_ID = "tw_id"
  process.env.TWITCH_CLIENT_SECRET = "tw_secret"
  process.env.META_APP_ID = "meta_id"
  process.env.META_APP_SECRET = "meta_secret"
})

describe("http helpers", () => {
  it("toCount coerces to a non-negative integer, else 0", () => {
    expect(toCount("42")).toBe(42)
    expect(toCount(3.9)).toBe(3)
    expect(toCount(-5)).toBe(0)
    expect(toCount("nope")).toBe(0)
    expect(toCount(undefined)).toBe(0)
  })

  it("expiresAtFromSeconds returns an absolute date or undefined", () => {
    expect(expiresAtFromSeconds(3600, 1_000)).toEqual(new Date(3_601_000))
    expect(expiresAtFromSeconds(0)).toBeUndefined()
    expect(expiresAtFromSeconds(undefined)).toBeUndefined()
  })

  it("toMetrics defaults missing signals and qualified_views falls back to views", () => {
    const m = toMetrics({ views: "100", likes: 10, raw: { a: 1 } })
    expect(m).toMatchObject({
      views: 100,
      likes: 10,
      shares: 0,
      comments: 0,
      qualified_views: 100,
    })
    expect(m.raw).toEqual({ a: 1 })
  })

  it("ProviderHttpError is thrown on non-2xx and carries status", async () => {
    queueFetch([{ ok: false, status: 401, body: { error: "bad token" } }])
    await expect(
      new TikTokProvider().verifyAccount(account())
    ).resolves.toMatchObject({ ok: false })
    // fetchPostMetrics surfaces the error (no swallow)
    queueFetch([{ ok: false, status: 500, body: "boom" }])
    await expect(
      new TikTokProvider().fetchPostMetrics(account(), "vid_1")
    ).rejects.toBeInstanceOf(ProviderHttpError)
  })
})

describe("TikTokProvider", () => {
  it("exchanges an auth code and enriches with user info", async () => {
    queueFetch([
      { body: { access_token: "at", refresh_token: "rt", expires_in: 86400, open_id: "open_1", scope: "user.info.basic,video.list" } },
      { body: { data: { user: { display_name: "Ada", follower_count: 5000 } } } },
    ])
    const res = await new TikTokProvider().exchangeCode("code_1", "https://cb")

    expect(res.access).toBe("at")
    expect(res.refresh).toBe("rt")
    expect(res.externalAccountId).toBe("open_1")
    expect(res.handle).toBe("Ada")
    expect(res.followerCount).toBe(5000)
    expect(res.scopes).toEqual(["user.info.basic", "video.list"])
    // token endpoint called with form grant_type
    expect(fetchCalls[0].url).toContain("oauth/token")
    expect(String(fetchCalls[0].init?.body)).toContain("grant_type=authorization_code")
  })

  it("normalizes post metrics from the video query", async () => {
    queueFetch([
      { body: { data: { videos: [{ id: "vid_1", view_count: 900, like_count: 80, comment_count: 12, share_count: 4 }] } } },
    ])
    const m = await new TikTokProvider().fetchPostMetrics(account(), "vid_1")
    expect(m).toMatchObject({ views: 900, likes: 80, comments: 12, shares: 4, qualified_views: 900 })
  })

  it("verifyPostOwnership matches the queried video id", async () => {
    queueFetch([{ body: { data: { videos: [{ id: "vid_1" }] } } }])
    await expect(new TikTokProvider().verifyPostOwnership(account(), "vid_1")).resolves.toBe(true)
    queueFetch([{ body: { data: { videos: [] } } }])
    await expect(new TikTokProvider().verifyPostOwnership(account(), "vid_1")).resolves.toBe(false)
  })
})

describe("YouTubeProvider", () => {
  it("exchanges a code then reads the owner channel", async () => {
    queueFetch([
      { body: { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "https://www.googleapis.com/auth/youtube.readonly" } },
      { body: { items: [{ id: "chan_1", snippet: { title: "My Channel" }, statistics: { subscriberCount: "1200" } }] } },
    ])
    const res = await new YouTubeProvider().exchangeCode("c", "https://cb")
    expect(res.externalAccountId).toBe("chan_1")
    expect(res.handle).toBe("My Channel")
    expect(res.followerCount).toBe(1200)
    expect(fetchCalls[1].url).toContain("part=snippet%2Cstatistics")
  })

  it("normalizes video statistics (no share count)", async () => {
    queueFetch([
      { body: { items: [{ statistics: { viewCount: "5000", likeCount: "300", commentCount: "42" } }] } },
    ])
    const m = await new YouTubeProvider().fetchPostMetrics(account({ platform: "youtube" }), "vid")
    expect(m).toMatchObject({ views: 5000, likes: 300, comments: 42, shares: 0 })
  })

  it("verifyPostOwnership compares the channel id", async () => {
    queueFetch([{ body: { items: [{ snippet: { channelId: "ext_1" } }] } }])
    await expect(
      new YouTubeProvider().verifyPostOwnership(account({ platform: "youtube", external_account_id: "ext_1" }), "v")
    ).resolves.toBe(true)
  })
})

describe("TwitchProvider", () => {
  it("exchanges a code, reads the user and follower total", async () => {
    queueFetch([
      { body: { access_token: "at", refresh_token: "rt", expires_in: 3600 } },
      { body: { data: [{ id: "u_1", login: "streamer" }] } },
      { body: { total: 777, data: [] } },
    ])
    const res = await new TwitchProvider().exchangeCode("c", "https://cb")
    expect(res.externalAccountId).toBe("u_1")
    expect(res.handle).toBe("streamer")
    expect(res.followerCount).toBe(777)
    // Helix calls carry the Client-Id header
    expect((fetchCalls[1].init?.headers as Record<string, string>)["Client-Id"]).toBe("tw_id")
  })

  it("normalizes VOD view_count only", async () => {
    queueFetch([{ body: { data: [{ view_count: 250, user_id: "ext_1" }] } }])
    const m = await new TwitchProvider().fetchPostMetrics(account({ platform: "twitch" }), "vod_1")
    expect(m).toMatchObject({ views: 250, likes: 0, comments: 0, shares: 0 })
  })
})

describe("InstagramProvider", () => {
  it("exchanges short-lived then long-lived token and reads identity", async () => {
    queueFetch([
      { body: { access_token: "short", expires_in: 3600 } },
      { body: { access_token: "long", expires_in: 5184000 } },
      { body: { id: "ig_1", name: "insta_creator" } },
    ])
    const res = await new InstagramProvider().exchangeCode("c", "https://cb")
    expect(res.access).toBe("long")
    expect(res.externalAccountId).toBe("ig_1")
    expect(res.handle).toBe("insta_creator")
  })

  it("merges media counts with insights for metrics", async () => {
    queueFetch([
      { body: { like_count: 40, comments_count: 6 } },
      { body: { data: [
        { name: "impressions", values: [{ value: 800 }] },
        { name: "reach", values: [{ value: 500 }] },
        { name: "saved", values: [{ value: 15 }] },
        { name: "shares", values: [{ value: 3 }] },
      ] } },
    ])
    const m = await new InstagramProvider().fetchPostMetrics(account({ platform: "instagram" }), "media_1")
    expect(m).toMatchObject({ views: 800, qualified_views: 500, likes: 40, comments: 6, saves: 15, shares: 3 })
  })

  it("still returns engagement when insights are unavailable", async () => {
    queueFetch([
      { body: { like_count: 40, comments_count: 6 } },
      { ok: false, status: 400, body: { error: "no insights" } },
    ])
    const m = await new InstagramProvider().fetchPostMetrics(account({ platform: "instagram" }), "media_1")
    expect(m).toMatchObject({ likes: 40, comments: 6, views: 0 })
  })
})

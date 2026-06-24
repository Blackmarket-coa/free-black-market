import { createLogger } from "./logger"
const log = createLogger("shared/matrix-service")
import axios, { AxiosInstance } from "axios"

/**
 * Matrix / Synapse Service ("Blackout" chat)
 *
 * FreeBlackMarket provisions a
 * Matrix account per user against the Synapse Admin API using a server-admin
 * access token, mints a single-use login token for auto-login into an embedded
 * Element Web client, and manages community/vendor/order rooms.
 *
 * Identity conventions are kept identical to `scripts/backfill-mxid.ts` and the
 * Blackout entitlements integration so the mxid written here is the same mxid
 * the entitlement/hawala systems read:
 *   - localpart sanitizer: lower + replace [^a-z0-9._=/-] with "_"
 *   - mxid: `@<localpart>:<MATRIX_SERVER_NAME>`
 *
 * All methods are best-effort and idempotent; failures are logged and surfaced
 * to callers, which treat chat provisioning as a non-critical enhancement.
 */

/**
 * Synapse power level a governance role implies inside a coalition/vendor room.
 * Mirrors `GOVERNANCE_POWER_LEVEL` in
 * `backend/src/modules/entitlement/service.ts` (the canonical source consumed by
 * the Blackout entitlements API) so chat and entitlements agree on "who can do
 * what". 50 is moderator-equivalent, 100 room-admin-equivalent.
 */
export const GOVERNANCE_POWER_LEVEL: Record<string, number> = {
  vendor: 25,
  steward: 50,
  member: 0,
  observer: 0,
}

const MXID_PATTERN = /^@[A-Za-z0-9._=/-]+:[A-Za-z0-9.-]+$/

export interface EnsureUserResult {
  mxid: string
  localpart: string
}

export interface LoginTokenResult {
  login_token: string
  expires_in_ms: number
}

export interface EnsureRoomOptions {
  /** Alias localpart, without leading `#` or `:server` (e.g. `vendor-acme`). */
  alias: string
  name: string
  topic?: string
  /** Full mxids to invite on creation. */
  invite?: string[]
  /** Optional per-mxid power level overrides applied at room creation. */
  powerLevels?: Record<string, number>
}

export class MatrixService {
  private client: AxiosInstance
  private homeserverUrl: string
  private serverName: string
  private adminToken: string

  constructor() {
    const homeserverUrl = process.env.MATRIX_HOMESERVER_URL
    const serverName = process.env.MATRIX_SERVER_NAME
    const adminToken = process.env.MATRIX_ADMIN_TOKEN

    if (!homeserverUrl) {
      throw new Error("MATRIX_HOMESERVER_URL environment variable is not set")
    }
    if (!serverName) {
      throw new Error("MATRIX_SERVER_NAME environment variable is not set")
    }
    if (!adminToken) {
      throw new Error("MATRIX_ADMIN_TOKEN environment variable is not set")
    }

    this.homeserverUrl = homeserverUrl.replace(/\/$/, "")
    this.serverName = serverName
    this.adminToken = adminToken

    this.client = axios.create({
      baseURL: this.homeserverUrl,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.adminToken}`,
      },
    })
  }

  getServerName(): string {
    return this.serverName
  }

  /**
   * Sanitize an arbitrary string (email localpart, seller handle) into a valid
   * Matrix localpart. Matches the convention in `backfill-mxid.ts`.
   */
  sanitizeLocalpart(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9._=/-]/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^[._-]+|[._-]+$/g, "")
      .substring(0, 200)
  }

  buildMxid(localpart: string): string {
    return `@${this.sanitizeLocalpart(localpart)}:${this.serverName}`
  }

  isValidMxid(value: string): boolean {
    return MXID_PATTERN.test(value)
  }

  /**
   * Idempotently create or update a Matrix user via the Synapse Admin API.
   * `PUT /_synapse/admin/v2/users/{mxid}` is an upsert (201 created / 200 updated).
   */
  async ensureUser(
    localpartSource: string,
    displayName: string,
    opts: { email?: string; password?: string } = {}
  ): Promise<EnsureUserResult> {
    const localpart = this.sanitizeLocalpart(localpartSource)
    const mxid = `@${localpart}:${this.serverName}`

    const body: Record<string, unknown> = {
      displayname: displayName,
      admin: false,
      deactivated: false,
    }
    if (opts.password) {
      body.password = opts.password
    }
    if (opts.email) {
      body.threepids = [{ medium: "email", address: opts.email }]
    }

    try {
      await this.client.put(
        `/_synapse/admin/v2/users/${encodeURIComponent(mxid)}`,
        body
      )
      log.info(`[Matrix] Ensured user ${mxid}`)
      return { mxid, localpart }
    } catch (error: any) {
      log.error(
        "[Matrix] ensureUser failed:",
        error.response?.data || error.message
      )
      throw new Error(
        `Failed to ensure Matrix user: ${
          error.response?.data?.error || error.message
        }`
      )
    }
  }

  /**
   * Mint a single-use, short-lived `m.login.token` for auto-login into Element.
   *
   * 1. `POST /_synapse/admin/v1/users/{mxid}/login` (admin) → a user access token
   *    (admin impersonation; this long-lived token never leaves the backend).
   * 2. `POST /_matrix/client/v1/login/get_token` with that user access token →
   *    a single-use `login_token` that the browser passes to Element as
   *    `?loginToken=`.
   *
   * Requires Synapse `login_via_existing_session.enabled: true`.
   */
  /**
   * Admin-impersonation login: exchange the server-admin token for a real user
   * access token via `POST /_synapse/admin/v1/users/{mxid}/login`. The returned
   * token never leaves the backend; it is used to act as the user against the
   * Client-Server API (login-token minting, sync, etc.).
   */
  private async getUserAccessToken(mxid: string): Promise<string> {
    try {
      const loginRes = await this.client.post(
        `/_synapse/admin/v1/users/${encodeURIComponent(mxid)}/login`,
        {}
      )
      const userAccessToken = loginRes.data.access_token
      if (!userAccessToken) {
        throw new Error("admin login returned no access_token")
      }
      return userAccessToken
    } catch (error: any) {
      log.error(
        "[Matrix] admin user login failed:",
        error.response?.data || error.message
      )
      throw new Error("Failed to obtain Matrix user access token")
    }
  }

  async mintLoginToken(mxid: string): Promise<LoginTokenResult> {
    // Step 1: admin-impersonation login → user access token.
    const userAccessToken = await this.getUserAccessToken(mxid)

    // Step 2: exchange the user access token for a single-use login token.
    try {
      const tokenRes = await axios.post(
        `${this.homeserverUrl}/_matrix/client/v1/login/get_token`,
        {},
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userAccessToken}`,
          },
        }
      )

      const loginToken = tokenRes.data.login_token
      if (!loginToken) {
        throw new Error("get_token returned no login_token")
      }

      return {
        login_token: loginToken,
        // Synapse returns `expires_in_ms`; fall back to 2 minutes.
        expires_in_ms:
          typeof tokenRes.data.expires_in_ms === "number"
            ? tokenRes.data.expires_in_ms
            : 120000,
      }
    } catch (error: any) {
      log.error(
        "[Matrix] login token mint failed:",
        error.response?.data || error.message
      )
      throw new Error("Failed to mint Matrix login token")
    }
  }

  /**
   * Sum the unread notification count across all of a user's joined rooms via
   * `GET /_matrix/client/v3/sync` (acting as the user). Best-effort: returns 0
   * on any failure or missing data so the badge degrades silently.
   */
  async getUnreadCount(mxid: string): Promise<number> {
    try {
      const userAccessToken = await this.getUserAccessToken(mxid)

      // Minimal sync: no timeline events, no full state — we only need the
      // per-room `unread_notifications` summary.
      const filter = JSON.stringify({ room: { timeline: { limit: 0 } } })
      const syncRes = await axios.get(
        `${this.homeserverUrl}/_matrix/client/v3/sync`,
        {
          params: { filter, full_state: false, timeout: 0 },
          headers: { Authorization: `Bearer ${userAccessToken}` },
        }
      )

      const joinedRooms = syncRes.data?.rooms?.join
      if (!joinedRooms || typeof joinedRooms !== "object") {
        return 0
      }

      let total = 0
      for (const room of Object.values(joinedRooms) as Array<{
        unread_notifications?: { notification_count?: number }
      }>) {
        const count = room?.unread_notifications?.notification_count
        if (typeof count === "number" && count > 0) {
          total += count
        }
      }
      return total
    } catch (error: any) {
      log.error(
        "[Matrix] getUnreadCount failed:",
        error.response?.data || error.message
      )
      return 0
    }
  }

  /**
   * Resolve a room alias (`#alias:server`) to a room id, or null if it does not
   * exist.
   */
  async resolveRoomId(roomAlias: string): Promise<string | null> {
    try {
      const res = await this.client.get(
        `/_matrix/client/v3/directory/room/${encodeURIComponent(roomAlias)}`
      )
      return res.data.room_id || null
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null
      }
      log.error(
        "[Matrix] resolveRoomId failed:",
        error.response?.data || error.message
      )
      return null
    }
  }

  /**
   * Idempotently ensure a room with the given alias exists. Returns the room id.
   */
  async ensureRoom(opts: EnsureRoomOptions): Promise<string | null> {
    const fullAlias = `#${opts.alias}:${this.serverName}`

    const existing = await this.resolveRoomId(fullAlias)
    if (existing) {
      return existing
    }

    const body: Record<string, unknown> = {
      room_alias_name: opts.alias,
      name: opts.name,
      preset: "private_chat",
      visibility: "private",
    }
    if (opts.topic) {
      body.topic = opts.topic
    }
    if (opts.invite && opts.invite.length > 0) {
      body.invite = opts.invite
    }
    if (opts.powerLevels && Object.keys(opts.powerLevels).length > 0) {
      body.power_level_content_override = { users: opts.powerLevels }
    }

    try {
      const res = await this.client.post("/_matrix/client/v3/createRoom", body)
      log.info(`[Matrix] Created room ${fullAlias}`)
      return res.data.room_id || null
    } catch (error: any) {
      // Lost a create race — the alias now exists, so resolve it.
      if (error.response?.data?.errcode === "M_ROOM_IN_USE") {
        return this.resolveRoomId(fullAlias)
      }
      log.error(
        "[Matrix] ensureRoom failed:",
        error.response?.data || error.message
      )
      return null
    }
  }

  /**
   * Invite a user to a room (by room id or `#alias:server`). Best-effort:
   * "already in room" and similar conditions are swallowed.
   */
  async invite(roomIdOrAlias: string, mxid: string): Promise<void> {
    let roomId = roomIdOrAlias
    if (roomIdOrAlias.startsWith("#")) {
      const resolved = await this.resolveRoomId(roomIdOrAlias)
      if (!resolved) {
        log.warn(`[Matrix] invite skipped, alias not found: ${roomIdOrAlias}`)
        return
      }
      roomId = resolved
    }

    try {
      await this.client.post(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`,
        { user_id: mxid }
      )
      log.info(`[Matrix] Invited ${mxid} to ${roomId}`)
    } catch (error: any) {
      const errcode = error.response?.data?.errcode
      const message: string = error.response?.data?.error || ""
      // Already joined / already invited is fine.
      if (
        errcode === "M_FORBIDDEN" &&
        /already (in|a member|invited)/i.test(message)
      ) {
        return
      }
      log.error(
        "[Matrix] invite failed:",
        error.response?.data || error.message
      )
      // Non-fatal.
    }
  }

  /**
   * Post a plain-text message into a room as the admin/bot user. Best-effort:
   * returns false on failure rather than throwing, so callers (e.g. the embed
   * chat bridge) can fall back to email.
   */
  async sendMessage(roomId: string, text: string): Promise<boolean> {
    const txnId = `fbm-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    try {
      await this.client.put(
        `/_matrix/client/v3/rooms/${encodeURIComponent(
          roomId
        )}/send/m.room.message/${encodeURIComponent(txnId)}`,
        { msgtype: "m.text", body: text }
      )
      return true
    } catch (error: any) {
      log.error(
        "[Matrix] sendMessage failed:",
        error.response?.data || error.message
      )
      return false
    }
  }

  /**
   * Alias for the community-wide room (`#general:server`).
   */
  generalRoomAlias(): string {
    return "general"
  }
}

// Singleton instance
let matrixService: MatrixService | null = null

/**
 * Get or create the Matrix service instance. Returns null when Matrix is not
 * configured (graceful degradation: chat is treated as a non-critical feature).
 */
export function getMatrixService(): MatrixService | null {
  if (
    !process.env.MATRIX_HOMESERVER_URL ||
    !process.env.MATRIX_SERVER_NAME ||
    !process.env.MATRIX_ADMIN_TOKEN
  ) {
    log.info("[Matrix] Service not configured, skipping")
    return null
  }

  if (!matrixService) {
    try {
      matrixService = new MatrixService()
    } catch (error: any) {
      log.error("[Matrix] Failed to initialize service:", error.message)
      return null
    }
  }

  return matrixService
}

import type {
  EnsureRoomOptions,
  EnsureUserResult,
  LoginTokenResult,
} from "../matrix-service"

/**
 * ChatProvider — pluggable adapter interface for the chat backend.
 *
 * Mirrors the `ContentPlatformProvider` precedent in
 * `modules/content-platform/providers/types.ts`, and for the same reason
 * given there: callers depend on the interface, never on an adapter, so the
 * backend stays optional and swappable.
 *
 * ## Why this seam exists
 *
 * Chat was hardwired: thirteen call sites reached for `getMatrixService()`,
 * which constructs a client against **FBM's own homeserver** from
 * `MATRIX_HOMESERVER_URL` / `MATRIX_SERVER_NAME` / `MATRIX_ADMIN_TOKEN`. That
 * is fine while FBM is one marketplace running one homeserver, and it is the
 * thing that blocks selling the portal to anyone else: a non-FBM vendor would
 * need FBM to run a homeserver per tenant, which is the cost the roadmap's
 * Phase 6 was weighing.
 *
 * The decision is that Blackout provides chat. Blackout already operates the
 * Matrix side of this relationship — FBM's entitlements service hands it
 * governance ACLs (`matrixAcls`) which, per
 * `docs/contracts/blackout-integration.md`, "are applied verbatim by
 * Blackout's ACL sync worker." So the direction of travel is to point chat at
 * Blackout rather than have FBM bundle a homeserver per tenant.
 *
 * This interface is what makes that switchable. It is deliberately identical
 * to the existing `MatrixService` surface: the migration is then a mechanical
 * accessor swap with no behaviour change, and a bug in the seam cannot hide
 * behind a simultaneous change in semantics.
 *
 * ## Contract notes carried over from the Matrix implementation
 *
 * These are load-bearing for any future adapter, and are easy to get wrong by
 * writing a "cleaner" implementation:
 * - `resolveRoomId` and `ensureRoom` return `null` rather than throwing when
 *   the room cannot be resolved or created. Callers treat chat as degradable.
 * - `sendMessage` returns a boolean rather than throwing. A failed send must
 *   not fail the business operation that triggered it.
 * - `getUnreadCount` returns a number; callers surface a `degraded` flag
 *   instead of an error when the backend is unreachable (finding C4 in
 *   `ECONOMIC_REVIEW.md` — a silent `0` is indistinguishable from "no unread").
 */
export interface ChatProvider {
  /** Which backend this is. For logging and diagnostics. */
  readonly kind: ChatProviderKind

  ensureUser(
    localpartSource: string,
    displayName: string,
    opts?: { email?: string; password?: string }
  ): Promise<EnsureUserResult>

  mintLoginToken(mxid: string): Promise<LoginTokenResult>

  getUnreadCount(mxid: string): Promise<number>

  /** Null when the alias does not resolve. Never throws for a missing room. */
  resolveRoomId(roomAlias: string): Promise<string | null>

  /** Null when the room could not be created or resolved. */
  ensureRoom(opts: EnsureRoomOptions): Promise<string | null>

  invite(roomIdOrAlias: string, mxid: string): Promise<void>

  /** False on failure — never throws, so a send cannot fail its caller. */
  sendMessage(roomId: string, text: string): Promise<boolean>

  /**
   * Identity helpers. These are synchronous and pure — callers build mxids and
   * room aliases to store on their own records, so they cannot be reduced to
   * the async operations above.
   *
   * They are part of the interface rather than free functions because the
   * answers are backend-specific: the server name is whichever homeserver the
   * provider actually talks to, and routing a tenant's users onto the wrong
   * server name is one of the failure modes this seam exists to prevent.
   */

  /** The homeserver's server name, e.g. `fbm.example`. */
  getServerName(): string

  /** Normalise arbitrary text into a valid mxid localpart. */
  sanitizeLocalpart(input: string): string

  /** Full mxid for a localpart, on this provider's server. */
  buildMxid(localpart: string): string

  /** Alias localpart of the marketplace-wide general room. */
  generalRoomAlias(): string
}

/**
 * Supported backends.
 *
 * `matrix` is FBM's own homeserver — today's behaviour, unchanged.
 * `blackout` routes chat through Blackout, which is the Phase 6 direction for
 * tenants FBM does not host a homeserver for.
 */
export type ChatProviderKind = "matrix" | "blackout"

export const CHAT_PROVIDER_KINDS: readonly ChatProviderKind[] = [
  "matrix",
  "blackout",
]

export function isChatProviderKind(value: unknown): value is ChatProviderKind {
  return (
    typeof value === "string" &&
    (CHAT_PROVIDER_KINDS as readonly string[]).includes(value)
  )
}

export type { EnsureRoomOptions, EnsureUserResult, LoginTokenResult }

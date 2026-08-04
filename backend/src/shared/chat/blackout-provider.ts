import { createLogger } from "../logger"
import type {
  ChatProvider,
  EnsureRoomOptions,
  EnsureUserResult,
  LoginTokenResult,
} from "./types"

const log = createLogger("shared/chat/blackout")

/**
 * Chat via Blackout.
 *
 * **Not yet implemented, and deliberately fails closed rather than guessing.**
 *
 * Blackout runs the Matrix side of this relationship already: FBM's
 * entitlements service returns governance `matrixAcls` which, per
 * `docs/contracts/blackout-integration.md`, "are applied verbatim by
 * Blackout's ACL sync worker." That is the *outbound* half — FBM telling
 * Blackout who may do what.
 *
 * What this adapter needs is the *inbound* half: an administrative API on
 * Blackout's side for provisioning users, minting login tokens, creating and
 * resolving rooms, inviting, reading unread counts, and sending messages.
 * That surface is not specified anywhere in this repository and is not
 * something to invent — an adapter written against a guessed API would look
 * finished, pass its own mocked tests, and fail on first contact.
 *
 * So every operation throws a single, legible error naming what is missing.
 * The seam is what this change delivers; the adapter lands when the API it
 * targets is documented. The precise operations required are exactly the
 * `ChatProvider` members below, which is the useful output of this file until
 * then — it is a specification of what to ask Blackout for.
 *
 * Selecting `blackout` before that point is a configuration mistake, and
 * failing loudly at the call site is the right way to surface it: the
 * alternative (silently falling back to FBM's homeserver) would route a
 * tenant's private conversations to the wrong server, which is a far worse
 * outcome than an error.
 */
export class BlackoutChatProvider implements ChatProvider {
  readonly kind = "blackout" as const

  private unimplemented(operation: string): never {
    const message =
      `[chat] Blackout provider is selected but not implemented (${operation}). ` +
      `Blackout's administrative chat API is not yet specified — see ` +
      `docs/contracts/blackout-integration.md. Set CHAT_PROVIDER=matrix to use ` +
      `FBM's own homeserver.`
    log.error(message)
    throw new Error(message)
  }

  async ensureUser(
    _localpartSource: string,
    _displayName: string,
    _opts: { email?: string; password?: string } = {}
  ): Promise<EnsureUserResult> {
    this.unimplemented("ensureUser")
  }

  async mintLoginToken(_mxid: string): Promise<LoginTokenResult> {
    this.unimplemented("mintLoginToken")
  }

  async getUnreadCount(_mxid: string): Promise<number> {
    this.unimplemented("getUnreadCount")
  }

  async resolveRoomId(_roomAlias: string): Promise<string | null> {
    this.unimplemented("resolveRoomId")
  }

  async ensureRoom(_opts: EnsureRoomOptions): Promise<string | null> {
    this.unimplemented("ensureRoom")
  }

  async invite(_roomIdOrAlias: string, _mxid: string): Promise<void> {
    this.unimplemented("invite")
  }

  async sendMessage(_roomId: string, _text: string): Promise<boolean> {
    this.unimplemented("sendMessage")
  }

  getServerName(): string {
    this.unimplemented("getServerName")
  }

  sanitizeLocalpart(_input: string): string {
    this.unimplemented("sanitizeLocalpart")
  }

  buildMxid(_localpart: string): string {
    this.unimplemented("buildMxid")
  }

  generalRoomAlias(): string {
    this.unimplemented("generalRoomAlias")
  }
}

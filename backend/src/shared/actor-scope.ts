import type { MedusaRequest } from "@medusajs/framework/http"

// Registration key of the hawala-ledger module. Resolved by string rather than
// importing the module's index so this shared helper stays decoupled from the
// module's (heavy) import graph. Kept in sync with modules/hawala-ledger.
const HAWALA_LEDGER_MODULE = "hawalaLedger"

/**
 * The authenticated customer id when the actor is a customer, else null.
 *
 * The community/food write routes accept any logged-in account
 * (customer/seller/driver) — see the matchers in api/middlewares.ts — but many
 * of them persist a `customer_id` / `*_by_id` taken from the request body. That
 * lets one authenticated customer act AS ANOTHER (vote, claim a harvest share,
 * log volunteer hours, join a garden as someone else). Use this to force those
 * fields to the real actor.
 *
 * Only customers are resolved here: for a seller/driver actor `actor_id` is a
 * seller/driver id, not a `cus_...`, so callers should leave the body value
 * untouched for non-customers (route-specific handling) rather than writing a
 * seller id into a customer field.
 */
export function actingCustomerId(req: MedusaRequest): string | null {
  const ctx = (req as unknown as {
    auth_context?: { actor_id?: string; actor_type?: string }
  }).auth_context
  if (ctx?.actor_type === "customer" && typeof ctx.actor_id === "string") {
    return ctx.actor_id
  }
  return null
}

// The hawala ledger's owner_type enum is UPPERCASE; actor_type is lowercase.
// Only customer/seller map to a ledger owner_type — "driver" has no equivalent.
const ACTOR_TYPE_TO_LEDGER_OWNER_TYPE: Record<string, string> = {
  customer: "CUSTOMER",
  seller: "SELLER",
}

/**
 * Guards against attaching someone else's hawala ledger account. Returns:
 *   - `null` when ownership is confirmed, OR when the actor type has no ledger
 *     `owner_type` equivalent (e.g. "driver") and so can't be evaluated here.
 *   - a message string (use it for a 403) when the referenced account is
 *     missing or is owned by a different account.
 *
 * Several community/food create routes accept a `hawala_account_id` from the
 * request body without checking who owns it, which would let an authenticated
 * account wire a producer/courier's money to (or from) a ledger account that
 * isn't theirs. Call this before persisting the id.
 */
export async function hawalaAccountOwnershipError(
  req: MedusaRequest,
  hawalaAccountId: string
): Promise<string | null> {
  const ctx = (req as unknown as {
    auth_context?: { actor_id?: string; actor_type?: string }
  }).auth_context
  const expectedOwnerType = ctx?.actor_type
    ? ACTOR_TYPE_TO_LEDGER_OWNER_TYPE[ctx.actor_type]
    : undefined
  if (!expectedOwnerType || !ctx?.actor_id) {
    // Unmappable actor type (driver / unauthenticated) — nothing to check here.
    return null
  }

  const hawala = req.scope.resolve(HAWALA_LEDGER_MODULE) as {
    retrieveLedgerAccount: (
      id: string
    ) => Promise<{ owner_type?: string; owner_id?: string } | null>
  }
  const account = await hawala
    .retrieveLedgerAccount(hawalaAccountId)
    .catch(() => null)

  if (!account) {
    return "Referenced ledger account was not found"
  }
  if (
    account.owner_type !== expectedOwnerType ||
    account.owner_id !== ctx.actor_id
  ) {
    return "That ledger account is not yours"
  }
  return null
}

/**
 * Whether the authenticated actor may manage a resource stamped with `ownerId`.
 * Grandfathers legacy rows that predate ownership tracking (no `ownerId`
 * recorded → allowed, so existing data keeps working); rows that DO carry an
 * owner are restricted to that owner's `actor_id`.
 */
export function actorMayManage(
  req: MedusaRequest,
  ownerId?: string | null
): boolean {
  if (!ownerId) {
    return true // pre-ownership-tracking row — grandfathered
  }
  const ctx = (req as unknown as {
    auth_context?: { actor_id?: string }
  }).auth_context
  return !!ctx?.actor_id && ctx.actor_id === ownerId
}

import { createHash, randomBytes, timingSafeEqual } from "crypto";

/**
 * Email verification for seller registration.
 *
 * Medusa's `emailpass` provider does not verify that the address belongs to the
 * person registering, and seller approval is automatic — so without this step
 * the gate on becoming a seller (and, through the Blackstar bridge, a node
 * operator holding logistics credentials) is "can type an address", not
 * "controls a mailbox".
 *
 * The token is stored as a SHA-256 hash on the request's existing `data` JSON,
 * never in plaintext: the requests table is readable by every admin and shows up
 * in support tooling, and a readable token is a bearer credential for someone
 * else's seller account. Single-use, and expiring, for the same reason.
 */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface EmailVerificationState {
  token_hash: string;
  expires_at: string;
  verified_at?: string;
}

const hash = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

/** A fresh token and the state to persist beside it. Returns the RAW token to email. */
export function issueVerificationToken(now: Date = new Date()): {
  token: string;
  state: EmailVerificationState;
} {
  // 32 bytes: this is a bearer credential for a seller account, so it is sized
  // against offline guessing rather than for a readable URL.
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    state: {
      token_hash: hash(token),
      expires_at: new Date(now.getTime() + VERIFICATION_TTL_MS).toISOString(),
    },
  };
}

export type VerificationOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "not_requested" | "already_verified" | "expired" | "mismatch";
    };

/**
 * Check a presented token against stored state.
 *
 * Compares hashes in constant time. A wrong token and a well-formed guess take
 * the same work, so this cannot be used as a timing oracle for a valid prefix.
 */
export function checkVerificationToken(
  state: EmailVerificationState | undefined,
  presented: string,
  now: Date = new Date(),
): VerificationOutcome {
  // `verified_at` is checked first: a consumed state deliberately has an empty
  // token_hash, and reporting that as "not_requested" would be misleading.
  if (state?.verified_at) return { ok: false, reason: "already_verified" };
  if (!state?.token_hash) return { ok: false, reason: "not_requested" };

  const expected = Buffer.from(state.token_hash, "hex");
  const actual = Buffer.from(hash(presented ?? ""), "hex");
  // Lengths are equal by construction (both SHA-256), but timingSafeEqual
  // throws on a mismatch, so guard rather than let a malformed stored value
  // turn a failed check into a 500.
  const matches =
    expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!matches) return { ok: false, reason: "mismatch" };

  // Expiry is checked AFTER the hash compare so that "expired" cannot be used
  // to confirm a guessed token.
  if (Date.parse(state.expires_at) <= now.getTime())
    return { ok: false, reason: "expired" };
  return { ok: true };
}

/** The state to persist once a token has been accepted. Single-use: the hash is dropped. */
export function consumedState(now: Date = new Date()): EmailVerificationState {
  return {
    token_hash: "",
    expires_at: new Date(0).toISOString(),
    verified_at: now.toISOString(),
  };
}

export function isEmailVerified(
  state: EmailVerificationState | undefined,
): boolean {
  return Boolean(state?.verified_at);
}

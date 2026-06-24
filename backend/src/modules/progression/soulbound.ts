/**
 * Soulbound semantics for XP.
 *
 * XP is a *soulbound* reputation signal: it is bound to the account that earned
 * it and cannot be transferred to another account. This is enforced **by
 * construction** — the progression module exposes no wallet→wallet transfer and
 * the ledger (`xp_event`) is `customer_id`-scoped — not by a runtime flag. This
 * constant documents the intent and maps it to the established standards:
 *
 *  - EIP-5192 (minimal "locked" flag): the token is non-transferable.
 *  - EIP-4973 (account-bound tokens): mint/burn is consent-based and bound to an
 *    account; there is no transfer path.
 *  - Buterin/Weyl/Ohlhaver, "Decentralized Society: Finding Web3's Soul" — value
 *    comes from the opportunities the signal unlocks, not from trading it.
 *
 * Practically this means:
 *  - No transfer API exists or will be added.
 *  - XP is revocable only via a signed clawback `xp_event` (negative amount),
 *    which is itself audited in the append-only ledger.
 *  - XP is never converted to crypto/fiat and never withdrawn; redemption only
 *    ever debits the owner's own spendable balance against the reward catalog.
 *
 * See `docs/adr/ADR-0003-xp-demurrage-and-soulbound-semantics.md`.
 */
export const XP_SOULBOUND = {
  /** XP can never be transferred between accounts. */
  transferable: false,
  /** XP is bound to the account that earned it. */
  accountBound: true,
  /** XP can only be removed via an audited, signed clawback event. */
  revocableViaClawbackOnly: true,
  /** Conceptual standards this maps to. */
  standards: ["EIP-5192", "EIP-4973"] as const,
} as const

export type XpSoulboundPolicy = typeof XP_SOULBOUND

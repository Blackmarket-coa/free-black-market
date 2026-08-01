/**
 * Creator Credits helpers — XP → Coalition Credits (CCR) conversion and
 * closed-loop withdrawal (redemption) requests for the creator portal.
 *
 * Money-moving surfaces are dark by default: the convert/withdraw routes only
 * touch the hawala ledger when FBM_CREATOR_CREDITS_LIVE=1 (mirrors the
 * campaign-escrow dark-launch pattern in `campaign-escrow.ts`). Read-only
 * surfaces (xp-balances, quests) are always on.
 *
 * UNITS: Coalition Credits are whole credits on the CCR rail (hawala ledger
 * `amount` at face value — see `creator-hub.ts` balance helpers). XP is whole
 * XP from progression `character_sheet.spendable_xp`. Conversion is
 * whole-block only: 1,000 XP → 50₡, floor semantics, no fractional blocks.
 *
 * POSTURE A: CCR never converts to cash. Conversion mints credits from the
 * platform CCR issuer account (entry_type CREDIT_PAYOUT_MINT); withdrawal is a
 * closed-loop redemption REQUEST that burns credits back to the issuer
 * (CREDIT_REFUND_BURN) pending manual settlement — never a cash rail. See
 * docs/POSTURE_A_COMPLIANCE.md.
 */

export const CREATOR_CREDITS_FLAG = "FBM_CREATOR_CREDITS_LIVE"

export function isCreatorCreditsLive(): boolean {
  return process.env[CREATOR_CREDITS_FLAG] === "1"
}

/** XP debited per conversion block. Must match the creator portal constant. */
export const XP_PER_CREDIT_BLOCK = 1000
/** Credits minted per conversion block. Must match the creator portal constant. */
export const CREDITS_PER_BLOCK = 50

/** Raised when a conversion request can't cover a single whole block. */
export class XpConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "XpConversionError"
  }
}

export interface XpConversionQuote {
  /** Whole blocks converted. */
  blocks: number
  /** XP actually debited (blocks × XP_PER_CREDIT_BLOCK). */
  xpDebited: number
  /** Credits minted (blocks × CREDITS_PER_BLOCK). */
  creditsMinted: number
}

/**
 * Quote a whole-block XP → credits conversion.
 *
 * Floor semantics: any XP beyond the last whole block is left untouched
 * (1,500 XP → 1 block → 1,000 XP debited, 50₡ minted).
 *
 * @throws XpConversionError when `xp` is not a finite positive number or
 * covers less than one whole block.
 */
export function quoteXpConversion(xp: number): XpConversionQuote {
  if (!Number.isFinite(xp) || xp <= 0) {
    throw new XpConversionError(
      `XP amount must be a positive number (got ${xp}).`
    )
  }
  const blocks = Math.floor(xp / XP_PER_CREDIT_BLOCK)
  if (blocks < 1) {
    throw new XpConversionError(
      `At least ${XP_PER_CREDIT_BLOCK} XP is required to convert (got ${xp}).`
    )
  }
  return {
    blocks,
    xpDebited: blocks * XP_PER_CREDIT_BLOCK,
    creditsMinted: blocks * CREDITS_PER_BLOCK,
  }
}

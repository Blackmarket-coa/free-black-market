/**
 * The arithmetic behind the chargeback-fee assignment screen, kept apart from
 * the page so it is tested on its own (`assignment.spec.ts`). Money is held
 * in integer cents throughout; the API takes major units, so cents are
 * divided by 100 only when the request body is built.
 */

export type DisputeFeeReason = "partial_chargeback" | "missing_split_rows" | "assigned_in_part"

export const REASON_LABELS: Record<DisputeFeeReason, string> = {
  partial_chargeback:
    "Partial chargeback on a shared cart: check the dispute in Stripe to see which order it was about",
  missing_split_rows: "Shared cart without a payment record for every order",
  assigned_in_part: "Assigned before, and more is now owed (a second chargeback, or an assignment that did not finish)",
}

/**
 * Dollars typed by a person to cents. Empty is 0. Anything that is not a
 * plain amount with at most two decimals (no sign, no thousands separators)
 * is null, so it can never be rounded into a different amount silently.
 */
export function parseDollars(input: string): number | null {
  const s = input.trim()
  if (s === "") return 0
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const [whole, frac = ""] = s.split(".")
  
return Number(whole) * 100 + Number(frac.padEnd(2, "0"))
}

export const formatCents = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)

export type AssignmentDraft = {
  totalCents: number
  /** What is wrong, in words for the person; empty when it can be sent. */
  problems: string[]
  body: { allocations: Array<{ order_id: string; amount: number }>; bmc_absorbs?: number } | null
}

/**
 * What the person typed, checked: every amount a plain dollar figure, nothing
 * on an order that has not reached the ledger, and the whole adding up to
 * the unassigned fee exactly. The server checks all of it again.
 */
export function assignmentDraft(
  unassignedCents: number,
  amounts: Record<string, string>,
  absorbs: string,
  unsettled: ReadonlySet<string> = new Set()
): AssignmentDraft {
  const problems: string[] = []
  const allocations: Array<{ order_id: string; cents: number }> = []
  for (const [orderId, text] of Object.entries(amounts)) {
    const cents = parseDollars(text)
    if (cents === null) {
      problems.push(`The amount for ${orderId} is not a dollar amount`)
      continue
    }
    if (cents === 0) continue
    if (unsettled.has(orderId)) {
      problems.push(`${orderId} has not reached the ledger yet, so it cannot owe the fee`)
      continue
    }
    allocations.push({ order_id: orderId, cents })
  }
  const absorbCents = parseDollars(absorbs)
  if (absorbCents === null) problems.push("What BMC absorbs is not a dollar amount")
  const totalCents = allocations.reduce((s, a) => s + a.cents, 0) + (absorbCents ?? 0)
  if (problems.length === 0 && totalCents !== unassignedCents) {
    problems.push(`The amounts add up to ${formatCents(totalCents)}; ${formatCents(unassignedCents)} is unassigned`)
  }
  if (problems.length === 0 && allocations.length === 0 && !(absorbCents && absorbCents > 0)) {
    problems.push("Put the fee on at least one order, or say what BMC absorbs")
  }
  
return {
    totalCents,
    problems,
    body:
      problems.length === 0
        ? {
            allocations: allocations.map((a) => ({ order_id: a.order_id, amount: a.cents / 100 })),
            ...(absorbCents && absorbCents > 0 ? { bmc_absorbs: absorbCents / 100 } : {}),
          }
        : null,
  }
}

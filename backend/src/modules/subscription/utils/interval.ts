import { SubscriptionInterval } from "../types"

/**
 * One billing interval after `from`. Pure; the same calendar arithmetic
 * `SubscriptionModuleService.getNextOrderDate` has always used (that method now
 * delegates here, unchanged), so the renewal charge can compute a cycle's
 * period start without touching the service.
 *
 * Known and pre-existing: monthly/quarterly use `setMonth`, so Jan 31 + 1
 * month rolls into March. Not changed here — changing it moves every existing
 * subscriber's billing date.
 */
export function addInterval(from: Date | string, interval: SubscriptionInterval): Date {
  const lastDate = new Date(from)
  let nextDate: Date

  switch (interval) {
    case SubscriptionInterval.WEEKLY:
      nextDate = new Date(lastDate.getTime() + 7 * 24 * 60 * 60 * 1000)
      break
    case SubscriptionInterval.BIWEEKLY:
      nextDate = new Date(lastDate.getTime() + 14 * 24 * 60 * 60 * 1000)
      break
    case SubscriptionInterval.MONTHLY:
      nextDate = new Date(lastDate)
      nextDate.setMonth(nextDate.getMonth() + 1)
      break
    case SubscriptionInterval.QUARTERLY:
      nextDate = new Date(lastDate)
      nextDate.setMonth(nextDate.getMonth() + 3)
      break
    case SubscriptionInterval.YEARLY:
      nextDate = new Date(lastDate)
      nextDate.setFullYear(nextDate.getFullYear() + 1)
      break
    default:
      nextDate = new Date(lastDate)
      nextDate.setMonth(nextDate.getMonth() + 1)
  }

  return nextDate
}

import type { PayoutRecord } from "@/types"
import { money, monthLabel, shortDate, pct } from "@/lib/format"

export function PayoutRow({ p }: { p: PayoutRecord }) {
  return (
    <tr className="border-b border-moss/50">
      <td className="px-3 py-2 text-cream-100">{monthLabel(p.month)}</td>
      <td className="px-3 py-2 text-mist">{p.units_sold}</td>
      <td className="px-3 py-2 text-mist">{money(p.gross_cents)}</td>
      <td className="px-3 py-2 text-mist">{pct(p.split_pct)}</td>
      <td className="px-3 py-2 text-cream-100">{money(p.net_cents)}</td>
      <td className="px-3 py-2 text-mist">{shortDate(p.paid_at)}</td>
      <td className="px-3 py-2 text-ghost text-xs">{p.transfer_ref ?? "—"}</td>
    </tr>
  )
}

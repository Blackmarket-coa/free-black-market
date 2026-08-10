import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { AccountLoadingState } from "@/components/molecules"
import { OrderClaimSection } from "@/components/sections/OrderClaimSection/OrderClaimSection"
import { retrieveCustomerContext } from "@/lib/data/customer"
import { retrieveOrder } from "@/lib/data/orders"

export const metadata: Metadata = {
  title: "Report a Problem",
  description:
    "Tell us an order never arrived, arrived damaged, or wasn't what was described.",
}

/**
 * The escalation path for an order that cannot be returned.
 *
 * Medusa's return flow assumes the item is in the buyer's hands, so a parcel
 * that never arrived had nowhere to go — while the site promised buyers we'd
 * "step in to make it right". This is that path.
 */
export default async function OrderClaimPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const { customer, isAuthenticated } = await retrieveCustomerContext()

  if (!customer) {
    if (!isAuthenticated) return redirect("/user")
    return <AccountLoadingState title="Report a Problem" />
  }

  const order = await retrieveOrder(id)

  if (!order) {
    notFound()
  }

  return (
    <main className="container">
      <div className="max-w-2xl mt-8 mb-16">
        <h1 className="heading-md uppercase mb-6">Report a problem</h1>
        <OrderClaimSection orderId={id} />
      </div>
    </main>
  )
}

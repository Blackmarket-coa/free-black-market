import type { Metadata } from "next"
import { AccountLoadingState } from "@/components/molecules"
import { OrderReturnSection } from "@/components/sections/OrderReturnSection/OrderReturnSection"
import { retrieveCustomerContext } from "@/lib/data/customer"
import {
  retrieveOrder,
  retrieveReturnReasons,
  retriveReturnMethods,
} from "@/lib/data/orders"
import { notFound, redirect } from "next/navigation"

export const metadata: Metadata = {
  title: "Request a Return",
  description: "Submit a return request for your order.",
}

export default async function ReturnOrderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const { customer, isAuthenticated } = await retrieveCustomerContext()

  if (!customer) {
    if (!isAuthenticated) return redirect("/user")
    return <AccountLoadingState title="Return Order" />
  }

  const order = await retrieveOrder(id)

  if (!order) {
    notFound()
  }

  const returnReasons = await retrieveReturnReasons()
  const returnMethods = await retriveReturnMethods(id)

  return (
    <main className="container">
      <OrderReturnSection
        order={order}
        returnReasons={returnReasons}
        shippingMethods={returnMethods}
      />
    </main>
  )
}

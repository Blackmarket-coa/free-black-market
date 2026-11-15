import type { Metadata } from "next"
import { AccountLoadingState, LoginForm, UserNavigation } from "@/components/molecules"
import { OrderReturnRequests } from "@/components/sections/OrderReturnRequests/OrderReturnRequests"
import { retrieveCustomerContext } from "@/lib/data/customer"
import { getReturns, retrieveReturnReasons } from "@/lib/data/orders"
import { sortReturnRequestsNewestFirst } from "@/lib/helpers/return-requests"


export const metadata: Metadata = {
  title: "Your Returns",
  description: "Track and manage your return requests.",
}

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ page: string; return: string }>
}) {
  // Check authentication first
  const { customer, isAuthenticated } = await retrieveCustomerContext()

  if (!customer) {
    if (!isAuthenticated) return <LoginForm />
    return <AccountLoadingState title="Returns" />
  }

  // Fetch returns data with error handling
  const returnsData = await getReturns()
  const returnReasons = await retrieveReturnReasons()

  const { page, return: returnId } = await searchParams

  // Handle case where returns data is null or undefined
  const order_return_requests = returnsData?.order_return_requests || []

  return (
    <main className="container">
      <div className="grid grid-cols-1 md:grid-cols-4 mt-6 gap-5 md:gap-8">
        <UserNavigation />
        <div className="md:col-span-3">
          <h1 className="heading-md uppercase">Returns</h1>
          <OrderReturnRequests
            returns={sortReturnRequestsNewestFirst(order_return_requests)}
            user={customer}
            page={page}
            currentReturn={returnId || ""}
            returnReasons={returnReasons}
          />
        </div>
      </div>
    </main>
  )
}

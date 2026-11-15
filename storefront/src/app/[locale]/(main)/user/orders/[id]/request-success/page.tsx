import type { Metadata } from "next"
import { Button } from "@/components/atoms/Button/Button"
import { AccountLoadingState } from "@/components/molecules"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { UserNavigation } from "@/components/molecules/UserNavigation/UserNavigation"
import { retrieveCustomerContext } from "@/lib/data/customer"
import { retrieveOrder } from "@/lib/data/orders"
import { notFound, redirect } from "next/navigation"


export const metadata: Metadata = {
  title: "Return Request Submitted",
  description: "Your return request was submitted successfully.",
}

export default async function RequestSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ return?: string }>
}) {
  const { id } = await params
  // `id` is the order; the returns flow passes the new return's id so the
  // link below opens that request on /user/returns.
  const { return: returnId } = await searchParams

  const { customer, isAuthenticated } = await retrieveCustomerContext()

  if (!customer) {
    if (!isAuthenticated) return redirect("/user")
    return <AccountLoadingState title="Return Requested" />
  }

  const order = await retrieveOrder(id)

  if (!order) {
    notFound()
  }

  return (
    <main className="container">
      <div className="grid grid-cols-1 md:grid-cols-4 mt-6 gap-5 md:gap-8">
        <UserNavigation />
        <div className="md:col-span-3 text-center">
          <h1 className="heading-md uppercase">Return requested</h1>
          <p className="label-md text-secondary w-96 mx-auto my-8">
            Your return request has been sent to the seller. You can follow it
            on your Returns page.
          </p>
          <LocalizedClientLink
            href={`/user/returns${returnId ? `?return=${returnId}` : ""}`}
          >
            <Button className="label-md uppercase px-12 py-3">
              Return details
            </Button>
          </LocalizedClientLink>
        </div>
      </div>
    </main>
  )
}

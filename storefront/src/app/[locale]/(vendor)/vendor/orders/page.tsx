import type { Metadata } from "next"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { VendorSignIn } from "@/components/sections/VendorSignIn/VendorSignIn"
import { VendorOrderList } from "@/components/sections/VendorOrderList/VendorOrderList"
import { VendorPushRegistrar } from "@/components/providers/VendorPushRegistrar"
import { VendorSessionControls } from "@/components/sections/VendorSessionControls/VendorSessionControls"
import { retrieveSellerSession } from "@/lib/data/vendor-auth"
import { listVendorOrders } from "@/lib/data/vendor-orders"

export const metadata: Metadata = {
  title: "Vendor Orders",
  description: "Orders that need you, and the actions to move them along.",
}

/**
 * The vendor order inbox — the surface a seller lands on from an order
 * push. Renders sign-in inline rather than redirecting, so a push tap
 * never dead-ends on a page the vendor can't reach.
 */
export default async function VendorOrdersPage() {
  const session = await retrieveSellerSession()

  if (!session) {
    return <VendorSignIn />
  }

  const result = await listVendorOrders()

  return (
    <div className="flex flex-col gap-4">
      <VendorPushRegistrar />
      <VendorSessionControls />
      <h1 className="heading-md">Orders</h1>
      {result.ok ? (
        <VendorOrderList orders={result.orders} />
      ) : (
        <div className="border rounded-sm p-6 text-center" role="alert">
          <p className="label-lg mb-1">Couldn&apos;t load your orders</p>
          <p className="label-md text-secondary mb-4">{result.error}</p>
          {/* A plain link, not a client handler: re-requesting the page is
              the retry, and it works with JS still booting. */}
          <LocalizedClientLink href="/vendor/orders" className="label-md underline">
            Try again
          </LocalizedClientLink>
        </div>
      )}
    </div>
  )
}

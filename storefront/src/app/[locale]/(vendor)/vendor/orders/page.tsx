import type { Metadata } from "next"
import { VendorSignIn } from "@/components/sections/VendorSignIn/VendorSignIn"
import { VendorOrderList } from "@/components/sections/VendorOrderList/VendorOrderList"
import { VendorPushRegistrar } from "@/components/providers/VendorPushRegistrar"
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

  const orders = await listVendorOrders()

  return (
    <div className="flex flex-col gap-4">
      <VendorPushRegistrar />
      <h1 className="heading-md">Orders</h1>
      <VendorOrderList orders={orders} />
    </div>
  )
}

import type { Metadata } from "next"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { VendorSignIn } from "@/components/sections/VendorSignIn/VendorSignIn"
import { VendorOrderActions } from "@/components/sections/VendorOrderActions/VendorOrderActions"
import { retrieveSellerSession } from "@/lib/data/vendor-auth"
import { retrieveVendorOrder } from "@/lib/data/vendor-orders"
import { convertToLocale } from "@/lib/helpers/money"
import {
  vendorOrderStage,
  vendorOrderStageLabel,
} from "@/lib/helpers/vendor-orders"

export const metadata: Metadata = {
  title: "Vendor Order",
  description: "Order detail and fulfillment actions.",
}

export default async function VendorOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await retrieveSellerSession()
  if (!session) {
    return <VendorSignIn />
  }

  const { id } = await params
  const lookup = await retrieveVendorOrder(id)

  if (!lookup.ok) {
    return (
      <div className="flex flex-col gap-4" role="alert">
        <p className="label-lg">
          {lookup.reason === "unavailable"
            ? "Couldn't load this order"
            : "Order not found"}
        </p>
        <p className="label-md text-secondary">
          {lookup.reason === "unavailable"
            ? "We couldn't reach the store. Check your connection and try again."
            : "It may belong to another vendor account, or it may have been removed."}
        </p>
        <LocalizedClientLink href="/vendor/orders" className="underline label-md">
          Back to orders
        </LocalizedClientLink>
      </div>
    )
  }

  const order = lookup.order

  const stage = vendorOrderStage(order)
  const address = order.shipping_address

  return (
    <div className="flex flex-col gap-5">
      <div>
        <LocalizedClientLink
          href="/vendor/orders"
          className="label-md text-secondary underline"
        >
          ← All orders
        </LocalizedClientLink>
      </div>

      <div className="flex justify-between items-start gap-3">
        <h1 className="heading-md">#{order.display_id ?? order.id}</h1>
        <span className="label-md text-secondary">
          {vendorOrderStageLabel(stage)}
        </span>
      </div>

      <VendorOrderActions orderId={order.id} stage={stage} />

      {order.items && order.items.length > 0 ? (
        <section className="border rounded-sm p-4">
          <h2 className="label-lg mb-3">Items</h2>
          <ul className="flex flex-col gap-2">
            {order.items.map((item, index) => (
              <li
                key={item.id ?? `${item.title}-${index}`}
                className="flex justify-between gap-3 label-md"
              >
                <span className="truncate">{item.title ?? "Item"}</span>
                <span className="text-secondary whitespace-nowrap">
                  × {item.quantity ?? 0}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="border rounded-sm p-4">
        <h2 className="label-lg mb-3">Ship to</h2>
        {address ? (
          <address className="label-md text-secondary not-italic whitespace-pre-line">
            {[
              `${address.first_name ?? ""} ${address.last_name ?? ""}`.trim(),
              address.address_1,
              address.address_2,
              [address.city, address.province, address.postal_code]
                .filter(Boolean)
                .join(", "),
              address.country_code?.toUpperCase(),
              address.phone,
            ]
              .filter(Boolean)
              .join("\n")}
          </address>
        ) : (
          <p className="label-md text-secondary">No shipping address on file.</p>
        )}
      </section>

      <section className="border rounded-sm p-4 flex justify-between items-center">
        <span className="label-lg">Total</span>
        <span className="label-lg">
          {convertToLocale({
            amount: order.total ?? 0,
            currency_code: order.currency_code ?? "",
          })}
        </span>
      </section>
    </div>
  )
}

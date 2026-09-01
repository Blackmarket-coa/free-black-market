import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import Image from "next/image"

/**
 * Thin chrome for the in-app vendor surface.
 *
 * Deliberately NOT the (main) layout: that one runs a region check that
 * hard-redirects on failure, renders a Header that makes five backend
 * calls per paint, and mounts the MobileLauncher — whose bottom-centre FAB
 * would sit on top of the primary fulfillment action, and whose five
 * destinations are all shopper pages. A vendor arriving from a push
 * notification should get their order, not the storefront.
 */
export default async function VendorLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <>
      <header className="border-b">
        <div className="flex items-center justify-between w-full py-3 px-4 lg:px-8">
          <LocalizedClientLink href="/vendor/orders" className="font-bold">
            <Image src="/Logo.svg" width={100} height={32} alt="Logo" priority />
          </LocalizedClientLink>
          <span className="label-md text-secondary uppercase tracking-wide">
            Vendor
          </span>
        </div>
      </header>
      <main className="container py-4">{children}</main>
    </>
  )
}

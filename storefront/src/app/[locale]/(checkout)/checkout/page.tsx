import PaymentWrapper from "@/components/organisms/PaymentContainer/PaymentWrapper"
import { CartAddressSection } from "@/components/sections/CartAddressSection/CartAddressSection"
import CartPaymentSection from "@/components/sections/CartPaymentSection/CartPaymentSection"
import CartReview from "@/components/sections/CartReview/CartReview"

import CartShippingMethodsSection from "@/components/sections/CartShippingMethodsSection/CartShippingMethodsSection"
import { retrieveCart } from "@/lib/data/cart"
import { retrieveCustomer } from "@/lib/data/customer"
import { listCartShippingMethods } from "@/lib/data/fulfillment"
import { listCartPaymentMethods } from "@/lib/data/payment"
import { Metadata } from "next"
import { getDonationSettings, listDonationBeneficiaries } from "@/lib/data/donations"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { CheckoutProgress } from "@/components/molecules/CheckoutProgress/CheckoutProgress"

export const metadata: Metadata = {
  title: "Checkout",
  description: "My cart",
}

/** Skeleton loader for checkout page */
function CheckoutSkeleton() {
  return (
    <main className="container py-8">
      {/* Progress skeleton */}
      <div className="flex justify-center mb-8">
        <div className="flex items-center gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-gray-200 animate-pulse" />
              {i < 3 && <div className="w-16 h-1 bg-gray-200 animate-pulse" />}
            </div>
          ))}
        </div>
      </div>
      
      <div className="grid lg:grid-cols-11 gap-8">
        {/* Left column - forms */}
        <div className="flex flex-col gap-4 lg:col-span-6">
          {/* Address section skeleton */}
          <div className="border p-4 rounded-sm bg-white animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-48 mb-6" />
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="h-12 bg-gray-200 rounded" />
                <div className="h-12 bg-gray-200 rounded" />
              </div>
              <div className="h-12 bg-gray-200 rounded" />
              <div className="grid grid-cols-2 gap-4">
                <div className="h-12 bg-gray-200 rounded" />
                <div className="h-12 bg-gray-200 rounded" />
              </div>
              <div className="h-12 bg-gray-200 rounded w-32" />
            </div>
          </div>
          
          {/* Shipping section skeleton */}
          <div className="border p-4 rounded-sm bg-white animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-40 mb-6" />
            <div className="space-y-3">
              <div className="h-16 bg-gray-200 rounded" />
              <div className="h-16 bg-gray-200 rounded" />
            </div>
          </div>
          
          {/* Payment section skeleton */}
          <div className="border p-4 rounded-sm bg-white animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-32 mb-6" />
            <div className="space-y-3">
              <div className="h-16 bg-gray-200 rounded" />
              <div className="h-16 bg-gray-200 rounded" />
            </div>
          </div>
        </div>

        {/* Right column - order summary */}
        <div className="lg:col-span-5">
          <div className="border p-4 rounded-sm bg-white animate-pulse sticky top-4">
            <div className="h-6 bg-gray-200 rounded w-32 mb-4" />
            <div className="space-y-3 mb-6">
              <div className="flex gap-4">
                <div className="w-20 h-20 bg-gray-200 rounded" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-20 h-20 bg-gray-200 rounded" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            </div>
            <div className="border-t pt-4 space-y-2">
              <div className="flex justify-between">
                <div className="h-4 bg-gray-200 rounded w-20" />
                <div className="h-4 bg-gray-200 rounded w-16" />
              </div>
              <div className="flex justify-between">
                <div className="h-4 bg-gray-200 rounded w-16" />
                <div className="h-4 bg-gray-200 rounded w-16" />
              </div>
              <div className="flex justify-between pt-2 border-t">
                <div className="h-6 bg-gray-200 rounded w-16" />
                <div className="h-6 bg-gray-200 rounded w-20" />
              </div>
            </div>
            <div className="h-12 bg-gray-200 rounded mt-6" />
          </div>
        </div>
      </div>
    </main>
  )
}

export default async function CheckoutPage({}) {
  return (
    <Suspense fallback={<CheckoutSkeleton />}>
      <CheckoutPageContent />
    </Suspense>
  )
}

async function CheckoutPageContent({}) {
  const cart = await retrieveCart()

  if (!cart) {
    return notFound()
  }

  const shippingMethods = await listCartShippingMethods(cart.id, false)
  const paymentMethods = await listCartPaymentMethods(cart.region?.id ?? "")
  const customer = await retrieveCustomer()
  const [beneficiaries, donationSettings] = await Promise.all([
    listDonationBeneficiaries(),
    getDonationSettings(),
  ])

  return (
    <PaymentWrapper cart={cart}>
      <main className="container">
        {/* Checkout Progress Indicator */}
        <CheckoutProgress cart={cart} />
        
        <div className="grid lg:grid-cols-11 gap-8">
          <div className="flex flex-col gap-4 lg:col-span-6">
            <CartAddressSection cart={cart} customer={customer} />
            <CartShippingMethodsSection
              cart={cart}
              availableShippingMethods={shippingMethods as any}
            />
            <CartPaymentSection
              cart={cart}
              availablePaymentMethods={paymentMethods}
            />
          </div>

          <div className="lg:col-span-5">
            <CartReview cart={cart} beneficiaries={beneficiaries} donationSettings={donationSettings} />
          </div>
        </div>
      </main>
    </PaymentWrapper>
  )
}

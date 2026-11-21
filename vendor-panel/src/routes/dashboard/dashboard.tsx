import { useEffect, useState } from "react"
import { Alert, Button, Container, Heading, Text } from "@medusajs/ui"
import { useOnboarding, useOrders } from "../../hooks/api"
import { DashboardCharts } from "./components/dashboard-charts"
import { DashboardOnboarding } from "./components/dashboard-onboarding"
import { EconomicStandingCard } from "./components/economic-standing-card"
import { ChartSkeleton } from "./components/chart-skeleton"
import { useReviews } from "../../hooks/api/review"
import { useSellingSetup } from "../../hooks/api/selling-setup"
import { isFetchError } from "../../lib/is-fetch-error"
import { isStoreSetUp } from "./config/dashboard-config"

export const Dashboard = () => {
  const [isClient, setIsClient] = useState(false)
  useEffect(() => setIsClient(true), [])

  if (!isClient) return null

  return <DashboardContent />
}

/** The dashboard once the page is in the browser: setup, or the store's numbers. */
export const DashboardContent = () => {
  const {
    onboarding,
    isError: isOnboardingError,
    error: onboardingError,
    isPending,
    refetch: refetchOnboarding,
  } = useOnboarding()

  const {
    orders,
    isPending: isPendingOrders,
    isError: isOrdersError,
    error: ordersError,
    refetch: refetchOrders,
  } = useOrders()
  const {
    reviews,
    isPending: isPendingReviews,
    isError: isReviewsError,
    error: reviewsError,
    refetch: refetchReviews,
  } = useReviews()
  // Whether a buyer could check out: Mercur's onboarding flags do not say.
  // Not asked for a store buyers have already ordered from, which is past
  // setup whatever this would answer (isStoreSetUp).
  const hasOrders = (orders?.length ?? 0) > 0
  const needsSelling = !isPendingOrders && !isOrdersError && !hasOrders
  const {
    data: selling,
    isPending: isSellingUnread,
    isError: isSellingFailed,
    error: sellingError,
    refetch: refetchSelling,
  } = useSellingSetup({ enabled: needsSelling })
  const isPendingSelling = needsSelling && isSellingUnread
  const isSellingError = needsSelling && isSellingFailed

  const notFulfilledOrders =
    orders?.filter((order) => order.fulfillment_status === "not_fulfilled")
      .length || 0
  const fulfilledOrders =
    orders?.filter((order) => order.fulfillment_status === "fulfilled")
      .length || 0
  const reviewsToReply =
    reviews?.filter((review: any) => !review?.seller_note).length || 0

  if (isPending || isPendingOrders || isPendingReviews || isPendingSelling) {
    return (
      <div>
        <ChartSkeleton />
      </div>
    )
  }

  // An unreadable store is not a set-up one: the error is shown, with Retry.
  if (isOnboardingError || isOrdersError || isReviewsError || isSellingError) {
    const error = onboardingError || ordersError || reviewsError || sellingError
    const errorMessage = isFetchError(error)
      ? error.status === 401
        ? "Your session has expired. Please sign in again."
        : error.status === 500
          ? "We couldn't reach the server. Please try again shortly."
          : error.message
      : "We couldn't load your dashboard data. Please try again."

    return (
      <Container className="p-6">
        <Alert variant="error" className="mb-4">
          {errorMessage}
        </Alert>
        <div className="flex items-center justify-between">
          <div>
            <Heading level="h2" className="text-lg">
              Dashboard data unavailable
            </Heading>
            <Text className="text-ui-fg-subtle" size="small">
              We hit a problem loading orders, reviews, or onboarding data.
            </Text>
          </div>
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              refetchOnboarding()
              refetchOrders()
              refetchReviews()
              refetchSelling()
            }}
          >
            Retry
          </Button>
        </div>
      </Container>
    )
  }

  if (
    !isStoreSetUp({
      onboarding,
      selling,
      orderCount: orders?.length ?? 0,
    })
  )
    return (
      <DashboardOnboarding
        selling={selling}
        store_information={onboarding?.store_information}
        // Mercur's field is `stripe_connection`. The dashboard read
        // `stripe_connect`, which no response carries.
        stripe_connection={onboarding?.stripe_connection}
        menu={onboarding?.menu}
        plots={onboarding?.plots}
        volunteers={onboarding?.volunteers}
        seasons={onboarding?.seasons}
        harvests={onboarding?.harvests}
        support={onboarding?.support}
      />
    )

  return (
    <div className="flex flex-col gap-4">
      <DashboardCharts
        notFulfilledOrders={notFulfilledOrders}
        fulfilledOrders={fulfilledOrders}
        reviewsToReply={reviewsToReply}
      />
      <EconomicStandingCard />
    </div>
  )
}

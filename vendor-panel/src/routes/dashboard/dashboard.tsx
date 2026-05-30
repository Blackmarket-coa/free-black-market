import { useEffect, useState } from "react"
import { Alert, Button, Container, Heading, Text } from "@medusajs/ui"
import { useOnboarding, useOrders } from "../../hooks/api"
import { DashboardCharts } from "./components/dashboard-charts"
import { DashboardOnboarding } from "./components/dashboard-onboarding"
import { EconomicStandingCard } from "./components/economic-standing-card"
import { ChartSkeleton } from "./components/chart-skeleton"
import { useReviews } from "../../hooks/api/review"
import { isFetchError } from "../../lib/is-fetch-error"

export const Dashboard = () => {
  const [isClient, setIsClient] = useState(false)
  useEffect(() => setIsClient(true), [])

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

  const notFulfilledOrders =
    orders?.filter((order) => order.fulfillment_status === "not_fulfilled")
      .length || 0
  const fulfilledOrders =
    orders?.filter((order) => order.fulfillment_status === "fulfilled")
      .length || 0
  const reviewsToReply =
    reviews?.filter((review: any) => !review?.seller_note).length || 0

  if (!isClient) return null

  if (isPending || isPendingOrders || isPendingReviews) {
    return (
      <div>
        <ChartSkeleton />
      </div>
    )
  }

  if (isOnboardingError || isOrdersError || isReviewsError) {
    const error = onboardingError || ordersError || reviewsError
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
            }}
          >
            Retry
          </Button>
        </div>
      </Container>
    )
  }

  if (
    !onboarding?.products ||
    !onboarding?.locations_shipping ||
    !onboarding?.store_information
    // !onboarding?.stripe_connect
  )
    return (
      <DashboardOnboarding
        products={onboarding?.products}
        locations_shipping={onboarding?.locations_shipping}
        store_information={onboarding?.store_information}
        stripe_connect={onboarding?.stripe_connect}
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

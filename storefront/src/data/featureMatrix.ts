import { PROCESSING_COPY, processingCopy, type ProcessingInfo } from "@/lib/helpers/processing-copy"

export type FeatureMatrixStatus = "Available now" | "In rollout"
export type FeatureMatrixBucket = "Goods" | "Services" | "Community Programs"

export type FeatureMatrixItem = {
  capability: string
  status: FeatureMatrixStatus
  bucket: FeatureMatrixBucket
  description: string
  proofHref: string
  proofLabel: string
}

export const featureMatrixItems: FeatureMatrixItem[] = [
  {
    capability: "Multi-vendor storefront",
    status: "Available now",
    bucket: "Goods",
    description: "Customers can browse many vendor shops and purchase across distinct provider pages.",
    proofHref: "/vendors",
    proofLabel: "Browse vendor directory",
  },
  {
    capability: "Stripe direct payouts",
    status: "Available now",
    bucket: "Goods",
    description: PROCESSING_COPY.featureMatrixPayouts.legacy,
    proofHref: "/sell",
    proofLabel: "See vendor onboarding",
  },
  {
    capability: "Subscriptions",
    status: "Available now",
    bucket: "Community Programs",
    description: "Recurring and CSA-style selling models are supported for ongoing community offerings.",
    proofHref: "/what-you-sell#subscriptions-csa",
    proofLabel: "View subscription model",
  },
  {
    capability: "CSA share management",
    status: "Available now",
    bucket: "Community Programs",
    description: "Producers can run seasonal shares with clear buyer expectations.",
    proofHref: "/vendor-types",
    proofLabel: "See producer + garden workflows",
  },
  {
    capability: "Event ticketing",
    status: "Available now",
    bucket: "Services",
    description: "Vendors can publish event-style offers for community programming and attendance.",
    proofHref: "/what-you-sell#event-tickets",
    proofLabel: "See event ticket setup",
  },
  {
    capability: "Digital downloads",
    status: "Available now",
    bucket: "Goods",
    description: "Creators can sell downloadable products with immediate buyer delivery.",
    proofHref: "/what-you-sell#digital-products",
    proofLabel: "See digital product flow",
  },
  {
    capability: "Local pickup / delivery",
    status: "Available now",
    bucket: "Goods",
    description: "Local commerce routes include pickup and delivery options for neighborhood access.",
    proofHref: "/how-it-works",
    proofLabel: "Review fulfillment model",
  },
  {
    capability: "Vendor messaging",
    status: "Available now",
    bucket: "Services",
    description: "Buyer-vendor messaging enables coordination and support directly in platform workflows.",
    proofHref: "/vendor-types",
    proofLabel: "See messaging capabilities",
  },
  {
    capability: "Impact tracking",
    status: "In rollout",
    bucket: "Community Programs",
    description: "Community outcome visibility is being expanded for transparent local economic impact.",
    proofHref: "/community-resources",
    proofLabel: "Read community infrastructure context",
  },
]

export const featureMatrixBuckets: FeatureMatrixBucket[] = ["Goods", "Services", "Community Programs"]

/**
 * The matrix with its one processing sentence rendered from
 * `/store/fee-schedule`'s processing model (Black Mask F6). Absent, this is
 * `featureMatrixItems` exactly.
 */
export function featureMatrixItemsFor(
  processing: ProcessingInfo,
  feePercent = 3
): FeatureMatrixItem[] {
  return featureMatrixItems.map((item) =>
    item.description === PROCESSING_COPY.featureMatrixPayouts.legacy
      ? { ...item, description: processingCopy("featureMatrixPayouts", processing, feePercent) }
      : item
  )
}

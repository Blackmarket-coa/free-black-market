import { StubPage } from "@bmc/ui"

export function ListingsPage() {
  return (
    <StubPage
      title="Listings & Order Cycles"
      icon="🏷️"
      summary="Publish finished goods to the FBM storefront and run Order Cycles."
      planned={[
        "Active listings — price/inventory quick-edit, filter by pathway",
        "Order Cycles — create, live order count, fulfillment status",
        "Subscription boxes — curated multi-pathway product bundles",
        "Retail vs wholesale listing toggle per finished good",
      ]}
    />
  )
}

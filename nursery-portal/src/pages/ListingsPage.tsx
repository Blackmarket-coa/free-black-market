import { StubPage } from "@/components/ui/StubPage"

export function ListingsPage() {
  return (
    <StubPage
      title="Listings & Order Cycles"
      icon="🏷️"
      summary="Manage FBM listings, run Order Cycles, and activate demand pool species."
      planned={[
        "Active listings — price/inventory quick-edit, category filter",
        "Order Cycles — create, live order count, fulfillment status",
        "Demand Pool — activate production for requested species",
        "Wholesale listings — plug trays with wholesale pricing",
      ]}
    />
  )
}

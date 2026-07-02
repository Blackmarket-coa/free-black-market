import { useParams } from "react-router-dom"
import { useOrderReturnRequest } from "../../../hooks/api/requests"
import { RouteDrawer } from "../../../components/modals"
import { Badge, Heading, Text } from "@medusajs/ui"

export function RequestOrderReturn() {
  const { id } = useParams()

  const { order_return_request, isLoading } = useOrderReturnRequest(id!)

  if (isLoading) {
    return <div>Loading...</div>
  }

  const order = order_return_request?.order
  const customer = order?.customer
  const items = order_return_request?.items ?? []

  return (
    <RouteDrawer prev="/requests/orders">
      <RouteDrawer.Header>
        <RouteDrawer.Title>
          Return Order {order?.display_id ? `#${order.display_id}` : ""}
        </RouteDrawer.Title>
      </RouteDrawer.Header>
      <RouteDrawer.Body>
        <div className="flex flex-col gap-y-4">
          <div className="flex items-center justify-between">
            <Text size="small" className="text-ui-fg-subtle">
              Status
            </Text>
            {order_return_request?.status && (
              <Badge className="uppercase">{order_return_request.status}</Badge>
            )}
          </div>
          {customer && (
            <div className="flex items-center justify-between">
              <Text size="small" className="text-ui-fg-subtle">
                Customer
              </Text>
              <Text size="small">
                {`${customer.first_name ?? ""} ${
                  customer.last_name ?? ""
                }`.trim() || customer.email}
              </Text>
            </div>
          )}
          <div>
            <Heading level="h3" className="mb-2">
              Items
            </Heading>
            {items.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                No items on this return.
              </Text>
            ) : (
              <ul className="flex flex-col gap-y-1">
                {items.map((item: any) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between"
                  >
                    <Text size="small">{item.title ?? item.item_id}</Text>
                    <Text size="small" className="text-ui-fg-subtle">
                      × {item.quantity ?? item.requested_quantity ?? 0}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </RouteDrawer.Body>
    </RouteDrawer>
  )
}

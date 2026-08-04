import { OrderListTable } from "./components/order-list-table"
import { ChannelOrders } from "./components/channel-orders"

import { SingleColumnPage } from "../../../components/layout/pages"
import { useDashboardExtension } from "../../../extensions"

export const OrderList = () => {
  const { getWidgets } = useDashboardExtension()

  return (
    <SingleColumnPage
      widgets={{
        after: getWidgets("order.list.after"),
        before: getWidgets("order.list.before"),
      }}
      hasOutlet={false}
    >
      <OrderListTable />
      {/* Channel orders live on the same page as FBM orders — a vendor should
          not have to remember which screen a sale is on depending on where it
          happened. Renders nothing when no channel is connected. */}
      <ChannelOrders />
    </SingleColumnPage>
  )
}

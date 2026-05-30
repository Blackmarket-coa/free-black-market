import { CalendarMini, TriangleRightMini, ShoppingCart, Envelope, Star, TruckFast, LightBulb } from "@medusajs/icons"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  Badge,
  Button,
  Container,
  DateRange,
  Heading,
  Popover,
  Text,
} from "@medusajs/ui"
import { Link, useSearchParams } from "react-router-dom"
import { useStatistics } from "../../../hooks/api"
import { ChartSkeleton } from "./chart-skeleton"
import { useMemo, useState } from "react"
import { addDays, differenceInDays, format, parseISO } from "date-fns"
import { Calendar } from "../../../components/common/calendar/calendar"
import { useMatrixChat } from "../../../providers/matrix-provider"
import { CopyStorefrontLink } from "./copy-storefront-link"

// Quick actions for established vendors
const QUICK_ACTIONS = [
  {
    title: "Add New Product",
    description: "List a new item for sale",
    link: "/products/create",
    icon: ShoppingCart,
    color: "blue",
  },
  {
    title: "View All Orders",
    description: "Manage your orders",
    link: "/orders",
    icon: TruckFast,
    color: "green",
  },
  {
    title: "Check Reviews",
    description: "See customer feedback",
    link: "/reviews",
    icon: Star,
    color: "orange",
  },
  {
    title: "Messages",
    description: "Customer inquiries",
    link: "/messages",
    icon: Envelope,
    color: "purple",
  },
]

const colorPicker = (line: string) => {
  switch (line) {
    case "customers":
      return "#2563eb"
    case "orders":
      return "#60a5fa"
    default:
      return ""
  }
}

const generateChartData = ({
  range,
  customers,
  orders,
}: {
  range: DateRange | undefined
  customers: { date: string; count: string }[]
  orders: { date: string; count: string }[]
}) => {
  const from = range?.from ?? addDays(new Date(), -7)
  const to = range?.to ?? new Date()
  const dayCount = differenceInDays(to, from)
  const ordersByDate = new Map(
    orders.map((item) => [format(new Date(item.date), "yyyy-MM-dd"), Number(item.count) || 0])
  )
  const customersByDate = new Map(
    customers.map((item) => [format(new Date(item.date), "yyyy-MM-dd"), Number(item.count) || 0])
  )
  const res = Array.from({ length: dayCount + 1 }, (_, index) => {
    const current = addDays(from, index)
    const key = format(current, "yyyy-MM-dd")
    return {
      date: key,
      orders: ordersByDate.get(key) ?? 0,
      customers: customersByDate.get(key) ?? 0,
    }
  })

  return res
}

export const DashboardCharts = ({
  notFulfilledOrders,
  fulfilledOrders,
  reviewsToReply,
}: {
  notFulfilledOrders: number
  fulfilledOrders: number
  reviewsToReply: number
}) => {
  const [searchParams, setSearchParams] = useSearchParams()

  const [filters, setFilters] = useState(["customers", "orders"])

  const { unreadCount, isConfigured: isMatrixConfigured } = useMatrixChat()

  const quickActions = useMemo(
    () => [
      ...QUICK_ACTIONS,
      {
        title: "Video Chat",
        description: isMatrixConfigured ? "Start a call in chat" : "Enable Blackout Chat to use video",
        link: "/messages",
        icon: CalendarMini,
        color: "indigo",
      },
    ],
    [isMatrixConfigured]
  )

  const from = useMemo(() => {
    const value = searchParams.get("from")
    return value ? parseISO(value) : addDays(new Date(), -7)
  }, [searchParams])
  const to = useMemo(() => {
    const value = searchParams.get("to")
    return value ? parseISO(value) : new Date()
  }, [searchParams])

  const updateDateRange = (newFrom: Date, newTo: Date) => {
    const newSearchParams = new URLSearchParams(searchParams)
    newSearchParams.set("from", format(newFrom, "yyyy-MM-dd"))
    newSearchParams.set("to", format(newTo, "yyyy-MM-dd"))
    setSearchParams(newSearchParams)
  }

  const { customers = [], orders = [], isPending } = useStatistics({
    from: format(from, "yyyy-MM-dd"),
    to: format(to, "yyyy-MM-dd"),
  })

  const chartData = useMemo(
    () =>
      generateChartData({
        range: { from, to },
        customers,
        orders,
      }),
    [customers, from, orders, to]
  )

  const totals = useMemo(
    () =>
      chartData.reduce(
        (acc, curr) => {
          return {
            orders: acc.orders + curr.orders,
            customers: acc.customers + curr.customers,
          }
        },
        { orders: 0, customers: 0 }
      ),
    [chartData]
  )

  const filterSet = useMemo(() => new Set(filters), [filters])

  const handleFilter = (label: string) => {
    if (filters.find((item) => item === label)) {
      setFilters(filters.filter((item) => item !== label))
    } else {
      setFilters([...filters, label])
    }
  }

  return (
    <>
      {/* Welcome Back Header */}
      <Container className="p-0 mb-4">
        <div className="px-6 py-6 bg-gradient-to-r from-ui-bg-subtle to-ui-bg-base">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <Heading level="h1" className="text-2xl mb-2">Welcome Back! 👋</Heading>
              <Text className="text-ui-fg-subtle">
                Here's what's happening with your store today. Check your pending tasks and track your progress.
              </Text>
            </div>
            <div className="lg:min-w-[320px]">
              <CopyStorefrontLink />
            </div>
          </div>
        </div>
      </Container>

      {/* Action Items - Tasks that need attention */}
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Heading>Tasks Needing Attention</Heading>
              {(notFulfilledOrders > 0 || reviewsToReply > 0 || unreadCount > 0) && (
                <Badge color="red" size="xsmall">
                  {notFulfilledOrders + reviewsToReply + unreadCount}
                </Badge>
              )}
            </div>
            <Text className="text-ui-fg-subtle" size="small">
              Complete these tasks to keep your customers happy
            </Text>
          </div>
        </div>
        <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <Link to="/orders?order_status=not_fulfilled">
            <Button
              variant="secondary"
              className="w-full justify-between py-4 h-full hover:border-ui-tag-orange-border transition-colors"
            >
              <div className="flex gap-4 items-center">
                <Badge color={notFulfilledOrders > 0 ? "orange" : "grey"}>{notFulfilledOrders}</Badge>
                <div className="text-left">
                  <div className="font-medium">Orders to fulfill</div>
                  <div className="text-xs text-ui-fg-subtle">Pack & ship orders</div>
                </div>
              </div>
              <TriangleRightMini color="grey" />
            </Button>
          </Link>
          <Link to="/orders?order_status=fulfilled">
            <Button
              variant="secondary"
              className="w-full justify-between py-4 h-full hover:border-ui-tag-blue-border transition-colors"
            >
              <div className="flex gap-4 items-center">
                <Badge color={fulfilledOrders > 0 ? "blue" : "grey"}>{fulfilledOrders}</Badge>
                <div className="text-left">
                  <div className="font-medium">Ready to ship</div>
                  <div className="text-xs text-ui-fg-subtle">Mark as shipped</div>
                </div>
              </div>
              <TriangleRightMini color="grey" />
            </Button>
          </Link>
          <Link to="/reviews?seller_note=false">
            <Button
              variant="secondary"
              className="w-full justify-between py-4 h-full hover:border-ui-tag-green-border transition-colors"
            >
              <div className="flex gap-4 items-center">
                <Badge color={reviewsToReply > 0 ? "green" : "grey"}>{reviewsToReply}</Badge>
                <div className="text-left">
                  <div className="font-medium">Reviews to reply</div>
                  <div className="text-xs text-ui-fg-subtle">Thank your customers</div>
                </div>
              </div>
              <TriangleRightMini color="grey" />
            </Button>
          </Link>
          <Link to="/messages">
            <Button
              variant="secondary"
              className="w-full justify-between py-4 h-full hover:border-ui-tag-purple-border transition-colors"
            >
              <div className="flex gap-4 items-center">
                <Badge color={unreadCount > 0 ? "purple" : "grey"}>{unreadCount}</Badge>
                <div className="text-left">
                  <div className="font-medium">Unread messages</div>
                  <div className="text-xs text-ui-fg-subtle">Customer inquiries</div>
                </div>
              </div>
              <TriangleRightMini color="grey" />
            </Button>
          </Link>
        </div>
      </Container>

      {/* Quick Actions */}
      <Container className="p-0 mt-4">
        <div className="px-6 py-4 border-b border-ui-border-base">
          <Heading>Quick Actions</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Common tasks to manage your store
          </Text>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-y md:divide-y-0 divide-ui-border-base">
          {quickActions.map((action, index) => (
            <Link
              key={index}
              to={action.link}
              className="flex flex-col items-center p-6 hover:bg-ui-bg-subtle transition-colors group text-center"
            >
              <div className="p-3 rounded-lg bg-ui-bg-subtle group-hover:bg-ui-bg-base mb-3 transition-colors">
                <action.icon className="w-6 h-6 text-ui-fg-muted" />
              </div>
              <Text className="font-medium text-ui-fg-base">{action.title}</Text>
              <Text className="text-ui-fg-subtle text-xs">{action.description}</Text>
            </Link>
          ))}
        </div>
      </Container>

      {/* Analytics Section */}
      <Container className="divide-y p-0 mt-4">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Heading>Analytics</Heading>
              <Badge size="xsmall" color="blue">
                {differenceInDays(to, from) + 1} days
              </Badge>
            </div>
            <Text className="text-ui-fg-subtle" size="small">
              Track your store's performance over time. Click the legend to toggle metrics.
            </Text>
          </div>
          <div>
            <Popover>
              <Popover.Trigger asChild>
                <Button variant="secondary">
                  <CalendarMini />
                  {from ? (
                    to ? (
                      <>
                        {format(from, "LLL dd, y")} - {format(to, "LLL dd, y")}
                      </>
                    ) : (
                      format(from, "LLL dd, y")
                    )
                  ) : (
                    <span>Pick a date</span>
                  )}
                </Button>
              </Popover.Trigger>
              <Popover.Content>
                <Calendar
                  mode="range"
                  selected={{ from, to }}
                  onSelect={(range) =>
                    range?.from && range?.to && updateDateRange(range.from, range.to)
                  }
                  numberOfMonths={2}
                  defaultMonth={from}
                />
              </Popover.Content>
            </Popover>
          </div>
        </div>
        <div className="relative px-6 py-4 grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="col-span-3 relative h-[150px] md:h-[300px] w-[calc(100%-2rem)]">
            {isPending ? (
              <ChartSkeleton />
            ) : chartData.length === 0 || (totals.orders === 0 && totals.customers === 0) ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <LightBulb className="w-12 h-12 text-ui-fg-muted mb-4" />
                <Text className="font-medium text-ui-fg-base">No data yet for this period</Text>
                <Text className="text-ui-fg-subtle text-sm max-w-sm mt-2">
                  As you make sales and attract customers, your analytics will appear here. 
                  Keep promoting your products!
                </Text>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis dataKey="date" />
                  <YAxis />
                  <CartesianGrid stroke="#333" vertical={false} />
                  <Tooltip content={<CustomTooltip />} />
                  {filters.map((item) => (
                    <Line
                      key={item}
                      type="monotone"
                      dataKey={item}
                      stroke={colorPicker(item)}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:block gap-4">
            {isPending ? (
              <ChartSkeleton />
            ) : (
              <>
                <Button
                  variant="secondary"
                  className="p-4 border rounded-lg w-full flex-col items-start my-2 hover:border-ui-tag-blue-border transition-colors"
                  onClick={() => handleFilter("orders")}
                >
                  <div className="flex items-center justify-between w-full">
                    <Heading level="h3">Orders</Heading>
                    <Text className="text-xs text-ui-fg-muted">
                      {filterSet.has("orders") ? "Visible" : "Hidden"}
                    </Text>
                  </div>
                  <div className="flex gap-2 items-center mt-2">
                    <div
                      className="h-8 w-1 rounded"
                      style={{
                        backgroundColor: filterSet.has("orders")
                          ? colorPicker("orders")
                          : "gray",
                      }}
                    />
                    <div>
                      <Text className="text-2xl font-bold text-ui-fg-base">{totals.orders}</Text>
                      <Text className="text-xs text-ui-fg-subtle">in selected period</Text>
                    </div>
                  </div>
                </Button>
                <Button
                  variant="secondary"
                  className="p-4 border rounded-lg w-full flex-col items-start my-2 hover:border-ui-tag-green-border transition-colors"
                  onClick={() => handleFilter("customers")}
                >
                  <div className="flex items-center justify-between w-full">
                    <Heading level="h3">Customers</Heading>
                    <Text className="text-xs text-ui-fg-muted">
                      {filterSet.has("customers") ? "Visible" : "Hidden"}
                    </Text>
                  </div>
                  <div className="flex gap-2 items-center mt-2">
                    <div
                      className="h-8 w-1 rounded"
                      style={{
                        backgroundColor: filterSet.has("customers")
                          ? colorPicker("customers")
                          : "gray",
                      }}
                    />
                    <div>
                      <Text className="text-2xl font-bold text-ui-fg-base">{totals.customers}</Text>
                      <Text className="text-xs text-ui-fg-subtle">new customers</Text>
                    </div>
                  </div>
                </Button>
              </>
            )}
          </div>
        </div>
      </Container>
    </>
  )
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean
  label?: string
  payload?: {
    dataKey: string
    name: string
    stroke: string
    value: number
  }[]
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-ui-bg-component p-4 rounded-lg border border-ui-border-base">
        <p className="font-bold">{`${label}`}</p>
        <ul>
          {payload.map((item) => (
            <li key={item.dataKey} className="flex gap-2 items-center">
              <span className="capitalize" style={{ color: item.stroke }}>
                {item.name}:
              </span>
              <span>{item.value}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return null
}

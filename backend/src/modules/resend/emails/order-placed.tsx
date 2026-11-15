import { 
  Text, 
  Column, 
  Container, 
  Heading, 
  Html, 
  Img, 
  Row, 
  Section, 
  Tailwind, 
  Head, 
  Preview, 
  Body, 
  Link 
} from "@react-email/components"
import { currencyFormatter, orderSummaryLines } from "../order-summary"

/**
 * What `subscribers/order-placed.ts` sends: only the fields rendered below,
 * not the whole order. The notification row stores `data` verbatim, and the
 * order's addresses have no business being copied into it. Amounts are plain
 * numbers (the subscriber converts the order module's BigNumbers), and every
 * one is before tax and discount except `tax_total` and `total`, so the
 * summary adds up (see ../order-summary.ts).
 */
export type OrderPlacedEmailOrder = {
  id: string
  display_id?: number | string | null
  currency_code: string
  total?: number | null
  item_subtotal?: number | null
  discount_subtotal?: number | null
  tax_total?: number | null
  credit_line_total?: number | null
  items?: Array<{
    id: string
    thumbnail?: string | null
    product_title?: string | null
    variant_title?: string | null
    quantity?: number | null
    subtotal?: number | null
  }> | null
  shipping_methods?: Array<{
    id: string
    name?: string | null
    subtotal?: number | null
  }> | null
  customer?: { first_name?: string | null } | null
  shipping_address?: { first_name?: string | null } | null
}

export type OrderPlacedEmailProps = {
  order: OrderPlacedEmailOrder
  email_banner?: {
    body: string
    title: string
    url: string
  }
}

function OrderPlacedEmailComponent({ order, email_banner }: OrderPlacedEmailProps) {
  const shouldDisplayBanner = email_banner && "title" in email_banner
  const firstName = order.customer?.first_name || order.shipping_address?.first_name

  const format = currencyFormatter(order.currency_code)
  const formatPrice = (price: number | null | undefined) =>
    typeof price === "number" && Number.isFinite(price) ? format(price) : ""
  const summary = orderSummaryLines(order)

  return (
    <Tailwind>
      <Html className="font-sans bg-gray-100">
        <Head />
        <Preview>Thank you for your Free Black Market order</Preview>
        <Body className="bg-white my-10 mx-auto w-full max-w-2xl">
          {/* Header */}
          <Section className="bg-[#27272a] text-white px-6 py-4">
            <Text className="m-0 text-white text-base font-semibold">Free Black Market</Text>
          </Section>

          {/* Thank You Message */}
          <Container className="p-6">
            <Heading className="text-2xl font-bold text-center text-gray-800">
              {`Thank you for your order${firstName ? `, ${firstName}` : ""}`}
            </Heading>
            <Text className="text-center text-gray-600 mt-2">
              We're processing your order and will notify you when it ships.
            </Text>
          </Container>

          {/* Promotional Banner */}
          {shouldDisplayBanner && (
            <Container
              className="mb-4 rounded-lg p-7"
              style={{
                background: 'linear-gradient(to right, #3b82f6, #4f46e5)'
              }}
            >
              <Section>
                <Row>
                  <Column align="left">
                    <Heading className="text-white text-xl font-semibold">
                      {email_banner.title}
                    </Heading>
                    <Text className="text-white mt-2">{email_banner.body}</Text>
                  </Column>
                  <Column align="right">
                    <Link href={email_banner.url} className="font-semibold px-2 text-white underline">
                      Shop Now
                    </Link>
                  </Column>
                </Row>
              </Section>
            </Container>
          )}

          {/* Order Items */}
          <Container className="px-6">
            <Heading className="text-xl font-semibold text-gray-800 mb-4">
              Your Items
            </Heading>
            <Row>
              <Column>
                <Text className="text-sm m-0 my-2 text-gray-500">Order ID: #{order.display_id}</Text>
              </Column>
            </Row>
            {order.items?.map((item) => (
              <Section key={item.id} className="border-b border-gray-200 py-4">
                <Row>
                  <Column className="w-1/3">
                    <Img
                      src={item.thumbnail ?? ''}
                      alt={item.product_title ?? ''}
                      className="rounded-lg"
                      width="100%"
                    />
                  </Column>
                  <Column className="w-2/3 pl-4">
                    <Text className="text-lg font-semibold text-gray-800">
                      {item.product_title}
                    </Text>
                    <Text className="text-gray-600">{item.variant_title}</Text>
                    {typeof item.quantity === "number" ? (
                      <Text className="text-gray-600">Qty {item.quantity}</Text>
                    ) : null}
                    <Text className="text-gray-800 mt-2 font-bold">
                      {formatPrice(item.subtotal)}
                    </Text>
                  </Column>
                </Row>
              </Section>
            ))}

            {/* Order Summary */}
            <Section className="mt-8">
              <Heading className="text-xl font-semibold text-gray-800 mb-4">
                Order Summary
              </Heading>
              {summary.map((line) => (
                <Row className="text-gray-600" key={line.key}>
                  <Column className="w-1/2">
                    <Text className="m-0">{line.label}</Text>
                  </Column>
                  <Column className="w-1/2 text-right">
                    <Text className="m-0">{formatPrice(line.amount)}</Text>
                  </Column>
                </Row>
              ))}
              <Row className="border-t border-gray-200 mt-4 text-gray-800 font-bold">
                <Column className="w-1/2">
                  <Text>Total</Text>
                </Column>
                <Column className="w-1/2 text-right">
                  <Text>{formatPrice(order.total)}</Text>
                </Column>
              </Row>
            </Section>
          </Container>

          {/* Footer */}
          <Section className="bg-gray-50 p-6 mt-10">
            <Text className="text-center text-gray-500 text-sm">
              If you have any questions, reply to this email.
            </Text>
            <Text className="text-center text-gray-500 text-sm">
              Order Token: {order.id}
            </Text>
            <Text className="text-center text-gray-400 text-xs mt-4">
              © {new Date().getFullYear()} Free Black Market
            </Text>
          </Section>
        </Body>
      </Html>
    </Tailwind >
  )
}

export const orderPlacedEmail = (props: OrderPlacedEmailProps) => (
  <OrderPlacedEmailComponent {...props} />
)


const mockOrder: OrderPlacedEmailProps = {
  order: {
    id: "order_01DEMO",
    display_id: 1042,
    currency_code: "usd",
    total: 25.3,
    item_subtotal: 20,
    discount_subtotal: 5,
    tax_total: 2.3,
    credit_line_total: 0,
    items: [
      {
        id: "ordli_01DEMO",
        thumbnail: null,
        product_title: "Raw Wildflower Honey",
        variant_title: "16 oz",
        quantity: 2,
        subtotal: 20,
      },
    ],
    shipping_methods: [{ id: "ordsm_01DEMO", name: "Standard Shipping", subtotal: 8 }],
    customer: { first_name: "Jordan" },
    shipping_address: { first_name: "Jordan" },
  },
}

export default () => <OrderPlacedEmailComponent {...mockOrder} />

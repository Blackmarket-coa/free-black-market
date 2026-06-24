import {
  Text,
  Container,
  Heading,
  Html,
  Section,
  Tailwind,
  Head,
  Preview,
  Body,
  Button,
} from "@react-email/components"

type ReviewRequestEmailProps = {
  customer_name?: string | null
  vendor_name?: string | null
  product_title?: string | null
  review_url: string
}

function ReviewRequestEmailComponent({
  customer_name,
  vendor_name,
  product_title,
  review_url,
}: ReviewRequestEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>How was your order? Leave a quick review</Preview>
      <Tailwind>
        <Body className="bg-white my-auto mx-auto font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[24px] max-w-[520px]">
            <Section className="mt-[8px]">
              <Heading className="text-black text-[24px] font-semibold text-center p-0 my-[16px] mx-0">
                How did we do?
              </Heading>
            </Section>

            <Section className="my-[16px]">
              <Text className="text-black text-[14px] leading-[24px]">
                Hi{customer_name ? ` ${customer_name}` : ""},
              </Text>
              <Text className="text-black text-[14px] leading-[24px]">
                Thanks for your recent order
                {product_title ? ` of ${product_title}` : ""}
                {vendor_name ? ` from ${vendor_name}` : ""}. A quick review helps
                other shoppers and supports the vendor.
              </Text>
            </Section>

            <Section className="text-center mt-[24px] mb-[24px]">
              <Button
                className="bg-[#000000] rounded text-white text-[12px] font-semibold no-underline text-center px-5 py-3"
                href={review_url}
              >
                Leave a review
              </Button>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export const reviewRequestEmail = (props: ReviewRequestEmailProps) => (
  <ReviewRequestEmailComponent {...props} />
)

const mock: ReviewRequestEmailProps = {
  customer_name: "Jordan",
  vendor_name: "Maple Grove Farms",
  product_title: "Raw Wildflower Honey",
  review_url: "https://freeblackmarket.com/review?token=demo",
}

export default () => <ReviewRequestEmailComponent {...mock} />

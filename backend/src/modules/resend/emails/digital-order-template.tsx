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
  Link,
} from "@react-email/components"

/**
 * Sent by `workflows/fulfill-digital-order/steps/send-digital-order-notification.ts`
 * with one entry per purchased digital product and the URLs of its main files.
 */
type DigitalOrderEmailProps = {
  products?: Array<{
    name?: string | null
    medias?: string[] | null
  }> | null
}

function DigitalOrderEmailComponent({ products }: DigitalOrderEmailProps) {
  const items = (products ?? []).filter(Boolean)

  return (
    <Html>
      <Head />
      <Preview>Your digital order is ready to download</Preview>
      <Tailwind>
        <Body className="bg-white my-auto mx-auto font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[24px] max-w-[520px]">
            <Section className="mt-[8px]">
              <Heading className="text-black text-[24px] font-semibold text-center p-0 my-[16px] mx-0">
                Your digital order is ready
              </Heading>
            </Section>

            <Text className="text-black text-[14px] leading-[24px]">
              Thanks for your order on Free Black Market. Your files are below.
            </Text>

            {items.map((product, index) => (
              <Section key={`${product.name ?? "product"}-${index}`} className="my-[16px]">
                <Text className="text-black text-[16px] font-semibold leading-[24px] m-0">
                  {product.name || "Digital product"}
                </Text>
                {(product.medias ?? []).length ? (
                  (product.medias ?? []).map((url, mediaIndex) => (
                    <Text key={`${url}-${mediaIndex}`} className="text-[14px] leading-[24px] m-0">
                      <Link href={url} className="text-blue-600 no-underline break-all">
                        Download file {mediaIndex + 1}
                      </Link>
                    </Text>
                  ))
                ) : (
                  <Text className="text-[#666666] text-[14px] leading-[24px] m-0">
                    This product has no downloadable file yet. The seller will follow up.
                  </Text>
                )}
              </Section>
            ))}

            <Text className="text-[#666666] text-[12px] leading-[20px]">
              Download links can expire. If one no longer works, reply to this email.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export const digitalOrderEmail = (props: DigitalOrderEmailProps) => (
  <DigitalOrderEmailComponent {...props} />
)

const mock: DigitalOrderEmailProps = {
  products: [
    { name: "Seed-Saving Field Guide (PDF)", medias: ["https://files.example.com/guide.pdf"] },
  ],
}

export default () => <DigitalOrderEmailComponent {...mock} />

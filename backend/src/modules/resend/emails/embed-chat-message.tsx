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
} from "@react-email/components"

type EmbedChatMessageEmailProps = {
  vendor_name?: string | null
  customer_email: string
  customer_name?: string | null
  message: string
}

function EmbedChatMessageEmailComponent({
  vendor_name,
  customer_email,
  customer_name,
  message,
}: EmbedChatMessageEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>New message from your website</Preview>
      <Tailwind>
        <Body className="bg-white my-auto mx-auto font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[24px] max-w-[520px]">
            <Section className="mt-[8px]">
              <Heading className="text-black text-[22px] font-semibold p-0 my-[16px] mx-0">
                New message from your website
              </Heading>
            </Section>

            <Section className="my-[12px]">
              <Text className="text-black text-[14px] leading-[24px]">
                Hi{vendor_name ? ` ${vendor_name}` : ""}, a visitor reached out
                through your embedded FBM storefront.
              </Text>
              <Text className="text-black text-[14px] leading-[24px]">
                <strong>From:</strong>{" "}
                {customer_name ? `${customer_name} ` : ""}({customer_email})
              </Text>
            </Section>

            <Section className="my-[12px] bg-[#f6f6f6] rounded p-[16px]">
              <Text className="text-black text-[14px] leading-[24px] whitespace-pre-wrap">
                {message}
              </Text>
            </Section>

            <Section className="mt-[16px]">
              <Text className="text-[#666666] text-[12px] leading-[24px]">
                Reply directly to {customer_email} to continue the conversation.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export const embedChatMessageEmail = (props: EmbedChatMessageEmailProps) => (
  <EmbedChatMessageEmailComponent {...props} />
)

const mock: EmbedChatMessageEmailProps = {
  vendor_name: "Maple Grove Studio",
  customer_email: "shopper@example.com",
  customer_name: "Jordan",
  message: "Hi! Do you ship to Canada?",
}

export default () => <EmbedChatMessageEmailComponent {...mock} />

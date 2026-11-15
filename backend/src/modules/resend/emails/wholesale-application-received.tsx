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

/** Sent by `POST /store/wholesale-application` once the application is stored. */
type WholesaleApplicationReceivedEmailProps = {
  business_name?: string | null
  contact_name?: string | null
}

function WholesaleApplicationReceivedEmailComponent({
  business_name,
  contact_name,
}: WholesaleApplicationReceivedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>We received your wholesale application</Preview>
      <Tailwind>
        <Body className="bg-white my-auto mx-auto font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[24px] max-w-[520px]">
            <Section className="mt-[8px]">
              <Heading className="text-black text-[24px] font-semibold text-center p-0 my-[16px] mx-0">
                Application received
              </Heading>
            </Section>

            <Text className="text-black text-[14px] leading-[24px]">
              Hi{contact_name ? ` ${contact_name}` : ""},
            </Text>
            <Text className="text-black text-[14px] leading-[24px]">
              Thanks for applying for a wholesale account
              {business_name ? ` for ${business_name}` : ""}. Our team will review it and email
              you at this address.
            </Text>
            <Text className="text-[#666666] text-[12px] leading-[20px]">
              You don't need to do anything else right now.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export const wholesaleApplicationReceivedEmail = (props: WholesaleApplicationReceivedEmailProps) => (
  <WholesaleApplicationReceivedEmailComponent {...props} />
)

const mock: WholesaleApplicationReceivedEmailProps = {
  business_name: "Greenleaf Nursery",
  contact_name: "Avery",
}

export default () => <WholesaleApplicationReceivedEmailComponent {...mock} />

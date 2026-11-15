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

/** Sent by `POST /admin/wholesale-application/:id/approve`. */
type WholesaleApplicationApprovedEmailProps = {
  business_name?: string | null
  contact_name?: string | null
  tier_name?: string | null
  payment_terms_days?: number | null
}

function WholesaleApplicationApprovedEmailComponent({
  business_name,
  contact_name,
  tier_name,
  payment_terms_days,
}: WholesaleApplicationApprovedEmailProps) {
  const hasTerms = typeof payment_terms_days === "number" && payment_terms_days > 0

  return (
    <Html>
      <Head />
      <Preview>Your wholesale application is approved</Preview>
      <Tailwind>
        <Body className="bg-white my-auto mx-auto font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[24px] max-w-[520px]">
            <Section className="mt-[8px]">
              <Heading className="text-black text-[24px] font-semibold text-center p-0 my-[16px] mx-0">
                You're approved for wholesale
              </Heading>
            </Section>

            <Text className="text-black text-[14px] leading-[24px]">
              Hi{contact_name ? ` ${contact_name}` : ""},
            </Text>
            <Text className="text-black text-[14px] leading-[24px]">
              Your wholesale application{business_name ? ` for ${business_name}` : ""} has been
              approved{tier_name ? ` at the ${tier_name} tier` : ""}.
            </Text>
            {hasTerms ? (
              <Text className="text-black text-[14px] leading-[24px]">
                {`Payment terms: net ${payment_terms_days} days.`}
              </Text>
            ) : null}
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export const wholesaleApplicationApprovedEmail = (props: WholesaleApplicationApprovedEmailProps) => (
  <WholesaleApplicationApprovedEmailComponent {...props} />
)

const mock: WholesaleApplicationApprovedEmailProps = {
  business_name: "Greenleaf Nursery",
  contact_name: "Avery",
  tier_name: "Trade",
  payment_terms_days: 30,
}

export default () => <WholesaleApplicationApprovedEmailComponent {...mock} />

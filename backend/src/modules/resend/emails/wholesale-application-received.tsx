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

/**
 * Sent by `POST /store/wholesale-application` once the application is stored.
 *
 * Deliberately takes no props. That route is public and mails whatever
 * address its body names, so anything this template rendered from the
 * request (the business or contact name) would be text an anonymous caller
 * chose, sent from FBM's domain to a stranger. A fixed confirmation is a
 * receipt; a templated one is a relay.
 */
type WholesaleApplicationReceivedEmailProps = Record<string, never>

function WholesaleApplicationReceivedEmailComponent(_props: WholesaleApplicationReceivedEmailProps) {
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

            <Text className="text-black text-[14px] leading-[24px]">Hello,</Text>
            <Text className="text-black text-[14px] leading-[24px]">
              Thanks for applying for a Free Black Market wholesale account. Our team will review
              your application and email you at this address.
            </Text>
            <Text className="text-[#666666] text-[12px] leading-[20px]">
              You don't need to do anything else right now. If you did not apply, you can ignore
              this email.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

// Whatever a caller passes is ignored: the component is rendered with no props.
export const wholesaleApplicationReceivedEmail = (_props?: unknown) => (
  <WholesaleApplicationReceivedEmailComponent />
)

export default () => <WholesaleApplicationReceivedEmailComponent />

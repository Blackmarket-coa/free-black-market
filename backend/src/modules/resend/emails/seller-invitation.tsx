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
  Button,
} from "@react-email/components"

/** Sent by `POST /admin/sellers/invite`. */
type SellerInvitationEmailProps = {
  registration_url?: string | null
  email?: string | null
}

function SellerInvitationEmailComponent({ registration_url, email }: SellerInvitationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>You're invited to open a store on Free Black Market</Preview>
      <Tailwind>
        <Body className="bg-white my-auto mx-auto font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[24px] max-w-[520px]">
            <Section className="mt-[8px]">
              <Heading className="text-black text-[24px] font-semibold text-center p-0 my-[16px] mx-0">
                You're invited to sell
              </Heading>
            </Section>

            <Text className="text-black text-[14px] leading-[24px]">
              Hello{email ? ` ${email}` : ""},
            </Text>
            <Text className="text-black text-[14px] leading-[24px]">
              You've been invited to open a vendor store on Free Black Market. Register to set up
              your store and start listing.
            </Text>

            {registration_url ? (
              <>
                <Section className="text-center mt-[24px] mb-[24px]">
                  <Button
                    className="bg-[#000000] rounded text-white text-[12px] font-semibold no-underline text-center px-5 py-3"
                    href={registration_url}
                  >
                    Register your store
                  </Button>
                </Section>
                <Text className="text-black text-[14px] leading-[24px]">
                  Or copy and paste this URL into your browser:
                </Text>
                <Link
                  href={registration_url}
                  className="text-blue-600 no-underline text-[14px] leading-[24px] break-all"
                >
                  {registration_url}
                </Link>
              </>
            ) : null}

            <Text className="text-[#666666] text-[12px] leading-[20px]">
              If you weren't expecting this invitation, you can ignore this email.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export const sellerInvitationEmail = (props: SellerInvitationEmailProps) => (
  <SellerInvitationEmailComponent {...props} />
)

const mock: SellerInvitationEmailProps = {
  registration_url: "https://vendor.example.com/vendor/register",
  email: "grower@example.com",
}

export default () => <SellerInvitationEmailComponent {...mock} />

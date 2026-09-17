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

type SellerEmailVerificationProps = {
  member_name?: string
  seller_name: string
  verify_url?: string
  request_id?: string
  token?: string
  expires_in_hours?: number
}

function SellerEmailVerificationComponent({
  member_name,
  seller_name,
  verify_url,
  request_id,
  token,
  expires_in_hours,
}: SellerEmailVerificationProps) {
  const hours = expires_in_hours ?? 24

  return (
    <Html>
      <Head />
      <Preview>Confirm your email to open your Free Black Market store</Preview>
      <Tailwind>
        <Body className="bg-white my-auto mx-auto font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[24px] max-w-[520px]">
            <Section className="mt-[8px]">
              <Heading className="text-black text-[24px] font-semibold text-center p-0 my-[16px] mx-0">
                Confirm your email
              </Heading>
            </Section>

            <Text className="text-black text-[14px] leading-[24px]">
              {member_name ? `Hi ${member_name},` : "Hi,"}
            </Text>
            <Text className="text-black text-[14px] leading-[24px]">
              You registered <strong>{seller_name}</strong> on Free Black Market. Confirm this
              address and your store opens right away — there is no waiting on a review.
            </Text>

            {verify_url ? (
              <Section className="text-center mt-[24px] mb-[24px]">
                <Button
                  className="bg-black rounded text-white text-[14px] font-semibold no-underline text-center px-[20px] py-[12px]"
                  href={verify_url}
                >
                  Confirm and open my store
                </Button>
              </Section>
            ) : null}

            <Text className="text-[#666666] text-[12px] leading-[20px]">
              This link works once and expires in {hours} hours.
            </Text>

            {!verify_url && request_id && token ? (
              <Text className="text-[#666666] text-[12px] leading-[20px] break-all">
                If you cannot use a link, quote request <strong>{request_id}</strong> and code{" "}
                <strong>{token}</strong> to support.
              </Text>
            ) : null}

            <Text className="text-[#666666] text-[12px] leading-[20px]">
              If you did not register a store, ignore this email — nothing was created in your
              name, and the link expires on its own.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export const sellerEmailVerificationEmail = (props: SellerEmailVerificationProps) => (
  <SellerEmailVerificationComponent {...props} />
)

export default sellerEmailVerificationEmail

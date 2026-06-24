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

type BookingConfirmationEmailProps = {
  customer_name?: string | null
  vendor_name?: string | null
  starts_at: string | Date
  ends_at?: string | Date
}

function formatWhen(value: string | Date | undefined): string {
  if (!value) return ""
  try {
    const d = value instanceof Date ? value : new Date(value)
    return d.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    })
  } catch {
    return String(value)
  }
}

function BookingConfirmationEmailComponent({
  customer_name,
  vendor_name,
  starts_at,
}: BookingConfirmationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your booking is confirmed</Preview>
      <Tailwind>
        <Body className="bg-white my-auto mx-auto font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[24px] max-w-[520px]">
            <Section className="mt-[8px]">
              <Heading className="text-black text-[24px] font-semibold text-center p-0 my-[16px] mx-0">
                Booking confirmed
              </Heading>
            </Section>

            <Section className="my-[16px]">
              <Text className="text-black text-[14px] leading-[24px]">
                Hi{customer_name ? ` ${customer_name}` : ""},
              </Text>
              <Text className="text-black text-[14px] leading-[24px]">
                Your booking with {vendor_name || "the vendor"} is confirmed.
              </Text>
            </Section>

            <Section className="my-[16px]">
              <Text className="text-black text-[16px] leading-[24px] font-semibold">
                {formatWhen(starts_at)}
              </Text>
            </Section>

            <Section className="mt-[24px]">
              <Text className="text-[#666666] text-[12px] leading-[24px]">
                Need to reschedule or cancel? Reply to this email and the vendor
                will help you out.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export const bookingConfirmationEmail = (
  props: BookingConfirmationEmailProps
) => <BookingConfirmationEmailComponent {...props} />

const mock: BookingConfirmationEmailProps = {
  customer_name: "Jordan",
  vendor_name: "Maple Grove Studio",
  starts_at: "2026-07-01T15:00:00.000Z",
}

export default () => <BookingConfirmationEmailComponent {...mock} />

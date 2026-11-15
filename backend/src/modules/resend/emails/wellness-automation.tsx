import {
  Text,
  Container,
  Html,
  Section,
  Tailwind,
  Head,
  Preview,
  Body,
} from "@react-email/components"

/**
 * The email fallback of `modules/wellness/automation-service.ts` when Matrix
 * delivery is unavailable. `body` is the practitioner's own template, already
 * rendered; it is plain text and is rendered as text (React escapes it), never
 * as HTML.
 */
type WellnessAutomationEmailProps = {
  body?: string | null
  recipient_name?: string | null
  practitioner_name?: string | null
}

function WellnessAutomationEmailComponent({
  body,
  recipient_name,
  practitioner_name,
}: WellnessAutomationEmailProps) {
  const paragraphs = String(body ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  const from = practitioner_name || "your practitioner"

  return (
    <Html>
      <Head />
      <Preview>{`A message from ${from}`}</Preview>
      <Tailwind>
        <Body className="bg-white my-auto mx-auto font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[24px] max-w-[520px]">
            {recipient_name ? (
              <Text className="text-black text-[14px] leading-[24px]">Hi {recipient_name},</Text>
            ) : null}
            <Section>
              {paragraphs.map((paragraph, index) => (
                <Text
                  key={index}
                  className="text-black text-[14px] leading-[24px] whitespace-pre-line"
                >
                  {paragraph}
                </Text>
              ))}
            </Section>
            <Text className="text-[#666666] text-[12px] leading-[20px]">
              Sent on behalf of {from} through Free Black Market.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export const wellnessAutomationEmail = (props: WellnessAutomationEmailProps) => (
  <WellnessAutomationEmailComponent {...props} />
)

const mock: WellnessAutomationEmailProps = {
  body: "Your session is tomorrow at 10am.\n\nReply here if you need to reschedule.",
  recipient_name: "Sam",
  practitioner_name: "River Wellness",
}

export default () => <WellnessAutomationEmailComponent {...mock} />

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
 * Sent by `modules/demand-pool/plant-demand.ts` to each buyer who expressed
 * demand for a species once production is activated. The pre-order product is
 * created as a draft, so there is nothing to link to yet.
 */
type PlantDemandActivatedEmailProps = {
  species_name?: string | null
  estimated_ship?: string | null
  price?: number | null
  product_id?: string | null
}

function formatShipDate(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function PlantDemandActivatedEmailComponent({
  species_name,
  estimated_ship,
  price,
}: PlantDemandActivatedEmailProps) {
  const species = species_name || "A plant you asked for"
  const ship = formatShipDate(estimated_ship)
  const hasPrice = typeof price === "number" && Number.isFinite(price)

  return (
    <Html>
      <Head />
      <Preview>{`${species} is going into production`}</Preview>
      <Tailwind>
        <Body className="bg-white my-auto mx-auto font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[24px] max-w-[520px]">
            <Section className="mt-[8px]">
              <Heading className="text-black text-[24px] font-semibold text-center p-0 my-[16px] mx-0">
                It's going into production
              </Heading>
            </Section>

            <Text className="text-black text-[14px] leading-[24px]">
              Enough buyers asked for <strong>{species}</strong> that a grower is starting
              production.
            </Text>
            {ship ? (
              <Text className="text-black text-[14px] leading-[24px]">
                {`Estimated ship date: ${ship}`}
              </Text>
            ) : null}
            {hasPrice ? (
              <Text className="text-black text-[14px] leading-[24px]">
                {`Pre-order price: $${price.toFixed(2)}`}
              </Text>
            ) : null}
            <Text className="text-[#666666] text-[12px] leading-[20px]">
              You're receiving this because you asked for this plant on Free Black Market.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export const plantDemandActivatedEmail = (props: PlantDemandActivatedEmailProps) => (
  <PlantDemandActivatedEmailComponent {...props} />
)

const mock: PlantDemandActivatedEmailProps = {
  species_name: "Asclepias tuberosa",
  estimated_ship: "2027-04-01T00:00:00.000Z",
  price: 12.5,
  product_id: "prod_demo",
}

export default () => <PlantDemandActivatedEmailComponent {...mock} />

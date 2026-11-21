import { Button, Container, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import { DeliverySetupForm } from "../../components/onboarding/delivery-setup-form"

/**
 * The dashboard's "Set up pickup or shipping" step: one screen that takes a
 * store from nothing to a stock location linked to its sales channel and an
 * option a buyer can choose (SD-151 (4)).
 */
export const DeliverySetup = () => {
  return (
    <Container className="mx-auto max-w-2xl p-0">
      <div className="border-ui-border-base border-b px-6 py-4">
        <Heading level="h1">Pickup and shipping</Heading>
        <Text className="text-ui-fg-subtle mt-1">
          Where your goods are and how buyers get them. A buyer cannot check
          out from your store until both are here.
        </Text>
      </div>
      <div className="px-6 py-6">
        <DeliverySetupForm />
      </div>
      <div className="border-ui-border-base flex items-center justify-between border-t px-6 py-4">
        <Link to="/settings/locations">
          <Button variant="transparent" size="small">
            All locations and rates in Settings
          </Button>
        </Link>
        <Link to="/dashboard">
          <Button variant="secondary" size="small">
            Back to dashboard
          </Button>
        </Link>
      </div>
    </Container>
  )
}

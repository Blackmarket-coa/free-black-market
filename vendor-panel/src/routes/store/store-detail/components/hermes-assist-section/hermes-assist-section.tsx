import { Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useVendorHermesRuntime } from "../../../../../hooks/api/hermes"

export const HermesAssistSection = () => {
  const { mutateAsync, isPending } = useVendorHermesRuntime()

  const handleGenerateDraft = async () => {
    try {
      await mutateAsync({
        tool_call: {
          action: "create_product",
          parameters: {
            title: "Vendor Draft Product",
            description: "Hermes-assisted draft created from vendor panel",
            price: 19.99,
            currency_code: "usd",
            category: "draft",
            inventory_quantity: 10,
          },
        },
      })

      toast.success("Hermes validated the product draft payload")
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Hermes runtime request failed"
      toast.error(message)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Hermes Assistant</Heading>
        <Text className="text-ui-fg-subtle mt-2">
          Validate onboarding and product draft payloads against the vendor-safe
          Hermes runtime.
        </Text>
      </div>
      <div className="px-6 py-4">
        <Button onClick={handleGenerateDraft} isLoading={isPending}>
          Validate Product Draft
        </Button>
      </div>
    </Container>
  )
}

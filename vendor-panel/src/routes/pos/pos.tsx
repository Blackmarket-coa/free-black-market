import { useState } from "react"
import { Badge, Button, Container, Heading, Input, Label, Select, Text, toast } from "@medusajs/ui"
import { usePosCheckout, usePosConfig } from "../../hooks/api/pos"

export const PosPage = () => {
  const { data } = usePosConfig()
  const checkout = usePosCheckout()
  const [payeeVendorId, setPayeeVendorId] = useState("")
  const [amount, setAmount] = useState("0")
  const [paymentMethod, setPaymentMethod] = useState("manual")

  const submit = async () => {
    try {
      const response = await checkout.mutateAsync({
        payee_vendor_id: payeeVendorId,
        amount: Number(amount),
        payment_method: paymentMethod,
      })
      toast.success(`Payment captured (${response.payment.status})`)
    } catch (e: any) {
      toast.error(e?.message || "Failed to capture payment")
    }
  }

  return (
    <Container className="p-6 space-y-4">
      <Heading level="h1">POS (MVP)</Heading>
      <Text className="text-ui-fg-subtle">Cart + payment capture + receipt export mapped to existing vendor payment/order systems.</Text>
      <div className="flex gap-2">
        <Badge color="blue">Cart</Badge><Badge color="blue">Payment Capture</Badge><Badge color="blue">Receipt Export</Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Payee Vendor ID</Label>
          <Input value={payeeVendorId} onChange={(e) => setPayeeVendorId(e.target.value)} />
        </div>
        <div>
          <Label>Amount</Label>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <Label>Payment Method</Label>
          <Select value={paymentMethod} onValueChange={setPaymentMethod}>
            <Select.Trigger><Select.Value /></Select.Trigger>
            <Select.Content>
              <Select.Item value="manual">manual</Select.Item>
              <Select.Item value="cash">cash</Select.Item>
            </Select.Content>
          </Select>
        </div>
      </div>

      <Button onClick={submit} isLoading={checkout.isPending}>Capture Payment</Button>

      {data && (
        <pre className="text-xs bg-ui-bg-subtle rounded p-3 overflow-auto">{JSON.stringify(data, null, 2)}</pre>
      )}
    </Container>
  )
}

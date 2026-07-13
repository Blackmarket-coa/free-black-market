import { useMemo, useState } from "react"
import {
  Badge,
  Button,
  Container,
  Heading,
  IconButton,
  Input,
  Label,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { Trash } from "@medusajs/icons"
import {
  usePosCheckout,
  usePosConfig,
  usePosCreateOrder,
} from "../../hooks/api/pos"
import { useProducts } from "../../hooks/api/products"
import { Combobox } from "../../components/inputs/combobox"
import { getLocaleAmount } from "../../lib/money-amount-helpers"
import {
  buildPosOrderPayload,
  posLinesTotal,
  type PosLine,
} from "../../lib/pos-helpers"

const PAYMENT_METHODS = ["cash", "manual", "card", "other"] as const

/**
 * Ring-up form: pick catalog variants (or add ad-hoc lines), set qty/price,
 * and submit to POST /vendor/pos/orders — creating a real order stamped with
 * the `pos` channel. The vendor-to-vendor payment capture form (the original
 * POS MVP, backed by /vendor/pos/checkout) is preserved below.
 */
const RingUpSale = () => {
  const createOrder = usePosCreateOrder()
  const [lines, setLines] = useState<PosLine[]>([])
  const [search, setSearch] = useState("")
  const [currencyCode, setCurrencyCode] = useState("usd")
  const [paymentMethod, setPaymentMethod] = useState<string>("cash")
  const [note, setNote] = useState("")
  const [email, setEmail] = useState("")

  const { products } = useProducts({
    q: search || undefined,
    limit: 20,
    fields: "*variants,*variants.prices",
  } as any)

  const variantOptions = useMemo(() => {
    return (products ?? []).flatMap((product: any) =>
      (product.variants ?? []).map((variant: any) => ({
        label: `${product.title}${variant.title ? ` — ${variant.title}` : ""}`,
        value: variant.id as string,
      }))
    )
  }, [products])

  const addVariantLine = (variantId?: string) => {
    if (!variantId) {
      return
    }
    for (const product of (products ?? []) as any[]) {
      const variant = (product.variants ?? []).find(
        (v: any) => v.id === variantId
      )
      if (!variant) {
        continue
      }
      const price = (variant.prices ?? []).find(
        (p: any) => p.currency_code?.toLowerCase() === currencyCode.toLowerCase()
      )
      setLines((prev) => [
        ...prev,
        {
          variant_id: variant.id,
          title: `${product.title}${variant.title ? ` — ${variant.title}` : ""}`,
          quantity: 1,
          // Vendor API prices are MAJOR units; the payload builder converts.
          unit_price: price ? Number(price.amount) : 0,
        },
      ])
      break
    }
    setSearch("")
  }

  const addCustomLine = () => {
    setLines((prev) => [...prev, { title: "", quantity: 1, unit_price: 0 }])
  }

  const updateLine = (index: number, patch: Partial<PosLine>) => {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line))
    )
  }

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  const total = posLinesTotal(lines)

  const submit = async () => {
    const built = buildPosOrderPayload(lines, {
      currencyCode,
      paymentMethod,
      note,
      email,
    })
    if (!built.ok) {
      toast.error(built.message)
      return
    }
    try {
      const response = await createOrder.mutateAsync(built.payload)
      toast.success(
        `Order ${
          response.order.display_id ? `#${response.order.display_id}` : response.order.id
        } created (pos channel)`
      )
      setLines([])
      setNote("")
      setEmail("")
    } catch (e: any) {
      toast.error(e?.message || "Failed to create POS order")
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Heading level="h2">Ring up sale</Heading>
        <Text className="text-ui-fg-subtle">
          Creates a real order on the pos channel — it shows up in order
          history, channel analytics, and entitlements.
        </Text>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Add catalog item</Label>
          <Combobox
            options={variantOptions}
            searchValue={search}
            onSearchValueChange={setSearch}
            onChange={(value) => addVariantLine(value as string | undefined)}
            placeholder="Search products…"
          />
        </div>
        <div className="flex items-end">
          <Button variant="secondary" onClick={addCustomLine}>
            Add custom item
          </Button>
        </div>
      </div>

      {lines.length > 0 && (
        <div className="space-y-2">
          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-[1fr_90px_120px_40px] gap-2 items-end">
              <div>
                <Label>Item</Label>
                <Input
                  value={line.title}
                  placeholder="Item title"
                  onChange={(e) => updateLine(index, { title: e.target.value })}
                />
              </div>
              <div>
                <Label>Qty</Label>
                <Input
                  type="number"
                  min={1}
                  value={line.quantity}
                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                />
              </div>
              <div>
                <Label>Unit price</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.unit_price}
                  onChange={(e) => updateLine(index, { unit_price: e.target.value })}
                />
              </div>
              <IconButton variant="transparent" onClick={() => removeLine(index)}>
                <Trash />
              </IconButton>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        <div>
          <Label>Payment method</Label>
          <Select value={paymentMethod} onValueChange={setPaymentMethod}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {PAYMENT_METHODS.map((method) => (
                <Select.Item key={method} value={method}>
                  {method}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <div>
          <Label>Currency</Label>
          <Input
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.target.value)}
          />
        </div>
        <div>
          <Label>Customer email (optional)</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <Label>Note (optional)</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Text weight="plus">
          Total:{" "}
          {Number.isFinite(total) ? getLocaleAmount(total, currencyCode) : "—"}
        </Text>
        <Button
          onClick={submit}
          isLoading={createOrder.isPending}
          disabled={lines.length === 0}
        >
          Create order
        </Button>
      </div>
    </div>
  )
}

const VendorPaymentCapture = () => {
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
    <div className="space-y-4">
      <div>
        <Heading level="h2">Vendor payment capture</Heading>
        <Text className="text-ui-fg-subtle">
          Vendor-to-vendor hawala payment (no order created).
        </Text>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Payee Vendor ID</Label>
          <Input
            value={payeeVendorId}
            onChange={(e) => setPayeeVendorId(e.target.value)}
          />
        </div>
        <div>
          <Label>Amount</Label>
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <Label>Payment Method</Label>
          <Select value={paymentMethod} onValueChange={setPaymentMethod}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="manual">manual</Select.Item>
              <Select.Item value="cash">cash</Select.Item>
            </Select.Content>
          </Select>
        </div>
      </div>
      <Button onClick={submit} isLoading={checkout.isPending}>
        Capture Payment
      </Button>
      {data && (
        <pre className="text-xs bg-ui-bg-subtle rounded p-3 overflow-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}

export const PosPage = () => {
  return (
    <Container className="p-6 space-y-8 divide-y">
      <div className="space-y-4">
        <Heading level="h1">POS</Heading>
        <div className="flex gap-2">
          <Badge color="blue">Ring-up</Badge>
          <Badge color="blue">Payment Capture</Badge>
          <Badge color="blue">Receipt Export</Badge>
        </div>
        <RingUpSale />
      </div>
      <div className="pt-8">
        <VendorPaymentCapture />
      </div>
    </Container>
  )
}

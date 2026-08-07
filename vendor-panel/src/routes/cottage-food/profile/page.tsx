import { useEffect, useState } from "react"
import {
  Container,
  Heading,
  Text,
  Button,
  Input,
  Label,
  Textarea,
  Select,
  Switch,
  Alert,
  toast,
} from "@medusajs/ui"
import { useNavigate } from "react-router-dom"
import {
  useCottageFoodProfile,
  useSaveProfile,
  OPERATION_TYPE_LABELS,
  type OperationType,
} from "../_shared"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** Dollars in the input, cents on the wire. */
const dollarsToCents = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number(trimmed.replace(/[$,]/g, ""))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

const centsToDollars = (cents: number | null | undefined): string =>
  cents ? String(cents / 100) : ""

const toDateInput = (value: string | null | undefined): string =>
  value ? new Date(value).toISOString().slice(0, 10) : ""

const numberOrNull = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null
}

/**
 * The seller's own declaration of the rules they operate under.
 *
 * Every field is optional and every limit can be cleared. The copy throughout
 * makes it explicit that these are the seller's figures, not the platform's
 * determination — FBM ships no state-law table and verifies none of this.
 */
const CottageFoodProfilePage = () => {
  const navigate = useNavigate()
  const { data: profile, isLoading } = useCottageFoodProfile()
  const save = useSaveProfile(() => {
    toast.success("Saved")
    navigate("/cottage-food")
  })

  const [form, setForm] = useState({
    operation_type: "SHELF_STABLE" as OperationType,
    jurisdiction_label: "",
    state_code: "",
    permit_number: "",
    permit_type_label: "",
    permit_issuer: "",
    permit_expires_at: "",
    food_handler_cert_number: "",
    food_handler_expires_at: "",
    annual_sales_cap: "",
    cap_period_start_month: "1",
    daily_meal_cap: "",
    weekly_meal_cap: "",
    timezone: "America/New_York",
    allows_pickup: true,
    allows_delivery: false,
    allows_shipping: false,
    allows_out_of_state: false,
    allows_wholesale: false,
    label_disclosure_text: "",
    label_business_name: "",
    label_address: "",
    show_address_publicly: false,
    public_disclosure_opt_in: true,
  })

  useEffect(() => {
    if (!profile) return
    setForm({
      operation_type: profile.operation_type ?? "SHELF_STABLE",
      jurisdiction_label: profile.jurisdiction_label ?? "",
      state_code: profile.state_code ?? "",
      permit_number: profile.permit_number ?? "",
      permit_type_label: profile.permit_type_label ?? "",
      permit_issuer: profile.permit_issuer ?? "",
      permit_expires_at: toDateInput(profile.permit_expires_at),
      food_handler_cert_number: profile.food_handler_cert_number ?? "",
      food_handler_expires_at: toDateInput(profile.food_handler_expires_at),
      annual_sales_cap: centsToDollars(profile.annual_sales_cap_cents),
      cap_period_start_month: String(profile.cap_period_start_month ?? 1),
      daily_meal_cap: profile.daily_meal_cap ? String(profile.daily_meal_cap) : "",
      weekly_meal_cap: profile.weekly_meal_cap ? String(profile.weekly_meal_cap) : "",
      timezone: profile.timezone ?? "America/New_York",
      allows_pickup: profile.allows_pickup,
      allows_delivery: profile.allows_delivery,
      allows_shipping: profile.allows_shipping,
      allows_out_of_state: profile.allows_out_of_state,
      allows_wholesale: profile.allows_wholesale,
      label_disclosure_text: profile.label_disclosure_text ?? "",
      label_business_name: profile.label_business_name ?? "",
      label_address: profile.label_address ?? "",
      show_address_publicly: profile.show_address_publicly,
      public_disclosure_opt_in: profile.public_disclosure_opt_in,
    })
  }, [profile])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const tracksMeals =
    form.operation_type === "HOME_KITCHEN" || form.operation_type === "BOTH"

  const handleSave = () => {
    save.mutate({
      operation_type: form.operation_type,
      jurisdiction_label: form.jurisdiction_label,
      state_code: form.state_code,
      permit_number: form.permit_number,
      permit_type_label: form.permit_type_label,
      permit_issuer: form.permit_issuer,
      permit_expires_at: form.permit_expires_at || null,
      food_handler_cert_number: form.food_handler_cert_number,
      food_handler_expires_at: form.food_handler_expires_at || null,
      annual_sales_cap_cents: dollarsToCents(form.annual_sales_cap),
      cap_period_start_month: Number(form.cap_period_start_month) || 1,
      daily_meal_cap: numberOrNull(form.daily_meal_cap),
      weekly_meal_cap: numberOrNull(form.weekly_meal_cap),
      timezone: form.timezone,
      allows_pickup: form.allows_pickup,
      allows_delivery: form.allows_delivery,
      allows_shipping: form.allows_shipping,
      allows_out_of_state: form.allows_out_of_state,
      allows_wholesale: form.allows_wholesale,
      label_disclosure_text: form.label_disclosure_text,
      label_business_name: form.label_business_name,
      label_address: form.label_address,
      show_address_publicly: form.show_address_publicly,
      public_disclosure_opt_in: form.public_disclosure_opt_in,
    })
  }

  if (isLoading) {
    return (
      <Container className="p-8">
        <Text className="text-ui-fg-subtle">Loading…</Text>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Your operation</Heading>
        <Text size="small" className="text-ui-fg-subtle max-w-2xl">
          Everything on this page is what <em>you</em> tell us. Free Black Market
          doesn't know your county's rules and doesn't check these numbers
          against anything — it counts against them so you can see where you
          stand. Leave anything blank that doesn't apply.
        </Text>
      </div>

      <div className="flex flex-col gap-y-4 px-6 py-6">
        <Heading level="h2">What you make</Heading>
        <div className="max-w-md">
          <Label size="small">Type of operation</Label>
          <Select
            value={form.operation_type}
            onValueChange={(v) => set("operation_type", v as OperationType)}
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {Object.entries(OPERATION_TYPE_LABELS).map(([value, label]) => (
                <Select.Item key={value} value={value}>
                  {label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          <Text size="xsmall" className="text-ui-fg-subtle mt-1">
            Selling cooked meals usually comes with per-day and per-week limits
            on top of an annual one, so picking that turns on the meal counters.
          </Text>
        </div>
      </div>

      <div className="grid gap-4 px-6 py-6 md:grid-cols-2">
        <div className="md:col-span-2">
          <Heading level="h2">Where you're permitted</Heading>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Cottage food rules are often set county by county, so put whatever
            identifies your jurisdiction.
          </Text>
        </div>
        <div>
          <Label size="small">Jurisdiction</Label>
          <Input
            placeholder="Riverside County, CA"
            value={form.jurisdiction_label}
            onChange={(e) => set("jurisdiction_label", e.target.value)}
          />
        </div>
        <div>
          <Label size="small">State</Label>
          <Input
            placeholder="CA"
            value={form.state_code}
            onChange={(e) => set("state_code", e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4 px-6 py-6 md:grid-cols-2">
        <div className="md:col-span-2">
          <Heading level="h2">Permit &amp; certification</Heading>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Add expiry dates and we'll remind you before they lapse. We don't
            verify these numbers.
          </Text>
        </div>
        <div>
          <Label size="small">Permit number</Label>
          <Input
            value={form.permit_number}
            onChange={(e) => set("permit_number", e.target.value)}
          />
        </div>
        <div>
          <Label size="small">Permit type</Label>
          <Input
            placeholder="Class A Cottage Food, MEHKO, …"
            value={form.permit_type_label}
            onChange={(e) => set("permit_type_label", e.target.value)}
          />
        </div>
        <div>
          <Label size="small">Issued by</Label>
          <Input
            value={form.permit_issuer}
            onChange={(e) => set("permit_issuer", e.target.value)}
          />
        </div>
        <div>
          <Label size="small">Permit expires</Label>
          <Input
            type="date"
            value={form.permit_expires_at}
            onChange={(e) => set("permit_expires_at", e.target.value)}
          />
        </div>
        <div>
          <Label size="small">Food handler certificate number</Label>
          <Input
            value={form.food_handler_cert_number}
            onChange={(e) => set("food_handler_cert_number", e.target.value)}
          />
        </div>
        <div>
          <Label size="small">Certificate expires</Label>
          <Input
            type="date"
            value={form.food_handler_expires_at}
            onChange={(e) => set("food_handler_expires_at", e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4 px-6 py-6 md:grid-cols-2">
        <div className="md:col-span-2">
          <Heading level="h2">Your limits</Heading>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Leave any of these blank and we simply won't track it — a blank
            limit is not a limit of zero.
          </Text>
        </div>
        <div>
          <Label size="small">Annual sales cap (USD)</Label>
          <Input
            placeholder="75000"
            value={form.annual_sales_cap}
            onChange={(e) => set("annual_sales_cap", e.target.value)}
          />
        </div>
        <div>
          <Label size="small">Your permit year starts in</Label>
          <Select
            value={form.cap_period_start_month}
            onValueChange={(v) => set("cap_period_start_month", v)}
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {MONTHS.map((month, index) => (
                <Select.Item key={month} value={String(index + 1)}>
                  {month}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          <Text size="xsmall" className="text-ui-fg-subtle mt-1">
            Most permit years don't start in January.
          </Text>
        </div>
        {tracksMeals && (
          <>
            <div>
              <Label size="small">Meals per day</Label>
              <Input
                placeholder="30"
                value={form.daily_meal_cap}
                onChange={(e) => set("daily_meal_cap", e.target.value)}
              />
            </div>
            <div>
              <Label size="small">Meals per week</Label>
              <Input
                placeholder="60"
                value={form.weekly_meal_cap}
                onChange={(e) => set("weekly_meal_cap", e.target.value)}
              />
            </div>
          </>
        )}
        <div>
          <Label size="small">Timezone</Label>
          <Input
            value={form.timezone}
            onChange={(e) => set("timezone", e.target.value)}
          />
          <Text size="xsmall" className="text-ui-fg-subtle mt-1">
            Decides when your daily count rolls over.
          </Text>
        </div>
      </div>

      <div className="flex flex-col gap-y-3 px-6 py-6">
        <Heading level="h2">How you sell</Heading>
        <Text size="xsmall" className="text-ui-fg-subtle max-w-2xl">
          These control what your storefront advertises. They don't block
          anything at checkout — if you turn shipping off here, we stop
          advertising it, but nothing is prevented.
        </Text>
        {(
          [
            ["allows_pickup", "Pickup"],
            ["allows_delivery", "Local delivery"],
            ["allows_shipping", "Shipping"],
            ["allows_out_of_state", "Out-of-state orders"],
            ["allows_wholesale", "Wholesale / resale"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex items-center gap-x-3">
            <Switch
              checked={form[key]}
              onCheckedChange={(checked) => set(key, checked)}
            />
            <Text size="small">{label}</Text>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-y-4 px-6 py-6">
        <Heading level="h2">What goes on your labels</Heading>
        <div>
          <Label size="small">Required disclosure sentence</Label>
          <Textarea
            rows={3}
            placeholder="Made in a home kitchen that is not inspected by the Department of State Health Services."
            value={form.label_disclosure_text}
            onChange={(e) => set("label_disclosure_text", e.target.value)}
          />
          <Text size="xsmall" className="text-ui-fg-subtle mt-1">
            Most jurisdictions require exact wording. Paste yours here verbatim
            and it'll go on every label you generate — we won't write it for
            you, because getting it slightly wrong is worse than leaving it out.
          </Text>
        </div>
        <div className="max-w-md">
          <Label size="small">Business name</Label>
          <Input
            value={form.label_business_name}
            onChange={(e) => set("label_business_name", e.target.value)}
          />
        </div>
        <div className="max-w-md">
          <Label size="small">Address</Label>
          <Textarea
            rows={2}
            value={form.label_address}
            onChange={(e) => set("label_address", e.target.value)}
          />
        </div>
        <Alert variant="warning" className="max-w-3xl">
          <div className="flex flex-col gap-y-1">
            <Text size="small" weight="plus">
              This is probably your home address.
            </Text>
            <Text size="small">
              It goes on the label in your customer's hand either way. It stays
              off your public storefront page unless you turn the next switch
              on.
            </Text>
          </div>
        </Alert>
        <div className="flex items-center gap-x-3">
          <Switch
            checked={form.show_address_publicly}
            onCheckedChange={(checked) => set("show_address_publicly", checked)}
          />
          <Text size="small">Show my address on my public storefront page</Text>
        </div>
        <div className="flex items-center gap-x-3">
          <Switch
            checked={form.public_disclosure_opt_in}
            onCheckedChange={(checked) => set("public_disclosure_opt_in", checked)}
          />
          <Text size="small">
            Show the home-kitchen disclosure and allergens to shoppers
          </Text>
        </div>
      </div>

      <div className="flex justify-end gap-x-2 px-6 py-4">
        <Button variant="secondary" onClick={() => navigate("/cottage-food")}>
          Cancel
        </Button>
        <Button onClick={handleSave} isLoading={save.isPending}>
          Save
        </Button>
      </div>
    </Container>
  )
}

export default CottageFoodProfilePage

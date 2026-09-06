import { useState } from "react"
import { Outlet } from "react-router-dom"
import { Container, Heading, Button, Text, Badge, Tabs, Switch, Input } from "@medusajs/ui"
import { Gift, CurrencyDollar } from "@medusajs/icons"
import { SingleColumnPage } from "../../../components/layout/pages"
import { useDashboardExtension } from "../../../extensions"
import { useVendorType } from "../../../providers/vendor-type-provider"
import {
  useDonationBeneficiaries,
  useDonationReport,
  useDonationSettings,
} from "../../../hooks/api/donations"

export function DonationsList() {
  const { vendorType } = useVendorType()
  const { getWidgets } = useDashboardExtension()
  const [activeTab, setActiveTab] = useState("received")

  const { data: settingsData } = useDonationSettings()
  const { data: reportData } = useDonationReport()
  const { data: beneficiariesData } = useDonationBeneficiaries()

  const settings = settingsData?.settings
  const report = reportData?.report
  const beneficiaries = beneficiariesData?.beneficiaries || []

  const getTerminology = () => {
    switch (vendorType) {
      case "mutual_aid":
        return {
          title: "Community Donations",
          description: "Track donations received and distributed to community members",
        }
      case "kitchen":
        return {
          title: "Kitchen Donations",
          description: "Manage food and supply donations for your community kitchen",
        }
      default:
        return {
          title: "Garden Donations",
          description: "Track harvest donations and community contributions",
        }
    }
  }

  const terminology = getTerminology()

  return (
    <SingleColumnPage
      widgets={{
        before: getWidgets("donation.list.before"),
        after: getWidgets("donation.list.after"),
      }}
    >
      <Container className="p-8 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <Heading level="h1" className="text-2xl font-serif text-warm-900">
              {terminology.title}
            </Heading>
            <Text className="text-warm-600 mt-1">{terminology.description}</Text>
          </div>
          <Badge color="blue">Donation settings enabled</Badge>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <SummaryCard
            label="Accrued"
            value={`$${((report?.totals?.accrued || 0) / 100).toFixed(2)}`}
            icon={<CurrencyDollar className="w-5 h-5" />}
            color="green"
          />
          <SummaryCard
            label="Outstanding"
            value={`$${((report?.totals?.outstanding || 0) / 100).toFixed(2)}`}
            icon={<Gift className="w-5 h-5" />}
            color="blue"
          />
          <SummaryCard
            label="Beneficiaries"
            value={String(beneficiaries.length)}
            icon={<Gift className="w-5 h-5" />}
            color="purple"
          />
        </div>

        <div className="rounded-xl border p-4 space-y-3">
          <Heading level="h3">Donation checkout settings</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            The default donation percent and round-up behavior used by storefront checkout are
            platform-wide and set by the operator. They are shown here for reference.
          </Text>
          <div className="grid grid-cols-2 gap-4 items-end">
            <label className="block">
              <Text size="small" className="mb-1">Default donation %</Text>
              <Input
                type="number"
                value={settings?.default_percentage ?? 0}
                readOnly
                disabled
              />
            </label>
            <div className="flex items-center justify-between border rounded p-3">
              <Text size="small">Round-up enabled</Text>
              <Switch checked={Boolean(settings?.round_up_enabled)} disabled />
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <Tabs.List>
            <Tabs.Trigger value="received">Received</Tabs.Trigger>
            <Tabs.Trigger value="distributed">Distributed</Tabs.Trigger>
            <Tabs.Trigger value="beneficiaries">Beneficiaries</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="received" className="mt-6">
            <DonationsPlaceholder type="received" />
          </Tabs.Content>

          <Tabs.Content value="distributed" className="mt-6">
            <DonationsPlaceholder type="distributed" />
          </Tabs.Content>

          <Tabs.Content value="beneficiaries" className="mt-6 space-y-2">
            {beneficiaries.length ? beneficiaries.map((b: any) => (
              <div key={b.id} className="rounded border p-3 flex items-center justify-between">
                <Text>{b.name}</Text>
                <Badge color={b.verification_status === "verified" ? "green" : "orange"}>{b.verification_status}</Badge>
              </div>
            )) : <DonorsPlaceholder />}
          </Tabs.Content>
        </Tabs>
      </Container>
      <Outlet />
    </SingleColumnPage>
  )
}

function SummaryCard({ label, value, icon, color }: { label: string; value: string; icon: JSX.Element; color: "green" | "blue" | "purple" }) {
  const colorClasses = {
    green: "bg-green-50 text-green-700",
    blue: "bg-blue-50 text-blue-700",
    purple: "bg-purple-50 text-purple-700",
  }

  return (
    <div className={`rounded-xl p-4 ${colorClasses[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <Text className="text-sm font-medium">{label}</Text>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}

function DonationsPlaceholder({ type }: { type: "received" | "distributed" }) {
  return (
    <div className="bg-warm-50 rounded-xl p-8 text-center">
      <Heading level="h3" className="text-lg font-medium text-warm-900 mb-2">
        No Donations {type === "received" ? "Recorded" : "Distributed"} Yet
      </Heading>
      <Text className="text-warm-600">
        {type === "received"
          ? "Record donations as they come in to track your community support."
          : "Track how donations are distributed to community members."}
      </Text>
    </div>
  )
}

function DonorsPlaceholder() {
  return (
    <div className="bg-warm-50 rounded-xl p-8 text-center">
      <Heading level="h3" className="text-lg font-medium text-warm-900 mb-2">No Beneficiaries Yet</Heading>
      <Text className="text-warm-600">Beneficiaries created by admins will appear here for donation routing.</Text>
    </div>
  )
}

export const Component = DonationsList

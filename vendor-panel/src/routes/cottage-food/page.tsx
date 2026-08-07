import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BuildingStorefront, InformationCircle } from "@medusajs/icons"
import { Container, Heading, Text, Button, Badge, Alert } from "@medusajs/ui"
import { Link } from "react-router-dom"
import {
  useComplianceSnapshot,
  useOnboardingStatus,
  useSaveProfile,
  LimitMeter,
  ExpiryRow,
  formatUsd,
} from "./_shared"

/**
 * Cottage Food dashboard — the page a home producer opens in the morning.
 *
 * The three questions it answers, in the order they matter: how many meals am
 * I already committed to today, how much of my annual cap have I used, and is
 * any of my paperwork about to lapse.
 *
 * Nothing on this page blocks anything. Every figure is measured against a
 * limit the seller entered themselves, and a seller over one of their own
 * limits sees a plain statement of where they stand.
 */
const CottageFoodDashboard = () => {
  const { data: snapshot, isLoading } = useComplianceSnapshot()
  const { data: onboarding } = useOnboardingStatus()
  const createProfile = useSaveProfile()

  if (isLoading) {
    return (
      <Container className="p-8">
        <Text className="text-ui-fg-subtle">Loading…</Text>
      </Container>
    )
  }

  if (!snapshot?.has_profile) {
    return (
      <Container className="divide-y p-0">
        <div className="flex flex-col gap-y-4 px-6 py-8">
          <Heading level="h1">Cottage food &amp; home kitchen</Heading>
          <Text className="text-ui-fg-subtle max-w-2xl">
            If you bake, can, or cook out of your own kitchen, this is where you
            keep track of the things that govern that work: how close you are to
            the sales cap on your permit, how many meals you've committed to
            today, when your permit and food handler card expire, and what your
            labels need to say.
          </Text>
          <Text className="text-ui-fg-subtle max-w-2xl">
            Free Black Market doesn't decide any of that for you. Cottage food
            rules differ by state and often by county, so you tell us the limits
            you operate under and we keep an honest count against them. Nothing
            here will ever stop a sale.
          </Text>
          <div>
            <Button
              onClick={() => createProfile.mutate({})}
              isLoading={createProfile.isPending}
            >
              Set this up
            </Button>
          </div>
        </div>
      </Container>
    )
  }

  const { annual, today, this_week, tracks_meals, advisories } = snapshot
  const remaining = onboarding?.remaining ?? 0

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Cottage food &amp; home kitchen</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Tracked against the limits you entered.
          </Text>
        </div>
        <div className="flex gap-x-2">
          <Link to="/cottage-food/sales">
            <Button variant="secondary" size="small">
              Sales log
            </Button>
          </Link>
          <Link to="/cottage-food/labels">
            <Button variant="secondary" size="small">
              Labels
            </Button>
          </Link>
          <Link to="/cottage-food/profile">
            <Button variant="secondary" size="small">
              Profile
            </Button>
          </Link>
        </div>
      </div>

      {advisories.length > 0 && (
        <div className="flex flex-col gap-y-2 px-6 py-4">
          {advisories.map((advisory) => (
            <Alert key={advisory} variant="info">
              {advisory}
            </Alert>
          ))}
          <Text size="xsmall" className="text-ui-fg-subtle">
            These are notes on limits you set for yourself. They don't restrict
            your store, and no order will be turned away because of them.
          </Text>
        </div>
      )}

      {tracks_meals && (
        <div className="grid gap-6 px-6 py-6 md:grid-cols-2">
          <LimitMeter
            title="Meals today"
            meter={today}
            hint="Resets at midnight in your timezone."
          />
          <LimitMeter title="Meals this week" meter={this_week} hint="Week starts Sunday." />
        </div>
      )}

      <div className="flex flex-col gap-y-4 px-6 py-6">
        <LimitMeter
          title="Sales this permit year"
          meter={annual}
          format={formatUsd}
        />
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <Text size="xsmall" className="text-ui-fg-subtle">
            Through Free Black Market: {formatUsd(annual.on_platform_cents)}
          </Text>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Entered by you: {formatUsd(annual.self_reported_cents)}
          </Text>
        </div>
        <Alert variant="info" className="max-w-3xl">
          <div className="flex flex-col gap-y-1">
            <Text size="small" weight="plus">
              Sales you make elsewhere count too.
            </Text>
            <Text size="small">
              Farmers markets, cash, and orders taken off the platform usually
              count toward the same cap. Add them on the{" "}
              <Link className="underline" to="/cottage-food/sales">
                sales log
              </Link>{" "}
              so this number reflects what you'd actually report.
            </Text>
          </div>
        </Alert>
      </div>

      <div className="grid gap-6 px-6 py-6 md:grid-cols-2">
        <ExpiryRow title="Permit" view={snapshot.permit} />
        <ExpiryRow title="Food handler certification" view={snapshot.food_handler} />
      </div>

      {remaining > 0 && (
        <div className="flex items-center justify-between gap-x-4 px-6 py-4">
          <div className="flex items-start gap-x-2">
            <InformationCircle className="text-ui-fg-subtle mt-0.5" />
            <Text size="small" className="text-ui-fg-subtle">
              {remaining} thing{remaining === 1 ? "" : "s"} left to fill in
              before these meters tell you much.
            </Text>
          </div>
          <Link to="/cottage-food/profile">
            <Button variant="secondary" size="small">
              Finish setup
            </Button>
          </Link>
        </div>
      )}

      {onboarding?.checklist?.length ? (
        <div className="flex flex-col gap-y-3 px-6 py-6">
          <Heading level="h2">Setup</Heading>
          {onboarding.checklist.map((item) => (
            <div key={item.key} className="flex items-start justify-between gap-x-4">
              <div className="flex flex-col">
                <Text size="small" weight="plus">
                  {item.label}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle max-w-xl">
                  {item.why}
                </Text>
              </div>
              <Badge size="2xsmall" color={item.done ? "green" : "grey"}>
                {item.done ? "Added" : "Optional"}
              </Badge>
            </div>
          ))}
        </div>
      ) : null}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Cottage food",
  icon: BuildingStorefront,
})

export default CottageFoodDashboard

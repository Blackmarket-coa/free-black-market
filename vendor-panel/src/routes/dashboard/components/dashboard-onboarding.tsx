import { 
  Container, 
  Heading, 
  Text, 
  Badge,
  Button,
} from "@medusajs/ui"
import { OnboardingRow } from "./onboarding-row"
import { useUpdateOnboarding } from "../../../hooks/api"
import { useEffect, useState } from "react"
import { 
  BuildingStorefront, 
  ShoppingCart, 
  MapPin, 
  QuestionMarkCircle,
  BookOpen,
  LightBulb,
  ArrowRight,
  Tag,
  Heart,
  SquaresPlus,
  Newspaper,
  CalendarMini,
} from "@medusajs/icons"
import { Link } from "react-router-dom"
import type { SellingSetup } from "../../../lib/selling-setup"
import { useVendorType } from "../../../providers/vendor-type-provider"
import { 
  getDashboardTitle, 
  getWelcomeMessage, 
  getOnboardingSteps,
  getBeginnerTips,
} from "../config/dashboard-config"

type DashboardProps = {
  /** The store's delivery and listings, read back from the backend. */
  selling?: SellingSetup | null
  store_information?: boolean
  stripe_connection?: boolean
  menu?: boolean
  plots?: boolean
  volunteers?: boolean
  seasons?: boolean
  harvests?: boolean
  support?: boolean
}

// Icon map for onboarding steps
const ICON_MAP: Record<string, any> = {
  Building: BuildingStorefront,
  MapPin: MapPin,
  Tag: Tag,
  Heart: Heart,
  SquaresPlus: SquaresPlus,
  Newspaper: Newspaper,
  Calendar: CalendarMini,
  QuestionMarkCircle: QuestionMarkCircle,
  ShoppingCart: ShoppingCart,
}

// Help resources
const HELP_RESOURCES = [
  {
    title: "Getting Started Guide",
    description: "Learn the basics of offering products on our marketplace",
    link: "#",
    icon: BookOpen,
  },
  {
    title: "Shipping Best Practices",
    description: "Set up shipping zones and rates effectively",
    link: "/settings/locations",
    icon: MapPin,
  },
  {
    title: "Need Help?",
    description: "Contact our vendor support team",
    link: "#",
    icon: QuestionMarkCircle,
  },
]

export const DashboardOnboarding = ({
  selling,
  store_information,
  stripe_connection,
  menu,
  plots,
  volunteers,
  seasons,
  harvests,
  support,
}: DashboardProps) => {
  const { mutateAsync } = useUpdateOnboarding()
  const [showTips, setShowTips] = useState(true)
  const { vendorType, features, typeLabel } = useVendorType()

  useEffect(() => {
    mutateAsync()
  }, [])

  // Get type-specific content with defensive fallbacks
  const welcomeMessage = getWelcomeMessage(vendorType) ?? "Manage your store, products, and orders."
  const onboardingSteps = getOnboardingSteps(vendorType, features, selling) ?? []
  const beginnerTips = getBeginnerTips(vendorType) ?? []

  // Build completion map from props. Delivery and products are done by what
  // a buyer needs (lib/selling-setup.ts), not by Mercur's flags, which turn
  // true for any stock location and any product, a draft included.
  const completionMap: Record<string, boolean> = {
    store_information: Boolean(store_information),
    delivery: Boolean(selling?.delivery.ready),
    products: Boolean(selling?.listing.buyable),
    stripe_connection: Boolean(stripe_connection),
    menu: Boolean(menu),
    plots: Boolean(plots),
    volunteers: Boolean(volunteers),
    seasons: Boolean(seasons),
    harvests: Boolean(harvests),
    support: Boolean(support),
  }

  // Calculate progress based on actual steps
  const completedSteps = onboardingSteps.filter(step => completionMap[step.key]).length
  const totalSteps = onboardingSteps.length
  const progressPercent = Math.round((completedSteps / totalSteps) * 100)

  // Get badge color based on vendor type
  const getBadgeColor = () => {
    switch (vendorType) {
      case "producer": return "green"
      case "garden": return "blue"
      case "maker": return "orange"
      case "restaurant": return "purple"
      case "mutual_aid": return "red"
      default: return "grey"
    }
  }

  return (
    <div className="space-y-4">
      {/* Welcome Header with Progress */}
      <Container className="p-0 overflow-hidden">
        <div className="bg-gradient-to-r from-ui-bg-subtle to-ui-bg-base px-6 py-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <Badge color="green">Getting Started</Badge>
                {vendorType !== "default" && (
                  <Badge color={getBadgeColor()}>{typeLabel}</Badge>
                )}
              </div>
              <Heading level="h1" className="text-2xl">
                Welcome to Your {typeLabel} Dashboard! 🎉
              </Heading>
              <Text className="text-ui-fg-subtle max-w-lg">
                {welcomeMessage} Complete the setup below to get started.
              </Text>
            </div>
            <div className="hidden md:flex flex-col items-end gap-2">
              <div className="text-right">
                <Text className="text-ui-fg-subtle text-sm">Setup Progress</Text>
                <Text className="text-2xl font-bold text-ui-fg-base">{progressPercent}%</Text>
              </div>
              <div className="w-32 h-2 bg-ui-bg-switch rounded-full overflow-hidden">
                <div 
                  className="h-full bg-ui-tag-green-icon rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>
        </div>
        
        {/* Setup Steps */}
        <div className="px-6 py-4 space-y-1">
          <div className="flex items-center gap-2 mb-4">
            <Text className="font-medium">Complete these steps to start:</Text>
            <Badge size="xsmall">{completedSteps}/{totalSteps} Complete</Badge>
          </div>
          
          {onboardingSteps.map((step, index) => {
            const IconComponent = ICON_MAP[step.icon] || BuildingStorefront
            return (
              <OnboardingRow
                key={step.key}
                label={step.title}
                description={step.description}
                state={completionMap[step.key] || false}
                link={step.to}
                buttonLabel={step.title.replace("Set up", "Set Up").replace("Add", "Add")}
                stepNumber={index + 1}
                icon={IconComponent}
              />
            )
          })}
        </div>
      </Container>

      {/* Tips for Success */}
      {showTips && (
        <Container className="p-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-ui-border-base">
            <div className="flex items-center gap-2">
              <LightBulb className="text-ui-tag-orange-icon" />
              <Heading level="h2">Tips for {typeLabel}s</Heading>
            </div>
            <Button 
              variant="transparent" 
              size="small"
              onClick={() => setShowTips(false)}
            >
              Dismiss
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6">
            {beginnerTips.map((tip, index) => (
              <div 
                key={index}
                className="p-4 rounded-lg bg-ui-bg-subtle border border-ui-border-base"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-ui-tag-orange-bg">
                    <LightBulb className="w-4 h-4 text-ui-tag-orange-icon" />
                  </div>
                  <div>
                    <Text className="font-medium text-ui-fg-base">{tip.title}</Text>
                    <Text className="text-ui-fg-subtle text-sm mt-1">{tip.description}</Text>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Container>
      )}

      {/* Quick Links & Resources */}
      <Container className="p-0">
        <div className="px-6 py-4 border-b border-ui-border-base">
          <div className="flex items-center gap-2">
            <QuestionMarkCircle className="text-ui-fg-muted" />
            <Heading level="h2">Need Help?</Heading>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-ui-border-base">
          {HELP_RESOURCES.map((resource, index) => (
            <Link 
              key={index}
              to={resource.link}
              className="flex items-center gap-4 p-6 hover:bg-ui-bg-subtle transition-colors group"
            >
              <div className="p-3 rounded-lg bg-ui-bg-subtle group-hover:bg-ui-bg-base transition-colors">
                <resource.icon className="w-5 h-5 text-ui-fg-muted" />
              </div>
              <div className="flex-1">
                <Text className="font-medium text-ui-fg-base">{resource.title}</Text>
                <Text className="text-ui-fg-subtle text-sm">{resource.description}</Text>
              </div>
              <ArrowRight className="w-4 h-4 text-ui-fg-muted group-hover:text-ui-fg-base transition-colors" />
            </Link>
          ))}
        </div>
      </Container>
    </div>
  )
}

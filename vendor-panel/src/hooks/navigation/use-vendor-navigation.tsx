import {
  Buildings,
  ChartBar,
  CogSixTooth,
  CurrencyDollar,
  ReceiptPercent,
  ShoppingCart,
  Tag,
  Users,
  Component,
  Star,
  ListCheckbox,
  ChatBubbleLeftRight,
  CalendarMini,
  CashSolid,
  Gift,
  Heart,
  Newspaper,
  SquaresPlus,
  MapPin,
} from "@medusajs/icons"
import { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useVendorType, VendorType, VendorFeatures } from "../../providers/vendor-type-provider"
import { useRocketChat } from "../../providers/rocketchat-provider"
import { StripeIcon } from "../../assets/icons/Stripe"
import { phase1ModuleFlags } from "../../lib/phase0-feature-flags"

/**
 * Navigation Item Interface
 */
export interface NavItemConfig {
  icon: ReactNode
  label: string
  to: string
  items?: NavChildItemConfig[]
  // Feature flags for conditional display
  showFor?: (features: VendorFeatures, type: VendorType) => boolean
  // Override labels per vendor type
  labelByType?: Partial<Record<VendorType, string>>
}


export interface NavChildItemConfig {
  label: string
  to: string
  showFor?: (features: VendorFeatures, type: VendorType) => boolean
}

/**
 * Get type-specific label or default
 */
function getTypeLabel(item: NavItemConfig, vendorType: VendorType): string {
  if (item.labelByType && item.labelByType[vendorType]) {
    return item.labelByType[vendorType]!
  }
  return item.label
}

function getVendorNavigationConfig({
  t,
  vendorType,
  features,
  unreadCount,
}: {
  t: (key: string) => string
  vendorType: VendorType
  features: VendorFeatures
  unreadCount: number
}) {


  /**
   * Core navigation routes with conditional visibility
   */
  const coreRoutes: NavItemConfig[] = [
    {
      icon: <Component />,
      label: "Dashboard",
      to: "/dashboard",
      // Always visible
    },
    {
      icon: <CashSolid />,
      label: "Finances",
      to: "/finances",
      labelByType: {
        mutual_aid: "Donations",
        garden: "Funds",
      },
      // Always visible
    },
    {
      icon: <ChartBar />,
      label: "Sales Report",
      to: "/sales-report",
      // Always visible
    },
    {
      icon: <Star />,
      label: "Creator Studio",
      to: "/creator-studio",
      // Visible to all sellers; the page itself surfaces only the creator's
      // own attributions and links so non-creator vendors will see empty
      // panels until they opt in by setting vendor_type=creator.
    },
    {
      icon: <Star />,
      label: "Creator Programs",
      to: "/programs",
      showFor: (_, type) => type !== "creator",
    },
    {
      icon: <SquaresPlus />,
      label: "Services",
      to: "/services",
      // Visible to all sellers — both buyers (who post bounties / subcontract
      // order line items) and service providers (who claim bounties and
      // submit proofs of work) use this surface.
    },
    {
      icon: <ShoppingCart />,
      label: t("orders.domain"),
      to: "/orders",
      labelByType: {
        garden: "Harvest Orders",
        restaurant: "Food Orders",
        mutual_aid: "Requests",
      },
      // Always visible
    },
    {
      icon: <Tag />,
      label: t("products.domain"),
      to: "/products",
      showFor: (f) => f.hasProducts,
      labelByType: {
        garden: "Harvests",
        producer: "Products",
        maker: "Creations",
      },
      items: [
        {
          label: t("collections.domain"),
          to: "/collections",
        },
        {
          label: t("categories.domain"),
          to: "/categories",
        },
      ],
    },
    // Menu items for restaurants
    {
      icon: <Newspaper />,
      label: "Menu",
      to: "/menu",
      showFor: (f) => f.hasMenu,
      items: [
        {
          label: "Menu Items",
          to: "/menu/items",
        },
        {
          label: "Menu Categories",
          to: "/menu/categories",
        },
      ],
    },
    // Garden plots
    {
      icon: <SquaresPlus />,
      label: "Plots",
      to: "/plots",
      showFor: (f) => f.hasPlots,
      items: [
        {
          label: "Available Plots",
          to: "/plots/available",
        },
        {
          label: "Plot Assignments",
          to: "/plots/assignments",
        },
      ],
    },
    // Volunteers for gardens and mutual aid
    {
      icon: <Heart />,
      label: "Volunteers",
      to: "/volunteers",
      showFor: (f) => f.hasVolunteers,
      items: [
        {
          label: "Volunteer List",
          to: "/volunteers/list",
        },
        {
          label: "Schedule",
          to: "/volunteers/schedule",
        },
      ],
    },
    // Donations for gardens and mutual aid
    {
      icon: <Gift />,
      label: "Donations",
      to: "/donations",
      showFor: (f) => f.hasDonations,
    },
    // Order Cycles (for subscriptions)
    {
      icon: <CalendarMini />,
      label: "Order Cycles",
      to: "/order-cycles",
      showFor: (f) => f.hasSubscriptions || f.hasSeasons,
      labelByType: {
        garden: "Harvest Cycles",
        producer: "Season Cycles",
      },
    },
    // Inventory
    {
      icon: <Buildings />,
      label: t("inventory.domain"),
      to: "/inventory",
      showFor: (f) => f.hasInventory,
      labelByType: {
        mutual_aid: "Resources",
      },
      items: [
        {
          label: t("reservations.domain"),
          to: "/reservations",
        },
      ],
    },
    // Delivery orders for restaurants and mutual aid
    {
      icon: <ShoppingCart />,
      label: "Delivery Orders",
      to: "/deliveries",
      showFor: (f) => f.hasDeliveryZones,
      labelByType: {
        mutual_aid: "Distribution Runs",
      },
    },
    // Delivery zones for restaurants and mutual aid
    {
      icon: <MapPin />,
      label: "Delivery Zones",
      to: "/delivery-zones",
      showFor: (f) => f.hasDeliveryZones,
      labelByType: {
        mutual_aid: "Service Areas",
      },
    },
    // Customers
    {
      icon: <Users />,
      label: t("customers.domain"),
      to: "/customers",
      labelByType: {
        garden: "Members",
        mutual_aid: "Community",
      },
      items: [
        {
          label: t("customerGroups.domain"),
          to: "/customer-groups",
        },
      ],
    },
    // Promotions
    {
      icon: <ReceiptPercent />,
      label: t("promotions.domain"),
      to: "/promotions",
      showFor: (f) => f.hasProducts || f.hasMenu,
      items: [
        {
          label: t("campaigns.domain"),
          to: "/campaigns",
        },
      ],
    },
    // Price Lists
    {
      icon: <CurrencyDollar />,
      label: t("priceLists.domain"),
      to: "/price-lists",
      showFor: (f) => f.hasProducts,
    },
    // Reviews
    {
      icon: <Star />,
      label: "Reviews",
      to: "/reviews",
      showFor: (f) => f.hasProducts || f.hasMenu,
    },
    // Messages
    {
      icon: <ChatBubbleLeftRight />,
      label: `Messages ${unreadCount > 0 ? `(${unreadCount})` : ""}`,
      to: "/messages",
      showFor: (f) => f.hasSupport || f.hasRequests || f.hasProducts || f.hasMenu,
      labelByType: {
        producer: "Support Messages",
        garden: "Support Messages",
        maker: "Support Messages",
        kitchen: "Support Messages",
      },
    },
    // Requests
    {
      icon: <ListCheckbox />,
      label: "Requests",
      to: "/requests",
      showFor: (f) => f.hasRequests || f.hasProducts,
      labelByType: {
        mutual_aid: "Support Requests",
      },
      items: [
        {
          label: "Orders",
          to: "/requests/orders",
        },
        {
          label: "Collections",
          to: "/requests/collections",
        },
        {
          label: "Categories",
          to: "/requests/categories",
        },
        {
          label: "Reviews",
          to: "/requests/reviews",
        },
      ],
    },
    {
      icon: <Buildings />,
      label: "Farm",
      to: "/farm",
      showFor: (f) => f.hasFarm,
      items: [
        {
          label: "Profile",
          to: "/farm/profile/edit",
        },
        {
          label: "Harvests",
          to: "/farm/harvests",
          showFor: (f) => f.hasHarvests,
        },
      ],
    },
  ]

  /**
   * Extension routes (integrations)
   */
  const extensionRoutes: NavItemConfig[] = [
    {
      icon: <Component />,
      label: "POS",
      to: "/pos",
      showFor: () => phase1ModuleFlags.pos,
    },
    {
      icon: <Tag />,
      label: "Weight Pricing",
      to: "/products?view=weight-pricing",
      showFor: () => phase1ModuleFlags.weightPricing,
    },
    {
      icon: <ListCheckbox />,
      label: "Pick / Pack",
      to: "/deliveries?view=pick-pack",
      showFor: () => phase1ModuleFlags.pickPack,
    },
    {
      icon: <ReceiptPercent />,
      label: "Invoicing",
      to: "/finances?view=invoicing",
      showFor: () => phase1ModuleFlags.invoicing,
    },
    {
      icon: <ShoppingCart />,
      label: "Channel Sync",
      to: "/settings/extensions?view=channel-sync",
      showFor: () => phase1ModuleFlags.channelSync,
    },
    {
      icon: <StripeIcon />,
      label: "Stripe Connect",
      to: "/stripe-connect",
    },
    {
      icon: <Buildings />,
      label: "Venues",
      to: "/venues",
      showFor: (_, type) => type === "restaurant",
    },
    {
      icon: <CalendarMini />,
      label: "Shows",
      to: "/shows",
      showFor: (f) => f.hasShows,
    },
    {
      icon: <ShoppingCart />,
      label: "Collective Buys",
      to: "/collective-demand-pools",
      showFor: (f) => f.hasProducts || f.hasMenu || f.hasInventory,
    },
  ]

  /**
   * Filter routes based on vendor type and features
   */
  function filterRoutes(routes: NavItemConfig[]): NavItemConfig[] {
    return routes
      .filter((route) => {
        // If no showFor function, always show
        if (!route.showFor) return true
        // Otherwise, check if should show
        return route.showFor(features, vendorType)
      })
      .map((route) => ({
        ...route,
        items: route.items?.filter((item) => !item.showFor || item.showFor(features, vendorType)),
      }))
  }

  /**
   * Get routes with type-specific labels
   */
  function getRoutesWithLabels(routes: NavItemConfig[]): NavItemConfig[] {
    return routes.map((route) => ({
      ...route,
      label: getTypeLabel(route, vendorType),
    }))
  }

  return {
    coreRoutes: getRoutesWithLabels(filterRoutes(coreRoutes)),
    extensionRoutes: getRoutesWithLabels(filterRoutes(extensionRoutes)),
  }
}

/**
 * Custom hook that returns navigation routes filtered by vendor type
 */
export function useVendorNavigation() {
  const { t } = useTranslation()
  const { vendorType, features } = useVendorType()
  const { unreadCount } = useRocketChat()

  const { coreRoutes, extensionRoutes } = getVendorNavigationConfig({
    t,
    vendorType,
    features,
    unreadCount,
  })

  return {
    coreRoutes,
    extensionRoutes,
    vendorType,
    features,
  }
}

/**
 * Test helper for validating navigation visibility without hook wiring.
 */
export function getVendorNavigationForTest(params: {
  vendorType: VendorType
  features: VendorFeatures
  unreadCount?: number
  t?: (key: string) => string
}) {
  const { vendorType, features, unreadCount = 0, t = (key) => key } = params
  return getVendorNavigationConfig({ t, vendorType, features, unreadCount })
}

/**
 * Settings routes are mostly universal
 */
export function useSettingsNavigation() {
  const { t } = useTranslation()
  const { vendorType, features } = useVendorType()

  const settingsRoutes: NavItemConfig[] = [
    {
      icon: <CogSixTooth />,
      label: t("app.nav.settings.header"),
      to: "/settings",
    },
  ]

  return {
    settingsRoutes,
    vendorType,
    features,
  }
}

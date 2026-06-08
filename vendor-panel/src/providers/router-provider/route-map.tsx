import { HttpTypes } from "@medusajs/types"
import { Navigate, Outlet, RouteObject, UIMatch } from "react-router-dom"

import { t } from "i18next"
import { ProtectedRoute } from "../../components/authentication/protected-route"
import { MainLayout } from "../../components/layout/main-layout"
import { PublicLayout } from "../../components/layout/public-layout"
import { SettingsLayout } from "../../components/layout/settings-layout"
import { ErrorBoundary } from "../../components/utilities/error-boundary"
import { TaxRegionDetailBreadcrumb } from "../../routes/tax-regions/tax-region-detail/breadcrumb"
import { taxRegionLoader } from "../../routes/tax-regions/tax-region-detail/loader"
import { RouteExtensions } from "./route-extensions"
import { SettingsExtensions } from "./settings-extensions"
import { ExtendedAdminOrderResponse } from "../../types/order"
import { ExtendedAdminProductResponse } from "../../types/products"

export const RouteMap: RouteObject[] = [
  {
    element: <ProtectedRoute />,
    errorElement: <ErrorBoundary />,
    children: [
      {
        path: "onboarding",
        errorElement: <ErrorBoundary />,
        lazy: () => import("../../routes/onboarding"),
      },
      {
        element: <MainLayout />,
        children: [
          {
            path: "/",
            errorElement: <ErrorBoundary />,
            lazy: () => import("../../routes/home"),
          },
          {
            path: "stripe-connect",
            handle: {
              breadcrumb: () => "Stripe Connects",
            },
            errorElement: <ErrorBoundary />,
            lazy: () => import("../../routes/stripe-connect"),
          },
          {
            path: "dashboard",
            errorElement: <ErrorBoundary />,
            lazy: () => import("../../routes/dashboard"),
          },
          {
            path: "finances",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Finances",
            },
            lazy: () => import("../../routes/finances"),
          },
          {
            path: "pos",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "POS",
            },
            lazy: () => import("../../routes/pos"),
          },
          {
            path: "sales-report",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Sales Report",
            },
            lazy: () => import("../../routes/sales-report"),
          },
          {
            path: "creator-studio",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Creator Studio",
            },
            lazy: () => import("../../routes/creator-studio"),
          },
          {
            path: "programs",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Creator Programs",
            },
            lazy: () => import("../../routes/programs"),
          },
          {
            path: "find-creators",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Find Creators",
            },
            lazy: () => import("../../routes/find-creators"),
          },
          {
            path: "referral-links",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Referral Links",
            },
            lazy: () => import("../../routes/referral-links"),
          },
          {
            path: "services",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Services",
            },
            lazy: () => import("../../routes/services"),
          },
          {
            path: "bounties",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Bounties",
            },
            lazy: () => import("../../routes/bounties"),
          },
          {
            path: "launch-business",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Launch a Business",
            },
            lazy: () => import("../../routes/launch-business"),
          },
          {
            path: "growth",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Growth",
            },
            lazy: () => import("../../routes/growth"),
          },
          {
            path: "plugins",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Plugins",
            },
            lazy: () => import("../../routes/plugins"),
          },
          {
            path: "/requests",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Requests",
            },
            children: [
              {
                path: "",
                lazy: async () => {
                  const { Requests } = await import(
                    "../../routes/requests/requests-list"
                  )

                  return {
                    Component: Requests,
                  }
                },
              },
              {
                path: "categories",
                handle: {
                  breadcrumb: () => "Categories requests",
                },
                lazy: async () => {
                  const { RequestsCategoriesList } = await import(
                    "../../routes/requests/requests-list"
                  )

                  return {
                    Component: RequestsCategoriesList,
                  }
                },
                children: [
                  {
                    path: "create",
                    lazy: () =>
                      import("../../routes/categories/category-create"),
                  },
                  {
                    path: ":id/edit",
                    lazy: () => import("../../routes/categories/category-edit"),
                  },
                ],
              },
              {
                path: "collections",
                handle: {
                  breadcrumb: () => "Collection requests",
                },
                lazy: async () => {
                  const { RequestsCollectionsList } = await import(
                    "../../routes/requests/requests-list"
                  )

                  return {
                    Component: RequestsCollectionsList,
                  }
                },
                children: [
                  {
                    path: "create",
                    lazy: () =>
                      import("../../routes/collections/collection-create"),
                  },
                  {
                    path: ":id/edit",
                    lazy: () =>
                      import("../../routes/collections/collection-edit"),
                  },
                ],
              },
              {
                path: "reviews",
                handle: {
                  breadcrumb: () => "Reviews requests",
                },
                lazy: async () => {
                  const { RequestReviewsList } = await import(
                    "../../routes/requests/requests-list"
                  )

                  return {
                    Component: RequestReviewsList,
                  }
                },
                children: [
                  {
                    path: ":id/edit",
                    lazy: () => import("../../routes/reviews/review-report"),
                  },
                ],
              },
              {
                path: "orders",
                handle: {
                  breadcrumb: () => "Orders requests",
                },
                lazy: async () => {
                  const { RequestOrdersList } = await import(
                    "../../routes/requests/requests-list"
                  )

                  return {
                    Component: RequestOrdersList,
                  }
                },
                children: [
                  {
                    path: ":id/review",
                    lazy: async () =>
                      await import(
                        "../../routes/requests/request-order-return"
                      ),
                  },
                ],
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/requests/request-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (match: UIMatch<any>) => (
                        <Breadcrumb {...match} />
                      ),
                    },
                  }
                },
              },
            ],
          },
          {
            path: "/messages",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Messages",
            },
            lazy: () => import("../../routes/messages"),
          },
          {
            path: "/reviews",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Reviews",
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/reviews/reviews-list"),
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/reviews/review-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (match: UIMatch<any>) => (
                        <Breadcrumb {...match} />
                      ),
                    },
                  }
                },
                children: [
                  {
                    path: "reply",
                    lazy: () => import("../../routes/reviews/review-reply"),
                  },
                  {
                    path: "report",
                    lazy: () => import("../../routes/reviews/review-report"),
                  },
                ],
              },
            ],
          },
          {
            path: "/products",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => t("products.domain"),
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/products/product-list"),
                children: [
                  {
                    path: "create",
                    lazy: () => import("../../routes/products/product-create"),
                  },
                  {
                    path: "import",
                    lazy: () => import("../../routes/products/product-import"),
                  },
                  {
                    path: "export",
                    lazy: () => import("../../routes/products/product-export"),
                  },
                ],
              },
              {
                path: ":id",
                errorElement: <ErrorBoundary />,
                lazy: async () => {
                  const { Breadcrumb, loader } = await import(
                    "../../routes/products/product-detail"
                  )

                  return {
                    Component: Outlet,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<ExtendedAdminProductResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "",
                    lazy: () => import("../../routes/products/product-detail"),
                    children: [
                      {
                        path: "additional-attributes",
                        lazy: () =>
                          import(
                            "../../routes/products/product-additional-attributes"
                          ),
                      },
                      {
                        path: "edit",
                        lazy: () =>
                          import("../../routes/products/product-edit"),
                      },
                      {
                        path: "edit-variant",
                        lazy: () =>
                          import(
                            "../../routes/product-variants/product-variant-edit"
                          ),
                      },
                      {
                        path: "sales-channels",
                        lazy: () =>
                          import(
                            "../../routes/products/product-sales-channels"
                          ),
                      },
                      {
                        path: "attributes",
                        lazy: () =>
                          import("../../routes/products/product-attributes"),
                      },
                      {
                        path: "organization",
                        lazy: () =>
                          import("../../routes/products/product-organization"),
                      },
                      {
                        path: "shipping-profile",
                        lazy: () =>
                          import(
                            "../../routes/products/product-shipping-profile"
                          ),
                      },
                      {
                        path: "media",
                        lazy: () =>
                          import("../../routes/products/product-media"),
                      },
                      {
                        path: "prices",
                        lazy: () =>
                          import("../../routes/products/product-prices"),
                      },
                      {
                        path: "options/create",
                        lazy: () =>
                          import("../../routes/products/product-create-option"),
                      },
                      {
                        path: "options/:option_id/edit",
                        lazy: () =>
                          import("../../routes/products/product-edit-option"),
                      },
                      {
                        path: "variants/create",
                        lazy: () =>
                          import(
                            "../../routes/products/product-create-variant"
                          ),
                      },
                      {
                        path: "stock",
                        lazy: () =>
                          import("../../routes/products/product-stock"),
                      },
                      {
                        path: "metadata/edit",
                        lazy: () =>
                          import("../../routes/products/product-metadata"),
                      },
                      {
                        path: "edit-stocks-and-prices",
                        lazy: () =>
                          import(
                            "../../routes/products/product-edit-stocks-and-prices"
                          ),
                      },
                    ],
                  },
                  {
                    path: "variants/:variant_id",
                    lazy: async () => {
                      const { Component, Breadcrumb, loader } = await import(
                        "../../routes/product-variants/product-variant-detail"
                      )

                      return {
                        Component,
                        loader,
                        handle: {
                          breadcrumb: (
                            // eslint-disable-next-line max-len
                            match: UIMatch<HttpTypes.AdminProductVariantResponse>
                          ) => <Breadcrumb {...match} />,
                        },
                      }
                    },
                    children: [
                      {
                        path: "edit",
                        lazy: () =>
                          import(
                            "../../routes/product-variants/product-variant-edit"
                          ),
                      },
                      {
                        path: "prices",
                        lazy: () =>
                          import("../../routes/products/product-prices"),
                      },
                      {
                        path: "manage-items",
                        lazy: () =>
                          import(
                            "../../routes/product-variants/product-variant-manage-inventory-items"
                          ),
                      },
                      {
                        path: "metadata/edit",
                        lazy: () =>
                          import(
                            "../../routes/product-variants/product-variant-metadata"
                          ),
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            path: "/categories",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => t("categories.domain"),
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/categories/category-list"),
                children: [
                  {
                    path: "create",
                    lazy: () =>
                      import("../../routes/categories/category-create"),
                  },
                  {
                    path: "organize",
                    lazy: () =>
                      import("../../routes/categories/category-organize"),
                  },
                ],
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/categories/category-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminProductCategoryResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () => import("../../routes/categories/category-edit"),
                  },
                  {
                    path: "products",
                    lazy: () =>
                      import("../../routes/categories/category-products"),
                  },
                  {
                    path: "organize",
                    lazy: () =>
                      import("../../routes/categories/category-organize"),
                  },
                  {
                    path: "metadata/edit",
                    lazy: () =>
                      import("../../routes/categories/categories-metadata"),
                  },
                ],
              },
            ],
          },
          {
            path: "/orders",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => t("orders.domain"),
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/orders/order-list"),
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/orders/order-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<ExtendedAdminOrderResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "fulfillment",
                    lazy: () =>
                      import("../../routes/orders/order-create-fulfillment"),
                  },
                  {
                    path: "allocate-items",
                    lazy: () =>
                      import("../../routes/orders/order-allocate-items"),
                  },
                  {
                    path: ":f_id/create-shipment",
                    lazy: () =>
                      import("../../routes/orders/order-create-shipment"),
                  },
                ],
              },
            ],
          },
          {
            path: "/order-cycles",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Order Cycles",
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/order-cycles/order-cycle-list"),
              },
              {
                path: ":id",
                lazy: () => import("../../routes/order-cycles/order-cycle-detail"),
              },
            ],
          },
          {
            path: "/promotions",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => t("promotions.domain"),
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/promotions/promotion-list"),
              },
              {
                path: "create",
                lazy: () => import("../../routes/promotions/promotion-create"),
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/promotions/promotion-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminPromotionResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () =>
                      import("../../routes/promotions/promotion-edit-details"),
                  },
                  {
                    path: "add-to-campaign",
                    lazy: () =>
                      import("../../routes/promotions/promotion-add-campaign"),
                  },
                  {
                    path: ":ruleType/edit",
                    lazy: () =>
                      import("../../routes/promotions/common/edit-rules"),
                  },
                ],
              },
            ],
          },
          {
            path: "/campaigns",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => t("campaigns.domain"),
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/campaigns/campaign-list"),
                children: [],
              },
              {
                path: "create",
                lazy: () => import("../../routes/campaigns/campaign-create"),
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/campaigns/campaign-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminCampaignResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () => import("../../routes/campaigns/campaign-edit"),
                  },
                  {
                    path: "configuration",
                    lazy: () =>
                      import("../../routes/campaigns/campaign-configuration"),
                  },
                  {
                    path: "edit-budget",
                    lazy: () =>
                      import("../../routes/campaigns/campaign-budget-edit"),
                  },
                  {
                    path: "add-promotions",
                    lazy: () =>
                      import("../../routes/campaigns/add-campaign-promotions"),
                  },
                ],
              },
            ],
          },
          {
            path: "/collections",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => t("collections.domain"),
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/collections/collection-list"),
                children: [
                  {
                    path: "create",
                    lazy: () =>
                      import("../../routes/collections/collection-create"),
                  },
                ],
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/collections/collection-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminCollectionResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () =>
                      import("../../routes/collections/collection-edit"),
                  },
                  {
                    path: "products",
                    lazy: () =>
                      import(
                        "../../routes/collections/collection-add-products"
                      ),
                  },
                  {
                    path: "metadata/edit",
                    lazy: () =>
                      import("../../routes/collections/collection-metadata"),
                  },
                ],
              },
            ],
          },
          {
            path: "/price-lists",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => t("priceLists.domain"),
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/price-lists/price-list-list"),
                children: [
                  {
                    path: "create",
                    lazy: () =>
                      import("../../routes/price-lists/price-list-create"),
                  },
                ],
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/price-lists/price-list-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminPriceListResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () =>
                      import("../../routes/price-lists/price-list-edit"),
                  },
                  {
                    path: "configuration",
                    lazy: () =>
                      import(
                        "../../routes/price-lists/price-list-configuration"
                      ),
                  },
                  {
                    path: "products/add",
                    lazy: () =>
                      import("../../routes/price-lists/price-list-prices-add"),
                  },
                  {
                    path: "products/edit",
                    lazy: () =>
                      import("../../routes/price-lists/price-list-prices-edit"),
                  },
                ],
              },
            ],
          },
          {
            path: "/customers",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => t("customers.domain"),
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/customers/customer-list"),
                children: [
                  {
                    path: "create",
                    lazy: () =>
                      import("../../routes/customers/customer-create"),
                  },
                ],
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/customers/customer-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminCustomerResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () => import("../../routes/customers/customer-edit"),
                  },
                  {
                    path: "add-customer-groups",
                    lazy: () =>
                      import(
                        "../../routes/customers/customers-add-customer-group"
                      ),
                  },
                  {
                    path: "metadata/edit",
                    lazy: () =>
                      import("../../routes/customers/customer-metadata"),
                  },
                ],
              },
            ],
          },
          {
            path: "/customer-groups",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => t("customerGroups.domain"),
            },
            children: [
              {
                path: "",
                lazy: () =>
                  import("../../routes/customer-groups/customer-group-list"),
                children: [
                  {
                    path: "create",
                    lazy: () =>
                      import(
                        "../../routes/customer-groups/customer-group-create"
                      ),
                  },
                ],
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/customer-groups/customer-group-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminCustomerGroupResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () =>
                      import(
                        "../../routes/customer-groups/customer-group-edit"
                      ),
                  },
                  {
                    path: "add-customers",
                    lazy: () =>
                      import(
                        "../../routes/customer-groups/customer-group-add-customers"
                      ),
                  },
                  {
                    path: "metadata/edit",
                    lazy: () =>
                      import(
                        "../../routes/customer-groups/customer-group-metadata"
                      ),
                  },
                ],
              },
            ],
          },
          {
            path: "/reservations",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => t("reservations.domain"),
            },
            children: [
              {
                path: "",
                lazy: () =>
                  import("../../routes/reservations/reservation-list"),
                children: [
                  {
                    path: "create",
                    lazy: () =>
                      import("../../routes/reservations/reservation-create"),
                  },
                ],
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/reservations/reservation-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminReservationResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () =>
                      import(
                        "../../routes/reservations/reservation-detail/components/edit-reservation"
                      ),
                  },
                  {
                    path: "metadata/edit",
                    lazy: () =>
                      import("../../routes/reservations/reservation-metadata"),
                  },
                ],
              },
            ],
          },
          {
            path: "/inventory",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => t("inventory.domain"),
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/inventory/inventory-list"),
                children: [
                  {
                    path: "create",
                    lazy: () =>
                      import("../../routes/inventory/inventory-create"),
                  },
                  {
                    path: "stock",
                    lazy: () =>
                      import("../../routes/inventory/inventory-stock"),
                  },
                ],
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/inventory/inventory-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminInventoryItemResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () =>
                      import(
                        "../../routes/inventory/inventory-detail/components/edit-inventory-item"
                      ),
                  },
                  {
                    path: "attributes",
                    lazy: () =>
                      import(
                        "../../routes/inventory/inventory-detail/components/edit-inventory-item-attributes"
                      ),
                  },
                  {
                    path: "metadata/edit",
                    lazy: () =>
                      import("../../routes/inventory/inventory-metadata"),
                  },
                  {
                    path: "locations",
                    lazy: () =>
                      import(
                        "../../routes/inventory/inventory-detail/components/manage-locations"
                      ),
                  },
                  {
                    path: "locations/:location_id",
                    lazy: () =>
                      import(
                        "../../routes/inventory/inventory-detail/components/adjust-inventory"
                      ),
                  },
                ],
              },
            ],
          },
          {
            path: "/deliveries",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Deliveries",
            },
            children: [
              {
                path: "",
                lazy: async () => {
                  const { DeliveryList } = await import(
                    "../../routes/deliveries/delivery-list"
                  )
                  return { Component: DeliveryList }
                },
              },
              {
                path: ":id",
                handle: {
                  breadcrumb: () => "Delivery Details",
                },
                lazy: async () => {
                  const { DeliveryDetail } = await import(
                    "../../routes/deliveries/delivery-detail"
                  )
                  return { Component: DeliveryDetail }
                },
              },
            ],
          },
          {
            path: "/delivery-zones",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Delivery Zones",
            },
            children: [
              {
                path: "",
                lazy: async () => {
                  const { DeliveryZoneList } = await import(
                    "../../routes/delivery-zones/delivery-zone-list"
                  )
                  return { Component: DeliveryZoneList }
                },
              },
              {
                path: "create",
                handle: {
                  breadcrumb: () => "Create Zone",
                },
                lazy: async () => {
                  const { DeliveryZoneCreate } = await import(
                    "../../routes/delivery-zones/delivery-zone-create"
                  )
                  return { Component: DeliveryZoneCreate }
                },
              },
              {
                path: ":id/edit",
                handle: {
                  breadcrumb: () => "Edit Zone",
                },
                lazy: async () => {
                  const { DeliveryZoneEdit } = await import(
                    "../../routes/delivery-zones/delivery-zone-edit"
                  )
                  return { Component: DeliveryZoneEdit }
                },
              },
            ],
          },
          {
            path: "/menu",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Menu",
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/menu"),
              },
              {
                path: "items",
                handle: {
                  breadcrumb: () => "Menu Items",
                },
                lazy: () => import("../../routes/menu"),
              },
              {
                path: "categories",
                handle: {
                  breadcrumb: () => "Menu Categories",
                },
                lazy: () => import("../../routes/menu"),
              },
            ],
          },
          {
            path: "/plots",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Plots",
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/plots"),
              },
              {
                path: "available",
                handle: {
                  breadcrumb: () => "Available Plots",
                },
                lazy: () => import("../../routes/plots"),
              },
              {
                path: "assignments",
                handle: {
                  breadcrumb: () => "Plot Assignments",
                },
                lazy: () => import("../../routes/plots"),
              },
            ],
          },
          {
            path: "/volunteers",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Volunteers",
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/volunteers"),
              },
              {
                path: "list",
                handle: {
                  breadcrumb: () => "Volunteer List",
                },
                lazy: () => import("../../routes/volunteers"),
              },
              {
                path: "schedule",
                handle: {
                  breadcrumb: () => "Schedule",
                },
                lazy: () => import("../../routes/volunteers"),
              },
            ],
          },
          {
            path: "/donations",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Donations",
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/donations"),
              },
            ],
          },
          {
            path: "/venues",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Venues",
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/venues"),
              },
            ],
          },
          {
            path: "/shows",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Shows",
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/shows"),
              },
            ],
          },
          {
            path: "/collective-demand-pools",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Collective Buys",
            },
            children: [
              {
                path: "",
                lazy: () =>
                  import("../../routes/collective-demand-pools"),
              },
            ],
          },
          {
            path: "/farm",
            errorElement: <ErrorBoundary />,
            handle: {
              breadcrumb: () => "Farm",
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/farm"),
              },
              {
                path: "profile/create",
                lazy: () => import("../../routes/farm/profile"),
              },
              {
                path: "profile/edit",
                lazy: () => import("../../routes/farm/profile"),
              },
              {
                path: "harvests",
                handle: {
                  breadcrumb: () => "Harvests",
                },
                children: [
                  {
                    path: "",
                    lazy: () => import("../../routes/farm/harvests"),
                  },
                  {
                    path: "create",
                    lazy: () => import("../../routes/farm/harvests/create"),
                  },
                  {
                    path: ":id",
                    handle: {
                      breadcrumb: () => "Harvest Detail",
                    },
                    children: [
                      {
                        path: "",
                        lazy: () => import("../../routes/farm/harvests/[id]"),
                      },
                      {
                        path: "edit",
                        lazy: () => import("../../routes/farm/harvests/create"),
                      },
                      {
                        path: "lots/create",
                        lazy: () => import("../../routes/farm/harvests/[id]/lots/create"),
                      },
                    ],
                  },
                ],
              },
              {
                path: "lots/:id",
                handle: {
                  breadcrumb: () => "Lot Detail",
                },
                children: [
                  {
                    path: "",
                    lazy: () => import("../../routes/farm/lots/[id]"),
                  },
                  {
                    path: "edit",
                    lazy: () => import("../../routes/farm/lots/[id]"),
                  },
                  {
                    path: "availability/create",
                    lazy: () => import("../../routes/farm/lots/[id]/availability/create"),
                  },
                ],
              },
            ],
          },
          ...RouteExtensions,
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute />,
    errorElement: <ErrorBoundary />,
    children: [
      {
        path: "/settings",
        handle: {
          breadcrumb: () => t("app.nav.settings.header"),
        },
        element: <SettingsLayout />,
        children: [
          {
            index: true,
            errorElement: <ErrorBoundary />,
            lazy: () => import("../../routes/settings"),
          },
          {
            path: "profile",
            errorElement: <ErrorBoundary />,
            lazy: () => import("../../routes/profile/profile-detail"),
            handle: {
              breadcrumb: () => t("profile.domain"),
            },
            children: [
              {
                path: "edit",
                lazy: () => import("../../routes/profile/profile-edit"),
              },
            ],
          },
          {
            path: "regions",
            errorElement: <ErrorBoundary />,
            element: <Outlet />,
            handle: {
              breadcrumb: () => t("regions.domain"),
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/regions/region-list"),
                children: [
                  {
                    path: "create",
                    lazy: () => import("../../routes/regions/region-create"),
                  },
                ],
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/regions/region-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminRegionResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () => import("../../routes/regions/region-edit"),
                  },
                  {
                    path: "countries/add",
                    lazy: () =>
                      import("../../routes/regions/region-add-countries"),
                  },
                  {
                    path: "metadata/edit",
                    lazy: () => import("../../routes/regions/region-metadata"),
                  },
                ],
              },
            ],
          },
          {
            path: "extensions",
            errorElement: <ErrorBoundary />,
            lazy: () => import("../../routes/settings/extensions"),
            handle: {
              breadcrumb: () => "Extensions",
            },
          },
          {
            path: "store",
            errorElement: <ErrorBoundary />,
            lazy: () => import("../../routes/store/store-detail"),
            handle: {
              breadcrumb: () => t("store.domain"),
            },
            children: [
              {
                path: "edit",
                lazy: () => import("../../routes/store/store-edit"),
              },
              {
                path: "edit-company",
                lazy: () => import("../../routes/store/store-edit-company"),
              },
              {
                path: "currencies",
                lazy: () => import("../../routes/store/store-add-currencies"),
              },
              {
                path: "metadata/edit",
                lazy: () => import("../../routes/store/store-metadata"),
              },
              {
                path: "links",
                lazy: () => import("../../routes/store/store-links"),
              },
            ],
          },
          {
            path: "store-detail",
            element: <Navigate to="/settings/store" replace />,
          },
          {
            path: "users",
            errorElement: <ErrorBoundary />,
            element: <Outlet />,
            handle: {
              breadcrumb: () => t("users.domain"),
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/users/user-list"),
                children: [
                  {
                    path: "invite",
                    lazy: () => import("../../routes/users/user-invite"),
                  },
                ],
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/users/user-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminUserResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () => import("../../routes/users/user-edit"),
                  },
                  {
                    path: "metadata/edit",
                    lazy: () => import("../../routes/users/user-metadata"),
                  },
                ],
              },
            ],
          },
          {
            path: "sales-channels",
            errorElement: <ErrorBoundary />,
            element: <Outlet />,
            handle: {
              breadcrumb: () => t("salesChannels.domain"),
            },
            children: [
              {
                path: "",
                lazy: () =>
                  import("../../routes/sales-channels/sales-channel-list"),
                children: [
                  {
                    path: "create",
                    lazy: () =>
                      import(
                        "../../routes/sales-channels/sales-channel-create"
                      ),
                  },
                ],
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/sales-channels/sales-channel-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminSalesChannelResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () =>
                      import("../../routes/sales-channels/sales-channel-edit"),
                  },
                  {
                    path: "add-products",
                    lazy: () =>
                      import(
                        "../../routes/sales-channels/sales-channel-add-products"
                      ),
                  },
                  {
                    path: "metadata/edit",
                    lazy: () =>
                      import(
                        "../../routes/sales-channels/sales-channel-metadata"
                      ),
                  },
                ],
              },
            ],
          },
          {
            path: "locations",
            errorElement: <ErrorBoundary />,
            element: <Outlet />,
            handle: {
              breadcrumb: () => t("locations.domain"),
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/locations/location-list"),
              },
              {
                path: "create",
                lazy: () => import("../../routes/locations/location-create"),
              },
              {
                path: "shipping-profiles",
                element: <Outlet />,
                handle: {
                  breadcrumb: () => t("shippingProfile.domain"),
                },
                children: [
                  {
                    path: "",
                    lazy: () =>
                      import(
                        "../../routes/shipping-profiles/shipping-profiles-list"
                      ),
                    children: [
                      {
                        path: "create",
                        lazy: () =>
                          import(
                            "../../routes/shipping-profiles/shipping-profile-create"
                          ),
                      },
                    ],
                  },
                  {
                    path: ":shipping_profile_id",
                    lazy: async () => {
                      const { Component, Breadcrumb, loader } = await import(
                        "../../routes/shipping-profiles/shipping-profile-detail"
                      )

                      return {
                        Component,
                        loader,
                        handle: {
                          breadcrumb: (
                            // eslint-disable-next-line max-len
                            match: UIMatch<HttpTypes.AdminShippingProfileResponse>
                          ) => <Breadcrumb {...match} />,
                        },
                      }
                    },
                    children: [
                      {
                        path: "metadata/edit",
                        lazy: () =>
                          import(
                            "../../routes/shipping-profiles/shipping-profile-metadata"
                          ),
                      },
                    ],
                  },
                ],
              },
              {
                path: ":location_id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/locations/location-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminStockLocationResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () => import("../../routes/locations/location-edit"),
                  },
                  {
                    path: "sales-channels",
                    lazy: () =>
                      import("../../routes/locations/location-sales-channels"),
                  },
                  {
                    path: "fulfillment-providers",
                    lazy: () =>
                      import(
                        "../../routes/locations/location-fulfillment-providers"
                      ),
                  },
                  {
                    path: "fulfillment-set/:fset_id",
                    children: [
                      {
                        path: "service-zones/create",
                        lazy: () =>
                          import(
                            "../../routes/locations/location-service-zone-create"
                          ),
                      },
                      {
                        path: "service-zone/:zone_id",
                        children: [
                          {
                            path: "edit",
                            lazy: () =>
                              import(
                                "../../routes/locations/location-service-zone-edit"
                              ),
                          },
                          {
                            path: "areas",
                            lazy: () =>
                              import(
                                "../../routes/locations/location-service-zone-manage-areas"
                              ),
                          },
                          {
                            path: "shipping-option",
                            children: [
                              {
                                path: "create",
                                lazy: () =>
                                  import(
                                    "../../routes/locations/location-service-zone-shipping-option-create"
                                  ),
                              },
                              {
                                path: ":so_id",
                                children: [
                                  {
                                    path: "edit",
                                    lazy: () =>
                                      import(
                                        "../../routes/locations/location-service-zone-shipping-option-edit"
                                      ),
                                  },
                                  {
                                    path: "pricing",
                                    lazy: () =>
                                      import(
                                        "../../routes/locations/location-service-zone-shipping-option-pricing"
                                      ),
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            path: "product-tags",
            errorElement: <ErrorBoundary />,
            element: <Outlet />,
            handle: {
              breadcrumb: () => t("productTags.domain"),
            },
            children: [
              {
                path: "",
                lazy: () =>
                  import("../../routes/product-tags/product-tag-list"),
                children: [
                  {
                    path: "create",
                    lazy: () =>
                      import("../../routes/product-tags/product-tag-create"),
                  },
                ],
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/product-tags/product-tag-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminProductTagResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () =>
                      import("../../routes/product-tags/product-tag-edit"),
                  },
                ],
              },
            ],
          },
          {
            path: "workflows",
            errorElement: <ErrorBoundary />,
            element: <Outlet />,
            handle: {
              breadcrumb: () => t("workflowExecutions.domain"),
            },
            children: [
              {
                path: "",
                lazy: () =>
                  import(
                    "../../routes/workflow-executions/workflow-execution-list"
                  ),
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/workflow-executions/workflow-execution-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminWorkflowExecutionResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
              },
            ],
          },
          {
            path: "product-types",
            errorElement: <ErrorBoundary />,
            element: <Outlet />,
            handle: {
              breadcrumb: () => t("productTypes.domain"),
            },
            children: [
              {
                path: "",
                lazy: () =>
                  import("../../routes/product-types/product-type-list"),
                children: [
                  {
                    path: "create",
                    lazy: () =>
                      import("../../routes/product-types/product-type-create"),
                  },
                ],
              },
              {
                path: ":id",
                lazy: async () => {
                  const { Component, Breadcrumb, loader } = await import(
                    "../../routes/product-types/product-type-detail"
                  )

                  return {
                    Component,
                    loader,
                    handle: {
                      breadcrumb: (
                        match: UIMatch<HttpTypes.AdminProductTypeResponse>
                      ) => <Breadcrumb {...match} />,
                    },
                  }
                },
                children: [
                  {
                    path: "edit",
                    lazy: () =>
                      import("../../routes/product-types/product-type-edit"),
                  },
                ],
              },
            ],
          },
          {
            path: "tax-regions",
            element: <Outlet />,
            handle: {
              breadcrumb: () => t("taxRegions.domain"),
            },
            children: [
              {
                path: "",
                lazy: () => import("../../routes/tax-regions/tax-region-list"),
                children: [
                  {
                    path: "create",
                    lazy: () =>
                      import("../../routes/tax-regions/tax-region-create"),
                  },
                ],
              },
              {
                path: ":id",
                Component: Outlet,
                loader: taxRegionLoader,
                handle: {
                  breadcrumb: (
                    match: UIMatch<HttpTypes.AdminTaxRegionResponse>
                  ) => <TaxRegionDetailBreadcrumb {...match} />,
                },
                children: [
                  {
                    path: "",
                    lazy: async () => {
                      const { Component } = await import(
                        "../../routes/tax-regions/tax-region-detail"
                      )

                      return {
                        Component,
                      }
                    },
                    children: [
                      {
                        path: "provinces/create",
                        lazy: () =>
                          import(
                            "../../routes/tax-regions/tax-region-province-create"
                          ),
                      },
                      {
                        path: "overrides/create",
                        lazy: () =>
                          import(
                            "../../routes/tax-regions/tax-region-tax-override-create"
                          ),
                      },
                      {
                        path: "overrides/:tax_rate_id/edit",
                        lazy: () =>
                          import(
                            "../../routes/tax-regions/tax-region-tax-override-edit"
                          ),
                      },
                      {
                        path: "tax-rates/create",
                        lazy: () =>
                          import(
                            "../../routes/tax-regions/tax-region-tax-rate-create"
                          ),
                      },
                      {
                        path: "tax-rates/:tax_rate_id/edit",
                        lazy: () =>
                          import(
                            "../../routes/tax-regions/tax-region-tax-rate-edit"
                          ),
                      },
                    ],
                  },
                  {
                    path: "provinces/:province_id",
                    lazy: async () => {
                      const { Component, Breadcrumb, loader } = await import(
                        "../../routes/tax-regions/tax-region-province-detail"
                      )

                      return {
                        Component,
                        loader,
                        handle: {
                          breadcrumb: (
                            match: UIMatch<HttpTypes.AdminTaxRegionResponse>
                          ) => <Breadcrumb {...match} />,
                        },
                      }
                    },
                    children: [
                      {
                        path: "tax-rates/create",
                        lazy: () =>
                          import(
                            "../../routes/tax-regions/tax-region-tax-rate-create"
                          ),
                      },
                      {
                        path: "tax-rates/:tax_rate_id/edit",
                        lazy: () =>
                          import(
                            "../../routes/tax-regions/tax-region-tax-rate-edit"
                          ),
                      },
                      {
                        path: "overrides/create",
                        lazy: () =>
                          import(
                            "../../routes/tax-regions/tax-region-tax-override-create"
                          ),
                      },
                      {
                        path: "overrides/:tax_rate_id/edit",
                        lazy: () =>
                          import(
                            "../../routes/tax-regions/tax-region-tax-override-edit"
                          ),
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            path: "return-reasons",
            element: <Outlet />,
            handle: {
              breadcrumb: () => t("returnReasons.domain"),
            },
            children: [
              {
                path: "",
                lazy: () =>
                  import("../../routes/return-reasons/return-reason-list"),
                children: [
                  {
                    path: "create",
                    lazy: () =>
                      import(
                        "../../routes/return-reasons/return-reason-create"
                      ),
                  },

                  {
                    path: ":id",
                    children: [
                      {
                        path: "edit",
                        lazy: () =>
                          import(
                            "../../routes/return-reasons/return-reason-edit"
                          ),
                      },
                    ],
                  },
                ],
              },
            ],
          },
          ...SettingsExtensions,
        ],
      },
    ],
  },
  {
    element: <PublicLayout />,
    children: [
      {
        errorElement: <ErrorBoundary />,
        children: [
          {
            path: "/login",
            lazy: () => import("../../routes/login"),
          },
          {
            path: "/register",
            lazy:
              __DISABLE_SELLERS_REGISTRATION__ === "false"
                ? () => import("../../routes/register")
                : undefined,
          },
          {
            path: "/signup",
            lazy: () => import("../../routes/signup"),
          },
          {
            path: "/reset-password",
            lazy: () => import("../../routes/reset-password"),
          },
          {
            path: "/pending-approval",
            lazy: () => import("../../routes/pending-approval"),
          },
          {
            path: "/invite",
            lazy: () => import("../../routes/invite"),
          },
          {
            path: "*",
            lazy: () => import("../../routes/no-match"),
          },
        ],
      },
    ],
  },
]

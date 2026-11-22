import {
  Button,
  ProgressStatus,
  ProgressTabs,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { HttpTypes } from "@medusajs/types"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import {
  RouteFocusModal,
  useRouteModal,
} from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import {
  useDashboardExtension,
  useExtendableForm,
} from "../../../../../extensions"
import {
  sellingSetupMutationKeys,
  useCreateProductWithStock,
  useDeliverySetup,
  useIsBusy,
} from "../../../../../hooks/api/selling-setup"
import { backendMessage } from "../../../../../lib/backend-message"
import { uploadFilesQuery } from "../../../../../lib/client"
import {
  SimilarProductExists,
  similarProductPrompt,
} from "../../../../../lib/selling-setup"
import {
  PRODUCT_CREATE_FORM_DEFAULTS,
  ProductCreateSchema,
} from "../../constants"
import { ProductCreateDetailsForm } from "../product-create-details-form"
import { ProductCreateInventoryKitForm } from "../product-create-inventory-kit-form"
import { ProductCreateOrganizeForm } from "../product-create-organize-form"
import { ProductCreateVariantsForm } from "../product-create-variants-form"
import { usePricePreferences } from "../../../../../hooks/api/price-preferences"
import { useRegions } from "../../../../../hooks/api"
import {
  initialStockFrom,
  toCreateProductPayload,
  variantsMissingStock,
} from "../../utils"

enum Tab {
  DETAILS = "details",
  ORGANIZE = "organize",
  VARIANTS = "variants",
  INVENTORY = "inventory",
}

const IMPORT_SOURCE_LINKS = [
  { label: "Website", source: "website" },
  { label: "Etsy", source: "etsy" },
  { label: "TikTok", source: "tiktok" },
  { label: "Shopify", source: "shopify" },
  { label: "CSV", source: "csv" },
] as const

type TabState = Record<Tab, ProgressStatus>

const SAVE_DRAFT_BUTTON = "save-draft-button"

type ProductCreateFormProps = {
  defaultChannel?: HttpTypes.AdminSalesChannel
  store?: HttpTypes.AdminStore
  pricePreferences?: HttpTypes.AdminPricePreference[]
}

export const ProductCreateForm = ({
  defaultChannel,
  store,
}: ProductCreateFormProps) => {
  const [tab, setTab] = useState<Tab>(Tab.DETAILS)
  const [tabState, setTabState] = useState<TabState>({
    [Tab.DETAILS]: "in-progress",
    [Tab.ORGANIZE]: "not-started",
    [Tab.VARIANTS]: "not-started",
    [Tab.INVENTORY]: "not-started",
  })

  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const { getFormConfigs } = useDashboardExtension()
  const configs = getFormConfigs("product", "create")

  const { regions } = useRegions({ limit: 9999 })
  const { price_preferences: pricePreferences } = usePricePreferences({
    limit: 9999,
  })
  const regionsCurrencyMap = useMemo(() => {
    if (!regions?.length) {
      return {}
    }

    return regions.reduce(
      (acc, region) => {
        acc[region.id] = region.currency_code
        return acc
      },
      {} as Record<string, string>
    )
  }, [regions])

  const form = useExtendableForm({
    defaultValues: {
      ...PRODUCT_CREATE_FORM_DEFAULTS,
      sales_channels: defaultChannel
        ? [
            {
              id: defaultChannel.id,
              name: defaultChannel.name,
            },
          ]
        : [],
    },
    schema: ProductCreateSchema,
    configs,
  })

  // Creates the product, then records the stock the vendor entered: one
  // mutation, so `isPending` covers both requests.
  const { mutateAsync } = useCreateProductWithStock()
  const prompt = usePrompt()
  const { pending, isBusyNow } = useIsBusy(sellingSetupMutationKeys.listing)
  const submitting = useRef(false)
  const isPending = pending || form.formState.isSubmitting

  // Where stock is held: a location linked to the sales channel when there
  // is one. With none, a quantity has nowhere to be recorded.
  const {
    data: delivery,
    isPending: isDeliveryPending,
    isError: isDeliveryUnread,
  } = useDeliverySetup()
  const stockLocation = delivery?.location ?? null

  const [showInventoryTab, setShowInventoryTab] = useState(() =>
    form
      .getValues("variants")
      .some((v) => v.manage_inventory && v.inventory_kit)
  )

  useEffect(() => {
    const subscription = form.watch((values, { name }) => {
      if (!name?.startsWith("variants")) {
        return
      }

      const shouldShow = (values.variants || []).some(
        (variant) => variant.manage_inventory && variant.inventory_kit
      )

      setShowInventoryTab((prev) => (prev !== shouldShow ? shouldShow : prev))
    })

    return () => subscription.unsubscribe()
  }, [form])

  const handleSubmit = form.handleSubmit(async (values, e) => {
    // One product per press: the upload, the create and the stock write are
    // one submission, and the buttons are not disabled until it re-renders.
    if (submitting.current || isBusyNow()) {
      return
    }

    let isDraftSubmission = false

    if (e?.nativeEvent instanceof SubmitEvent) {
      const submitter = e?.nativeEvent?.submitter as HTMLButtonElement
      isDraftSubmission = submitter.dataset.name === SAVE_DRAFT_BUTTON
    }

    // A published product that tracks stock and has none cannot be added to a
    // cart, so the vendor says how many there are or unticks "Track stock".
    // A draft can wait.
    const unanswered = isDraftSubmission
      ? []
      : variantsMissingStock(values.variants, Boolean(stockLocation))
    if (unanswered.length) {
      for (const index of unanswered) {
        form.setError(`variants.${index}.stock_quantity`, {
          type: "manual",
          message: "Enter how many you have, or untick Track stock.",
        })
      }
      setTab(Tab.VARIANTS)
      toast.error(
        "Say how many of each you have in stock, or untick Track stock."
      )
      return
    }

    submitting.current = true
    try {
      const media = values.media || []

      let uploadedMedia: (HttpTypes.AdminFile & {
        isThumbnail: boolean
      })[] = []
      try {
        if (media.length) {
          const thumbnailReq = media.filter((m) => m.isThumbnail)
          const otherMediaReq = media.filter((m) => !m.isThumbnail)

          const fileReqs = []
          if (thumbnailReq?.length) {
            fileReqs.push(
              uploadFilesQuery(thumbnailReq).then((r: any) =>
                r.files.map((f: any) => ({
                  ...f,
                  isThumbnail: true,
                }))
              )
            )
          }
          if (otherMediaReq?.length) {
            fileReqs.push(
              uploadFilesQuery(otherMediaReq).then((r: any) =>
                r.files.map((f: any) => ({
                  ...f,
                  isThumbnail: false,
                }))
              )
            )
          }

          uploadedMedia = (await Promise.all(fileReqs)).flat()
        }
      } catch (error) {
        if (error instanceof Error) {
          toast.error(error.message)
        }
      }

      const entries = initialStockFrom(values.variants)
      const tracksStock = values.variants.some(
        (variant) => variant.should_create && variant.manage_inventory !== false
      )

      const createWith = (separate: boolean) =>
        mutateAsync({
          payload: toCreateProductPayload(values, {
            status: isDraftSubmission ? "draft" : "published",
            uploadedMedia,
            regionsCurrencyMap,
          }),
          stock:
            stockLocation && entries.length
              ? { locationId: stockLocation.id, entries }
              : undefined,
          separate,
        })

      let data: Awaited<ReturnType<typeof createWith>>
      try {
        data = await createWith(false)
      } catch (error) {
        // The store already has a product under this handle that is not what
        // was entered (another tab, an earlier press): the vendor chooses.
        if (!(error instanceof SimilarProductExists)) throw error
        if (!(await prompt(similarProductPrompt(error)))) {
          handleSuccess(`../${error.product.id}`)
          return
        }
        data = await createWith(true)
      }

      toast.success(
        t("products.create.successToast", {
          title: data.product.title,
        })
      )
      // The product exists. Say so, and say what a buyer still cannot do.
      if (data.stockError) {
        toast.error("Its stock was not recorded", {
          description: `${backendMessage(
            data.stockError,
            "Unknown error"
          )} Set it on the product's Stock page.`,
        })
      } else if (tracksStock && !stockLocation) {
        toast.warning("No stock is recorded for it", {
          description:
            "You have no stock location yet, so buyers cannot add it to a cart. Set up pickup or shipping, then enter its stock.",
        })
      }

      handleSuccess(`../${data.product.id}`)
    } catch (error) {
      // The backend's own words: a listing type the seller's playbook does
      // not allow is refused with the types it does.
      toast.error(backendMessage(error, "The product could not be created."))
    } finally {
      submitting.current = false
    }
  })

  const onNext = async (currentTab: Tab) => {
    const valid = await form.trigger()

    if (!valid) {
      return
    }

    if (currentTab === Tab.DETAILS) {
      setTab(Tab.ORGANIZE)
    }

    if (currentTab === Tab.ORGANIZE) {
      setTab(Tab.VARIANTS)
    }

    if (currentTab === Tab.VARIANTS) {
      setTab(Tab.INVENTORY)
    }
  }

  useEffect(() => {
    const currentState = { ...tabState }
    if (tab === Tab.DETAILS) {
      currentState[Tab.DETAILS] = "in-progress"
    }
    if (tab === Tab.ORGANIZE) {
      currentState[Tab.DETAILS] = "completed"
      currentState[Tab.ORGANIZE] = "in-progress"
    }
    if (tab === Tab.VARIANTS) {
      currentState[Tab.DETAILS] = "completed"
      currentState[Tab.ORGANIZE] = "completed"
      currentState[Tab.VARIANTS] = "in-progress"
    }
    if (tab === Tab.INVENTORY) {
      currentState[Tab.DETAILS] = "completed"
      currentState[Tab.ORGANIZE] = "completed"
      currentState[Tab.VARIANTS] = "completed"
      currentState[Tab.INVENTORY] = "in-progress"
    }

    setTabState({ ...currentState })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- we only want this effect to run when the tab changes
  }, [tab])

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onKeyDown={(e) => {
          // We want to continue to the next tab on enter instead of saving as draft immediately
          if (e.key === "Enter") {
            if (
              e.target instanceof HTMLTextAreaElement &&
              !(e.metaKey || e.ctrlKey)
            ) {
              return
            }

            e.preventDefault()

            if (e.metaKey || e.ctrlKey) {
              if (tab !== Tab.VARIANTS) {
                e.preventDefault()
                e.stopPropagation()
                onNext(tab)

                return
              }

              handleSubmit()
            }
          }
        }}
        onSubmit={handleSubmit}
        className="flex h-full flex-col"
      >
        <ProgressTabs
          value={tab}
          onValueChange={async (tab) => {
            const valid = await form.trigger()

            if (!valid) {
              return
            }

            setTab(tab as Tab)
          }}
          className="flex h-full flex-col overflow-hidden"
        >
          <RouteFocusModal.Header>
            <div className="-my-2 w-full border-l">
              <ProgressTabs.List className="justify-start-start flex w-full items-center">
                <ProgressTabs.Trigger
                  type="button"
                  status={tabState[Tab.DETAILS]}
                  value={Tab.DETAILS}
                  className="max-w-[200px] truncate"
                >
                  {t("products.create.tabs.details")}
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger
                  type="button"
                  status={tabState[Tab.ORGANIZE]}
                  value={Tab.ORGANIZE}
                  className="max-w-[200px] truncate"
                >
                  {t("products.create.tabs.organize")}
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger
                  type="button"
                  status={tabState[Tab.VARIANTS]}
                  value={Tab.VARIANTS}
                  className="max-w-[200px] truncate"
                >
                  {t("products.create.tabs.variants")}
                </ProgressTabs.Trigger>
                {showInventoryTab && (
                  <ProgressTabs.Trigger
                    type="button"
                    status={tabState[Tab.INVENTORY]}
                    value={Tab.INVENTORY}
                    className="max-w-[200px] truncate"
                  >
                    {t("products.create.tabs.inventory")}
                  </ProgressTabs.Trigger>
                )}
              </ProgressTabs.List>
            </div>
          </RouteFocusModal.Header>
          <RouteFocusModal.Body className="size-full overflow-hidden">
            <ProgressTabs.Content
              className="size-full overflow-y-auto"
              value={Tab.DETAILS}
            >
              <ProductCreateDetailsForm form={form} />
            </ProgressTabs.Content>
            <ProgressTabs.Content
              className="size-full overflow-y-auto"
              value={Tab.ORGANIZE}
            >
              <ProductCreateOrganizeForm form={form} />
            </ProgressTabs.Content>
            <ProgressTabs.Content
              className="size-full overflow-y-auto"
              value={Tab.VARIANTS}
            >
              <ProductCreateVariantsForm
                form={form}
                store={store}
                regions={regions}
                pricePreferences={pricePreferences}
                stockLocation={stockLocation}
                stockLocationLinked={Boolean(delivery?.locationLinked)}
                stockLocationPending={isDeliveryPending}
                stockLocationUnread={isDeliveryUnread}
              />
            </ProgressTabs.Content>
            {showInventoryTab && (
              <ProgressTabs.Content
                className="size-full overflow-y-auto"
                value={Tab.INVENTORY}
              >
                <ProductCreateInventoryKitForm form={form} />
              </ProgressTabs.Content>
            )}
          </RouteFocusModal.Body>
        </ProgressTabs>
        <RouteFocusModal.Footer>
          <div className="flex w-full flex-col gap-y-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="txt-compact-small text-ui-fg-subtle">
                Import from:
              </span>
              {IMPORT_SOURCE_LINKS.map((option) => (
                <Button
                  key={option.source}
                  size="small"
                  variant="secondary"
                  type="button"
                  asChild
                >
                  <Link to={`../import?source=${option.source}`}>
                    {option.label}
                  </Link>
                </Button>
              ))}
            </div>

            <div className="flex items-center justify-end gap-x-2">
              <RouteFocusModal.Close asChild>
                <Button variant="secondary" size="small" type="button">
                  {t("actions.cancel")}
                </Button>
              </RouteFocusModal.Close>
              <Button
                data-name={SAVE_DRAFT_BUTTON}
                size="small"
                type="submit"
                isLoading={isPending}
                className="whitespace-nowrap"
              >
                Draft
              </Button>
              <PrimaryButton
                tab={tab}
                next={onNext}
                isLoading={isPending}
                showInventoryTab={showInventoryTab}
              />
            </div>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}

type PrimaryButtonProps = {
  tab: Tab
  next: (tab: Tab) => void
  isLoading?: boolean
  showInventoryTab: boolean
}

const PrimaryButton = ({
  tab,
  next,
  isLoading,
  showInventoryTab,
}: PrimaryButtonProps) => {
  const { t } = useTranslation()

  if (
    (tab === Tab.VARIANTS && !showInventoryTab) ||
    (tab === Tab.INVENTORY && showInventoryTab)
  ) {
    return (
      <Button
        data-name="publish-button"
        key="submit-button"
        type="submit"
        variant="primary"
        size="small"
        isLoading={isLoading}
      >
        Create Product
      </Button>
    )
  }

  return (
    <Button
      key="next-button"
      type="button"
      variant="primary"
      size="small"
      onClick={() => next(tab)}
    >
      {t("actions.continue")}
    </Button>
  )
}

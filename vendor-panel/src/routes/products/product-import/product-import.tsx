import { Trash } from "@medusajs/icons"
import {
  Badge,
  Button,
  Checkbox,
  Heading,
  Input,
  Label,
  Select,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { FilePreview } from "../../../components/common/file-preview"
import { RouteDrawer, useRouteModal } from "../../../components/modals"
import {
  useConfirmImportProducts,
  useImportProducts,
  useResolveOnlineStoreReferences,
} from "../../../hooks/api"
import {
  useWooConnection,
  useConnectWooCommerce,
  useDisconnectWooCommerce,
  useWooPreview,
  useWooImport,
  useWooImportHistory,
  useOdooConnection,
  useConnectOdoo,
  useDisconnectOdoo,
  useOdooPreview,
  useOdooImport,
  useOdooImportHistory,
  usePrintfulCatalogPreview,
  usePrintfulImport,
} from "../../../hooks/api"
import { useStore } from "../../../hooks/api/store"
import { getProductImportCsvTemplate } from "./helpers/import-template"
import { ImportSummary } from "./components/import-summary"
import { UploadImport } from "./components/upload-import"

type ProductImportSource =
  | "woocommerce"
  | "odoo"
  | "online_store"
  | "csv"
  | "printful"

type ExternalImportCandidate = {
  id: string
  source: "online_store"
  reference: string
  title: string
  handle?: string
  description?: string
  image?: string
  priceAmount?: string
}

const ONLINE_STORE_IMPORT_BASE_HEADERS = [
  "Product Id",
  "Product Handle",
  "Product Title",
  "Product Subtitle",
  "Product Description",
  "Product Status",
  "Product Thumbnail",
  "Product Weight",
  "Product Length",
  "Product Width",
  "Product Height",
  "Product HS Code",
  "Product Origin Country",
  "Product MID Code",
  "Product Material",
  "Product Collection Title",
  "Product Collection Handle",
  "Product Type",
  "Product Tags",
  "Product Discountable",
  "Product External Id",
  "Product Profile Name",
  "Product Profile Type",
  "Variant Id",
  "Variant Title",
  "Variant SKU",
  "Variant Barcode",
  "Variant Inventory Quantity",
  "Variant Allow Backorder",
  "Variant Manage Inventory",
  "Variant Weight",
  "Variant Length",
  "Variant Width",
  "Variant Height",
  "Variant HS Code",
  "Variant Origin Country",
  "Variant MID Code",
  "Variant Material",
  "Option 1 Name",
  "Option 1 Value",
  "Image 1 Url",
  "Image 2 Url",
]

const ONLINE_STORE_FALLBACK_CURRENCIES = ["usd"]
const ONLINE_STORE_DEFAULT_PRICE_AMOUNT = 100
const ONLINE_STORE_DEFAULT_OPTION_NAME = "Title"
const ONLINE_STORE_DEFAULT_OPTION_VALUE = "Default Title"
const ONLINE_STORE_DEFAULT_VARIANT_TITLE = "Default Title"
const ONLINE_STORE_WRAPPING_QUOTES = /^[\s"'`“”‘’]+|[\s"'`“”‘’]+$/g

const SOURCE_OPTIONS: { label: string; value: ProductImportSource }[] = [
  { label: "WooCommerce", value: "woocommerce" },
  { label: "Odoo", value: "odoo" },
  { label: "Online store", value: "online_store" },
  { label: "CSV upload", value: "csv" },
  { label: "Printful catalog", value: "printful" },
]

const SOURCE_HELPERS: Record<ProductImportSource, string> = {
  woocommerce:
    "Connect your WooCommerce store with API credentials to import all products automatically.",
  odoo:
    "Connect your Odoo instance with an API key to import your product catalog.",
  online_store:
    "Paste product, collection, or shop links from any online store to build your import list.",
  csv: "Upload a CSV file and import many products at once.",
  printful:
    "Browse your configured Printful catalog and import POD products into your vendor catalog.",
}

export const ProductImport = () => {
  const { t } = useTranslation()

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>{t("products.import.header")}</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          {t("products.import.description")}
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <ProductImportContent />
    </RouteDrawer>
  )
}

const ProductImportContent = () => {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const defaultSource = searchParams.get("source") as ProductImportSource | null
  const [filename, setFilename] = useState<string>()
  const [sourceType, setSourceType] = useState<ProductImportSource>(
    defaultSource &&
      SOURCE_OPTIONS.some((option) => option.value === defaultSource)
      ? defaultSource
      : "woocommerce"
  )
  const [sourceReference, setSourceReference] = useState("")
  const [externalCandidates, setExternalCandidates] = useState<
    ExternalImportCandidate[]
  >([])
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([])
  const [queuedCandidateIds, setQueuedCandidateIds] = useState<string[]>([])
  const { store } = useStore()

  const { mutateAsync: importProducts, isPending, data } = useImportProducts()
  const {
    mutateAsync: resolveOnlineStoreReferences,
    isPending: isResolvingReferences,
  } = useResolveOnlineStoreReferences()
  const { mutateAsync: confirmImportProducts, isPending: isConfirmingImport } =
    useConfirmImportProducts()
  const { handleSuccess } = useRouteModal()

  const productImportTemplateContent = useMemo(
    () => getProductImportCsvTemplate(),
    []
  )

  const handleUploaded = async (file: File) => {
    setFilename(file.name)

    await importProducts(
      { file },
      {
        onSuccess: () => {
          toast.info(t("products.import.success.title"))
          handleSuccess()
        },
        onError: (err) => {
          toast.error(err.message)
          setFilename(undefined)
        },
      }
    )
  }

  const handleAddExternalCandidate = async () => {
    const trimmedReference = sourceReference
      .trim()
      .replace(ONLINE_STORE_WRAPPING_QUOTES, "")

    if (!trimmedReference || sourceType !== "online_store") {
      toast.error("Add a source URL or account reference first.")
      return
    }

    try {
      const response = await resolveOnlineStoreReferences({
        references: [trimmedReference],
      })

      const [resolved] = response?.products || []

      if (!resolved?.ok) {
        throw new Error(
          resolved?.message ||
            "Could not read product data from link. Paste a full product URL and try again."
        )
      }

      const nextCandidate: ExternalImportCandidate = {
        id: `${sourceType}-${Date.now()}`,
        source: "online_store",
        reference:
          resolved.resolved_reference || resolved.reference || trimmedReference,
        title:
          (resolved.title || "").trim() ||
          `Product from ${resolved.resolved_reference || trimmedReference}`,
        handle: resolved.handle,
        description: resolved.description,
        image: resolved.image,
        priceAmount: resolved.price_amount,
      }

      setExternalCandidates((prev) => [...prev, nextCandidate])
      setSelectedCandidates((prev) => [...prev, nextCandidate.id])
      setSourceReference("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to resolve source link.")
    }
  }

  const handleToggleCandidate = (id: string, checked: boolean) => {
    setSelectedCandidates((prev) =>
      checked
        ? [...new Set([...prev, id])]
        : prev.filter((candidateId) => candidateId !== id)
    )
  }

  const toggleAllCandidates = (checked: boolean) => {
    if (checked) {
      setSelectedCandidates(externalCandidates.map((candidate) => candidate.id))
      return
    }

    setSelectedCandidates([])
  }

  const handleQueueSelected = () => {
    if (!selectedCandidates.length) {
      toast.error(
        "Select at least one product to continue. Add a product link first if your list is empty."
      )
      return
    }

    setQueuedCandidateIds(selectedCandidates)

    toast.info(
      `${selectedCandidates.length} products queued for review & publish.`
    )
  }

  const onlineStorePriceCurrencies = useMemo(() => {
    const codes =
      store?.supported_currencies
        ?.map((currency) => currency.currency_code?.toUpperCase())
        .filter((code): code is string => !!code) ?? []

    return codes.length
      ? [...new Set(codes)]
      : ONLINE_STORE_FALLBACK_CURRENCIES.map((code) => code.toUpperCase())
  }, [store?.supported_currencies])

  const csvEscape = (value: string) => {
    const normalized = value.replace(/\r?\n/g, " ").trim()
    return normalized.includes(";") || normalized.includes('"')
      ? `"${normalized.replace(/"/g, '""')}"`
      : normalized
  }

  const buildOnlineStoreImportFile = (candidates: ExternalImportCandidate[]) => {
    const headers = [
      ...ONLINE_STORE_IMPORT_BASE_HEADERS.slice(0, 38),
      ...onlineStorePriceCurrencies.map((currencyCode) => `Price ${currencyCode}`),
      ...ONLINE_STORE_IMPORT_BASE_HEADERS.slice(38),
    ]

    const rows = candidates.map((candidate) => {
      const reference = candidate.reference
      const parsedUrl = (() => {
        try {
          return new URL(reference)
        } catch {
          return null
        }
      })()

      const hostName = parsedUrl?.hostname?.replace(/^www\./, "") || "online-store"
      const slugPart =
        parsedUrl?.pathname
          ?.split("/")
          .filter(Boolean)
          .pop() ||
        candidate.id
      const normalizedSlug = slugPart
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
      const handle =
        candidate.handle || `${hostName}-${normalizedSlug || "product"}`.slice(0, 120)

      const titleFromSlug = normalizedSlug
        .split("-")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")

      const productTitle = candidate.title || titleFromSlug

      const parsedPrice = Number(candidate.priceAmount)
      const normalizedPrice =
        Number.isFinite(parsedPrice) && parsedPrice > 0
          ? String(Math.round(parsedPrice * 100))
          : String(ONLINE_STORE_DEFAULT_PRICE_AMOUNT)

      const row = [
        "",
        handle,
        productTitle,
        "",
        candidate.description?.trim() || `Imported from ${reference}`,
        "draft",
        candidate.image || "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "true",
        "",
        "",
        "",
        "",
        ONLINE_STORE_DEFAULT_VARIANT_TITLE,
        "",
        "",
        "0",
        "false",
        "true",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ...onlineStorePriceCurrencies.map(() => normalizedPrice),
        ONLINE_STORE_DEFAULT_OPTION_NAME,
        ONLINE_STORE_DEFAULT_OPTION_VALUE,
        "",
        "",
      ]

      return row.map((value) => csvEscape(value)).join(";")
    })

    const content = [headers.join(";"), ...rows].join("\n")

    return new File([content], `online-store-import-${Date.now()}.csv`, {
      type: "text/csv;charset=utf-8",
    })
  }

  const handleReviewAndPublish = async () => {
    if (sourceType === "online_store" && !queuedCandidateIds.length) {
      toast.error("Import selected products before review & publish.")
      return
    }

    const queuedCandidates = externalCandidates.filter((candidate) =>
      queuedCandidateIds.includes(candidate.id)
    )

    if (!queuedCandidates.length) {
      toast.error("No products found in the review queue.")
      return
    }

    const importFile = buildOnlineStoreImportFile(queuedCandidates)

    try {
      const importResponse = await importProducts({ file: importFile })

      if (!importResponse?.transaction_id) {
        throw new Error("Import review could not be created.")
      }

      await confirmImportProducts(importResponse.transaction_id)
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to import online store products."
      )
      return
    }

    const queuedCount = queuedCandidateIds.length

    toast.success(
      queuedCount
        ? `${queuedCount} products sent to review & publish.`
        : "Products sent to review & publish."
    )
    handleSuccess()
  }

  const uploadedFileActions = [
    {
      actions: [
        {
          label: t("actions.delete"),
          icon: <Trash />,
          onClick: () => setFilename(undefined),
        },
      ],
    },
  ]

  const allCandidatesSelected =
    externalCandidates.length > 0 &&
    selectedCandidates.length === externalCandidates.length

  return (
    <>
      <RouteDrawer.Body>
        <div className="rounded-lg border border-ui-border-base p-4">
          <Heading level="h2">Import once from your existing store</Heading>
          <Text size="small" className="mt-2 text-ui-fg-subtle">
            External stores are data sources only. Checkout, orders, payments,
            and customer relationship stay in FreeBlackMarket.
          </Text>
        </div>

        <div className="mt-6">
          <Heading level="h2">1) Choose source</Heading>
          <div className="mt-4">
            <Select
              value={sourceType}
              onValueChange={(value) =>
                setSourceType(value as ProductImportSource)
              }
            >
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {SOURCE_OPTIONS.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <Text size="small" className="mt-2 text-ui-fg-subtle">
            {SOURCE_HELPERS[sourceType]}
          </Text>
        </div>

        {sourceType === "woocommerce" && <WooCommerceImportSection />}

        {sourceType === "odoo" && <OdooImportSection />}

        {sourceType === "printful" && <PrintfulImportSection />}

        {sourceType === "csv" && (
          <>
            <Heading className="mt-6" level="h2">
              2) Upload and import
            </Heading>
            <Text size="small" className="text-ui-fg-subtle">
              CSV import is multi-product by default. Upload one file to create
              or update many products.
            </Text>

            <div className="mt-4">
              {filename ? (
                <FilePreview
                  filename={filename}
                  loading={isPending}
                  activity={t("products.import.upload.preprocessing")}
                  actions={uploadedFileActions}
                />
              ) : (
                <UploadImport onUploaded={handleUploaded} />
              )}
            </div>

            {data?.summary && !!filename && (
              <div className="mt-4">
                <ImportSummary summary={data.summary} />
              </div>
            )}
          </>
        )}

        {sourceType === "online_store" && (
          <>
            <Heading className="mt-6" level="h2">
              2) Add source references
            </Heading>

            <div className="mt-3 flex gap-2">
              <Input
                value={sourceReference}
                onChange={(e) => setSourceReference(e.target.value)}
                placeholder="https://shop.example/product or https://etsy.com/shop/..."
              />
              <Button
                type="button"
                variant="secondary"
                onClick={handleAddExternalCandidate}
                isLoading={isResolvingReferences}
              >
                Add
              </Button>
            </div>

            <div className="mt-4 rounded-lg border border-ui-border-base p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={allCandidatesSelected}
                    onCheckedChange={(checked) =>
                      toggleAllCandidates(!!checked)
                    }
                  />
                  <Text size="small" weight="plus">
                    Select all
                  </Text>
                </div>
                <Badge size="2xsmall" color="grey">
                  {selectedCandidates.length} selected
                </Badge>
              </div>

              <div className="space-y-2">
                {externalCandidates.length ? (
                  externalCandidates.map((candidate) => {
                    const checked = selectedCandidates.includes(candidate.id)

                    return (
                      <label
                        key={candidate.id}
                        className="flex cursor-pointer items-start gap-2 rounded-md border border-ui-border-base px-3 py-2"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) =>
                            handleToggleCandidate(candidate.id, !!value)
                          }
                        />
                        <div>
                          <Text size="small" weight="plus">
                            {candidate.title}
                          </Text>
                          <Text size="xsmall" className="text-ui-fg-subtle">
                            Online store ·{" "}
                            {candidate.reference}
                          </Text>
                          {candidate.description ? (
                            <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                              {candidate.description}
                            </Text>
                          ) : null}
                        </div>
                      </label>
                    )
                  })
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">
                    Add references to build a product selection list.
                  </Text>
                )}
              </div>

              <div className="mt-3">
                <Button
                  type="button"
                  size="small"
                  onClick={handleQueueSelected}
                >
                  Import selected products
                </Button>
              </div>
            </div>
          </>
        )}

        <div className="mt-6 rounded-lg border border-ui-border-base p-4">
          <Heading level="h3">
            {sourceType === "woocommerce" ? "3" : "3"}) Review & publish
          </Heading>
          <Text size="small" className="mt-2 text-ui-fg-subtle">
            Product names, descriptions, images, variants, pricing, and
            inventory are normalized before publish. FBM price and inventory are
            canonical.
          </Text>
        </div>

        {sourceType !== "woocommerce" && (
          <>
            <Heading className="mt-6" level="h2">
              {t("products.import.template.title")}
            </Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {t("products.import.template.description")}
            </Text>
            <div className="mt-4">
              <FilePreview
                filename="product-import-template.csv"
                url={productImportTemplateContent}
              />
            </div>
          </>
        )}
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex w-full items-center justify-end gap-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.cancel")}
            </Button>
          </RouteDrawer.Close>
          {sourceType === "online_store" && (
            <Button
              size="small"
              onClick={handleReviewAndPublish}
              isLoading={isPending || isConfirmingImport}
            >
              Review &amp; publish
            </Button>
          )}
        </div>
      </RouteDrawer.Footer>
    </>
  )
}

const PrintfulImportSection = () => {
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [importAsDraft, setImportAsDraft] = useState(false)

  const {
    products,
    isLoading,
    isError,
    error,
  } = usePrintfulCatalogPreview({ limit: 30 })

  const { mutateAsync: importPrintfulProducts, isPending: isImporting } = usePrintfulImport()

  const catalogProducts = Array.isArray(products) ? products : []

  const toggleProduct = (productId: string, checked: boolean) => {
    setSelectedProductIds((prev) =>
      checked ? [...new Set([...prev, productId])] : prev.filter((id) => id !== productId)
    )
  }

  const handleImport = async () => {
    if (!selectedProductIds.length) {
      toast.error("Select at least one Printful product to import.")
      return
    }

    await importPrintfulProducts(
      {
        product_ids: selectedProductIds,
        import_as_draft: importAsDraft,
      },
      {
        onSuccess: (response) => {
          toast.success(
            `Imported ${response?.result?.imported || 0} Printful products.`
          )
          setSelectedProductIds([])
        },
        onError: (err) => {
          toast.error(err.message || "Failed to import Printful products.")
        },
      }
    )
  }

  return (
    <>
      <Heading className="mt-6" level="h2">
        2) Choose Printful products
      </Heading>
      <Text size="small" className="mt-1 text-ui-fg-subtle">
        This uses the backend Printful integration. Configure PRINTFUL_API_KEY on
        the backend environment first.
      </Text>

      {isLoading ? (
        <Text size="small" className="mt-2 text-ui-fg-subtle">
          Loading Printful catalog...
        </Text>
      ) : isError ? (
        <Text size="small" className="mt-2 text-red-500">
          {(error as Error)?.message || "Unable to load Printful catalog."}
        </Text>
      ) : (
        <div className="mt-3 space-y-2 rounded-lg border border-ui-border-base p-3">
          {catalogProducts.length ? (
            catalogProducts.map((product: any) => {
              const id = String(product.id)
              const checked = selectedProductIds.includes(id)

              return (
                <label
                  key={id}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-ui-border-base px-3 py-2"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => toggleProduct(id, !!value)}
                  />
                  <div>
                    <Text size="small" weight="plus">
                      {product.name}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      #{product.id} {product.brand ? `· ${product.brand}` : ""}
                    </Text>
                  </div>
                </label>
              )
            })
          ) : (
            <Text size="small" className="text-ui-fg-subtle">
              No catalog products found in Printful.
            </Text>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between rounded-lg border border-ui-border-base p-4">
        <div>
          <Text size="small" weight="plus">
            Import as draft
          </Text>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Keep imported Printful products in draft mode for review.
          </Text>
        </div>
        <Switch checked={importAsDraft} onCheckedChange={setImportAsDraft} />
      </div>

      <div className="mt-4">
        <Button type="button" size="small" onClick={handleImport} isLoading={isImporting}>
          Import {selectedProductIds.length} Printful products
        </Button>
      </div>
    </>
  )
}

/**
 * WooCommerce-specific import section: connect, preview, import.
 */
const WooCommerceImportSection = () => {
  const { connection, isLoading: isLoadingConnection } = useWooConnection()
  const isConnected = !!connection

  return (
    <div className="mt-6">
      {isLoadingConnection ? (
        <div className="flex items-center justify-center py-8">
          <Text size="small" className="text-ui-fg-subtle">
            Checking WooCommerce connection...
          </Text>
        </div>
      ) : isConnected ? (
        <WooConnectedView connection={connection} />
      ) : (
        <WooConnectForm />
      )}
    </div>
  )
}

/**
 * Form to connect a WooCommerce store.
 */
const WooConnectForm = () => {
  const [storeUrl, setStoreUrl] = useState("")
  const [consumerKey, setConsumerKey] = useState("")
  const [consumerSecret, setConsumerSecret] = useState("")

  const { mutateAsync: connect, isPending } = useConnectWooCommerce()

  const handleConnect = async () => {
    if (!storeUrl || !consumerKey || !consumerSecret) {
      toast.error("All fields are required.")
      return
    }

    try {
      new URL(storeUrl)
    } catch {
      toast.error("Enter a valid store URL (e.g. https://mystore.com).")
      return
    }

    await connect(
      {
        store_url: storeUrl.replace(/\/+$/, ""),
        consumer_key: consumerKey.trim(),
        consumer_secret: consumerSecret.trim(),
      },
      {
        onSuccess: (data) => {
          toast.success(
            data.message || "WooCommerce store connected successfully."
          )
        },
        onError: (err) => {
          toast.error(err.message || "Failed to connect WooCommerce store.")
        },
      }
    )
  }

  return (
    <>
      <Heading level="h2">2) Connect your WooCommerce store</Heading>
      <Text size="small" className="mt-1 text-ui-fg-subtle">
        Enter your WooCommerce REST API credentials. You can generate them in
        WooCommerce &rarr; Settings &rarr; Advanced &rarr; REST API.
      </Text>

      <div className="mt-4 space-y-3">
        <div>
          <Label size="xsmall" weight="plus">
            Store URL
          </Label>
          <Input
            className="mt-1"
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
            placeholder="https://mystore.com"
          />
        </div>
        <div>
          <Label size="xsmall" weight="plus">
            Consumer Key
          </Label>
          <Input
            className="mt-1"
            value={consumerKey}
            onChange={(e) => setConsumerKey(e.target.value)}
            placeholder="ck_..."
          />
        </div>
        <div>
          <Label size="xsmall" weight="plus">
            Consumer Secret
          </Label>
          <Input
            className="mt-1"
            type="password"
            value={consumerSecret}
            onChange={(e) => setConsumerSecret(e.target.value)}
            placeholder="cs_..."
          />
        </div>
      </div>

      <div className="mt-4">
        <Button
          type="button"
          size="small"
          onClick={handleConnect}
          isLoading={isPending}
        >
          Connect store
        </Button>
      </div>
    </>
  )
}

/**
 * View shown when WooCommerce is already connected: preview + import.
 */
const WooConnectedView = ({
  connection,
}: {
  connection: {
    id: string
    store_url: string
    store_name: string
    currency: string
    last_synced_at?: string
  }
}) => {
  const [importAsDraft, setImportAsDraft] = useState(false)
  const [enableSync, setEnableSync] = useState(true)
  const [importResult, setImportResult] = useState<{
    message: string
    result?: { imported: number; failed: number; skipped: number }
  } | null>(null)

  const {
    preview,
    isLoading: isLoadingPreview,
    error: previewError,
  } = useWooPreview({ enabled: true })

  const { mutateAsync: startImport, isPending: isStarting } = useWooImport()
  const { mutateAsync: disconnect, isPending: isDisconnecting } =
    useDisconnectWooCommerce()

  const [activeImportId, setActiveImportId] = useState<string | null>(null)

  // Poll import history while an import is active (the import now runs in the
  // background and returns 202, so we watch the log until it settles).
  const { imports } = useWooImportHistory({
    refetchInterval: (query: any) => {
      const list = query.state.data?.imports || []
      const latest = list[0]
      return latest &&
        (latest.status === "pending" || latest.status === "in_progress")
        ? 4000
        : false
    },
  })

  const latestImport = (imports || [])[0]
  const isRunning =
    !!latestImport &&
    (latestImport.status === "pending" ||
      latestImport.status === "in_progress")

  // When the import we started settles, surface the final counts + a toast.
  useEffect(() => {
    if (!activeImportId || !latestImport) return
    if (latestImport.id !== activeImportId) return
    if (latestImport.status === "completed" || latestImport.status === "failed") {
      setImportResult({
        message:
          latestImport.status === "completed"
            ? "Import completed."
            : "Import finished with errors.",
        result: {
          imported: latestImport.imported_count ?? 0,
          failed: latestImport.failed_count ?? 0,
          skipped: latestImport.skipped_count ?? 0,
        },
      })
      if (latestImport.status === "completed") {
        toast.success("Import completed.")
      } else {
        toast.error("Import finished with errors.")
      }
      setActiveImportId(null)
    }
  }, [activeImportId, latestImport])

  const handleImport = async () => {
    await startImport(
      {
        import_as_draft: importAsDraft,
        enable_inventory_sync: enableSync,
      },
      {
        onSuccess: (data) => {
          setImportResult(null)
          if (data?.import_log_id) {
            setActiveImportId(data.import_log_id)
          }
          toast.success(data.message || "Import started.")
        },
        onError: (err) => {
          toast.error(err.message || "Import failed to start.")
        },
      }
    )
  }

  const isImporting = isStarting || isRunning

  const handleDisconnect = async () => {
    await disconnect(undefined, {
      onSuccess: () => {
        toast.info("WooCommerce store disconnected.")
      },
      onError: (err) => {
        toast.error(err.message || "Failed to disconnect.")
      },
    })
  }

  return (
    <>
      {/* Connection status */}
      <div className="rounded-lg border border-ui-border-base p-4">
        <div className="flex items-center justify-between">
          <div>
            <Text size="small" weight="plus">
              {connection.store_name || "WooCommerce Store"}
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              {connection.store_url} · {connection.currency}
            </Text>
          </div>
          <Badge size="2xsmall" color="green">
            Connected
          </Badge>
        </div>
        <div className="mt-2">
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={handleDisconnect}
            isLoading={isDisconnecting}
          >
            Disconnect
          </Button>
        </div>
      </div>

      {/* Product preview */}
      <Heading className="mt-6" level="h2">
        2) Preview products
      </Heading>

      {isLoadingPreview ? (
        <Text size="small" className="mt-2 text-ui-fg-subtle">
          Fetching products from WooCommerce...
        </Text>
      ) : previewError ? (
        <Text size="small" className="mt-2 text-ui-fg-on-color text-red-500">
          Failed to load preview. Check your WooCommerce connection.
        </Text>
      ) : preview ? (
        <div className="mt-3 rounded-lg border border-ui-border-base p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Total products
              </Text>
              <Text size="small" weight="plus">
                {preview.total_products}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Simple products
              </Text>
              <Text size="small" weight="plus">
                {preview.simple_products}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Variable products
              </Text>
              <Text size="small" weight="plus">
                {preview.variable_products}
              </Text>
            </div>
            {preview.skipped_products > 0 && (
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Skipped (unsupported type)
                </Text>
                <Text size="small" weight="plus">
                  {preview.skipped_products}
                </Text>
              </div>
            )}
          </div>
          {preview.categories?.length > 0 && (
            <div className="mt-3">
              <Text size="xsmall" className="text-ui-fg-subtle">
                Categories
              </Text>
              <div className="mt-1 flex flex-wrap gap-1">
                {preview.categories.slice(0, 10).map((cat: any) => (
                  <Badge key={cat.id} size="2xsmall" color="grey">
                    {cat.name}
                  </Badge>
                ))}
                {preview.categories.length > 10 && (
                  <Badge size="2xsmall" color="grey">
                    +{preview.categories.length - 10} more
                  </Badge>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Import options */}
      <Heading className="mt-6" level="h2">
        3) Import options
      </Heading>

      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Text size="small" weight="plus">
              Import as draft
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Products will be created in draft status for review before
              publishing.
            </Text>
          </div>
          <Switch
            checked={importAsDraft}
            onCheckedChange={setImportAsDraft}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Text size="small" weight="plus">
              Enable inventory sync
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Periodically sync stock levels from WooCommerce.
            </Text>
          </div>
          <Switch checked={enableSync} onCheckedChange={setEnableSync} />
        </div>
      </div>

      <div className="mt-4">
        <Button
          type="button"
          size="small"
          onClick={handleImport}
          isLoading={isImporting}
          disabled={!preview || preview.total_products === 0 || isImporting}
        >
          {isRunning
            ? "Importing…"
            : `Import ${preview?.total_products ?? 0} products`}
        </Button>
        {isRunning && (
          <Text size="xsmall" className="mt-2 text-ui-fg-subtle">
            Import is running in the background. You can leave this page — track
            progress here or under import history.
          </Text>
        )}
      </div>

      {/* Import result */}
      {importResult?.result && (
        <div className="mt-4 rounded-lg border border-ui-border-base p-4">
          <Heading level="h3">Import results</Heading>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Imported
              </Text>
              <Text size="small" weight="plus">
                {importResult.result.imported}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Failed
              </Text>
              <Text size="small" weight="plus">
                {importResult.result.failed}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Skipped
              </Text>
              <Text size="small" weight="plus">
                {importResult.result.skipped}
              </Text>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Odoo import: connect an Odoo instance and import its product catalog.
 * External stores are data sources only — checkout/orders/inventory stay in FBM.
 */
const OdooImportSection = () => {
  const { connection, isLoading: isLoadingConnection } = useOdooConnection()
  const isConnected = !!connection

  return (
    <div className="mt-6">
      {isLoadingConnection ? (
        <div className="flex items-center justify-center py-8">
          <Text size="small" className="text-ui-fg-subtle">
            Checking Odoo connection...
          </Text>
        </div>
      ) : isConnected ? (
        <OdooConnectedView connection={connection} />
      ) : (
        <OdooConnectForm />
      )}
    </div>
  )
}

const OdooConnectForm = () => {
  const [url, setUrl] = useState("")
  const [dbName, setDbName] = useState("")
  const [username, setUsername] = useState("")
  const [apiKey, setApiKey] = useState("")

  const { mutateAsync: connect, isPending } = useConnectOdoo()

  const handleConnect = async () => {
    if (!url || !dbName || !username || !apiKey) {
      toast.error("All fields are required.")
      return
    }
    try {
      new URL(url)
    } catch {
      toast.error("Enter a valid Odoo URL (e.g. https://mycompany.odoo.com).")
      return
    }

    await connect(
      {
        url: url.replace(/\/+$/, ""),
        db_name: dbName.trim(),
        username: username.trim(),
        api_key: apiKey.trim(),
      },
      {
        onSuccess: (data) => {
          toast.success(data.message || "Odoo store connected successfully.")
        },
        onError: (err) => {
          toast.error(err.message || "Failed to connect Odoo store.")
        },
      }
    )
  }

  return (
    <>
      <Heading level="h2">2) Connect your Odoo instance</Heading>
      <Text size="small" className="mt-1 text-ui-fg-subtle">
        Enter your Odoo URL, database, username (email), and an API key
        (Preferences &rarr; Account Security &rarr; New API Key).
      </Text>

      <div className="mt-4 space-y-3">
        <div>
          <Label size="xsmall" weight="plus">
            Odoo URL
          </Label>
          <Input
            className="mt-1"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mycompany.odoo.com"
          />
        </div>
        <div>
          <Label size="xsmall" weight="plus">
            Database
          </Label>
          <Input
            className="mt-1"
            value={dbName}
            onChange={(e) => setDbName(e.target.value)}
            placeholder="mycompany"
          />
        </div>
        <div>
          <Label size="xsmall" weight="plus">
            Username (email)
          </Label>
          <Input
            className="mt-1"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="you@company.com"
          />
        </div>
        <div>
          <Label size="xsmall" weight="plus">
            API Key
          </Label>
          <Input
            className="mt-1"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Odoo API key"
          />
        </div>
      </div>

      <div className="mt-4">
        <Button
          type="button"
          size="small"
          onClick={handleConnect}
          isLoading={isPending}
        >
          Connect store
        </Button>
      </div>
    </>
  )
}

const OdooConnectedView = ({
  connection,
}: {
  connection: {
    id: string
    url: string
    db_name: string
    store_name?: string | null
    currency?: string | null
  }
}) => {
  const [importAsDraft, setImportAsDraft] = useState(false)
  const [importResult, setImportResult] = useState<{
    message: string
    result?: { imported: number; failed: number; skipped: number }
  } | null>(null)
  const [activeImportId, setActiveImportId] = useState<string | null>(null)

  const { preview, isLoading: isLoadingPreview } = useOdooPreview({ enabled: true })
  const { mutateAsync: startImport, isPending: isStarting } = useOdooImport()
  const { mutateAsync: disconnect, isPending: isDisconnecting } =
    useDisconnectOdoo()

  const { imports } = useOdooImportHistory({
    refetchInterval: (query: any) => {
      const list = query.state.data?.imports || []
      const latest = list[0]
      return latest &&
        (latest.status === "pending" || latest.status === "in_progress")
        ? 4000
        : false
    },
  })

  const latestImport = (imports || [])[0]
  const isRunning =
    !!latestImport &&
    (latestImport.status === "pending" ||
      latestImport.status === "in_progress")
  const isImporting = isStarting || isRunning

  useEffect(() => {
    if (!activeImportId || !latestImport) return
    if (latestImport.id !== activeImportId) return
    if (latestImport.status === "completed" || latestImport.status === "failed") {
      setImportResult({
        message:
          latestImport.status === "completed"
            ? "Import completed."
            : "Import finished with errors.",
        result: {
          imported: latestImport.imported_count ?? 0,
          failed: latestImport.failed_count ?? 0,
          skipped: latestImport.skipped_count ?? 0,
        },
      })
      if (latestImport.status === "completed") {
        toast.success("Import completed.")
      } else {
        toast.error("Import finished with errors.")
      }
      setActiveImportId(null)
    }
  }, [activeImportId, latestImport])

  const handleImport = async () => {
    await startImport(
      { import_as_draft: importAsDraft },
      {
        onSuccess: (data) => {
          setImportResult(null)
          if (data?.import_log_id) setActiveImportId(data.import_log_id)
          toast.success(data.message || "Import started.")
        },
        onError: (err) => {
          toast.error(err.message || "Import failed to start.")
        },
      }
    )
  }

  const handleDisconnect = async () => {
    await disconnect(undefined, {
      onSuccess: () => toast.info("Odoo store disconnected."),
      onError: (err) => toast.error(err.message || "Failed to disconnect."),
    })
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <Heading level="h2">2) Import from Odoo</Heading>
          <Text size="small" className="mt-1 text-ui-fg-subtle">
            Connected to {connection.store_name || connection.db_name} (
            {connection.url}).
          </Text>
        </div>
        <Button
          type="button"
          size="small"
          variant="secondary"
          onClick={handleDisconnect}
          isLoading={isDisconnecting}
        >
          Disconnect
        </Button>
      </div>

      <Text size="small" className="mt-2 text-ui-fg-subtle">
        {isLoadingPreview
          ? "Loading catalog…"
          : `${preview?.total_products ?? 0} products available to import.`}
      </Text>

      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Text size="small" weight="plus">
              Import as draft
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Imported products start as drafts for review.
            </Text>
          </div>
          <Switch checked={importAsDraft} onCheckedChange={setImportAsDraft} />
        </div>
      </div>

      <div className="mt-4">
        <Button
          type="button"
          size="small"
          onClick={handleImport}
          isLoading={isImporting}
          disabled={!preview || preview.total_products === 0 || isImporting}
        >
          {isRunning
            ? "Importing…"
            : `Import ${preview?.total_products ?? 0} products`}
        </Button>
        {isRunning && (
          <Text size="xsmall" className="mt-2 text-ui-fg-subtle">
            Import is running in the background. You can leave this page — track
            progress here or under import history.
          </Text>
        )}
      </div>

      {importResult?.result && (
        <div className="mt-4 rounded-lg border border-ui-border-base p-4">
          <Heading level="h3">Import results</Heading>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Imported
              </Text>
              <Text size="small" weight="plus">
                {importResult.result.imported}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Failed
              </Text>
              <Text size="small" weight="plus">
                {importResult.result.failed}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Skipped
              </Text>
              <Text size="small" weight="plus">
                {importResult.result.skipped}
              </Text>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

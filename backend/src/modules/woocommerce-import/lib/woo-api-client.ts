import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api"
import type {
  WooProduct,
  WooVariation,
  WooCategory,
  WooCredentials,
} from "../types"

const MAX_REQUESTS_PER_WINDOW = 20
const WINDOW_MS = 10_000
const COURTESY_DELAY_MS = 200
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 2_000
const PER_PAGE = 100
// Safety cap so a misbehaving store that always returns a full page can't loop
// forever (PER_PAGE * MAX_PAGES = 50k items).
const MAX_PAGES = 500

export class WooApiClient {
  private client: WooCommerceRestApi
  private requestCount = 0
  private windowStart = Date.now()

  constructor(credentials: WooCredentials) {
    // Normalize URL: remove trailing slash
    const url = credentials.url.replace(/\/+$/, "")

    this.client = new WooCommerceRestApi({
      url,
      consumerKey: credentials.consumer_key,
      consumerSecret: credentials.consumer_secret,
      version: "wc/v3",
      // Send credentials in the Authorization header, not the query string, so
      // the key/secret aren't exposed in URLs/proxy logs. Over HTTPS the client
      // uses Basic auth; for http it falls back to OAuth 1.0a signing.
      queryStringAuth: false,
    })
  }

  /**
   * Validate that the WooCommerce connection works.
   * Returns store info on success.
   */
  async validateConnection(): Promise<{
    store_name: string
    wc_version: string
    currency: string
  }> {
    try {
      const response = await this.makeRequest("system_status")
      const data = response.data

      // Also fetch the store's currency setting
      let currency = "USD"
      try {
        const settingsResponse = await this.makeRequest("settings/general")
        const currencySetting = settingsResponse.data?.find(
          (s: any) => s.id === "woocommerce_currency"
        )
        if (currencySetting?.value) {
          currency = currencySetting.value
        }
      } catch {
        // Fallback: try from system_status
        if (data.settings?.currency) {
          currency = data.settings.currency
        }
      }

      return {
        store_name: data.environment?.site_title || data.environment?.home_url || "Unknown Store",
        wc_version: data.environment?.version || "unknown",
        currency,
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error("Invalid WooCommerce API credentials. Check your consumer key and secret.")
      }
      if (error.response?.status === 404) {
        throw new Error("WooCommerce REST API not found. Ensure WooCommerce is installed and the REST API is enabled.")
      }
      if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
        throw new Error("Store unreachable. Check the URL and ensure the site is online.")
      }
      if (error.code === "ERR_TLS_CERT_ALTNAME_INVALID" || error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
        throw new Error("SSL certificate error. The store must use a valid HTTPS certificate.")
      }
      throw new Error(`Connection failed: ${error.message}`)
    }
  }

  /**
   * Fetch all products from WooCommerce (paginated).
   * Only returns simple and variable products.
   */
  async fetchAllProducts(
    onProgress?: (fetched: number, total: number) => void
  ): Promise<WooProduct[]> {
    const allProducts: WooProduct[] = []
    let page = 1
    let totalProducts = 0

    while (page <= MAX_PAGES) {
      const response = await this.makeRequest("products", {
        per_page: PER_PAGE,
        page,
        status: "any",
        type: "simple,variable", // Only fetch supported types
      })

      const products = response.data as WooProduct[]
      if (!products || products.length === 0) break

      allProducts.push(...products)

      if (page === 1) {
        totalProducts = parseInt(response.headers?.["x-wp-total"] || "0", 10) || allProducts.length
      }

      if (onProgress) {
        onProgress(allProducts.length, totalProducts)
      }

      // Terminate on a short page rather than trusting x-wp-totalpages, which a
      // proxy/cache may strip — defaulting it to 1 would silently truncate the
      // import to the first page.
      if (products.length < PER_PAGE) break

      page++
      await this.courtesyDelay()
    }

    return allProducts
  }

  /**
   * Fetch variations for a variable product.
   */
  async fetchProductVariations(productId: number): Promise<WooVariation[]> {
    const allVariations: WooVariation[] = []
    let page = 1

    while (page <= MAX_PAGES) {
      const response = await this.makeRequest(
        `products/${productId}/variations`,
        { per_page: PER_PAGE, page }
      )

      const variations = response.data as WooVariation[]
      if (!variations || variations.length === 0) break

      allVariations.push(...variations)

      if (variations.length < PER_PAGE) break

      page++
      await this.courtesyDelay()
    }

    return allVariations
  }

  /**
   * Fetch categories from WooCommerce.
   */
  async fetchCategories(): Promise<WooCategory[]> {
    const allCategories: WooCategory[] = []
    let page = 1

    while (page <= MAX_PAGES) {
      const response = await this.makeRequest("products/categories", {
        per_page: PER_PAGE,
        page,
      })

      const categories = response.data as WooCategory[]
      if (!categories || categories.length === 0) break

      allCategories.push(...categories)

      if (categories.length < PER_PAGE) break

      page++
    }

    return allCategories
  }

  /**
   * Fetch a single product by ID (used for inventory sync).
   */
  async fetchProduct(productId: number): Promise<WooProduct> {
    const response = await this.makeRequest(`products/${productId}`)
    return response.data as WooProduct
  }

  /**
   * Make a rate-limited request to the WooCommerce API with retry logic.
   */
  private async makeRequest(
    endpoint: string,
    params?: Record<string, any>,
    retryCount = 0
  ): Promise<any> {
    await this.enforceRateLimit()

    try {
      const response = await this.client.get(endpoint, params || {})
      this.requestCount++
      return response
    } catch (error: any) {
      if (error.response?.status === 429 && retryCount < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, retryCount)
        await this.sleep(backoff)
        return this.makeRequest(endpoint, params, retryCount + 1)
      }

      if (error.response?.status === 401) {
        throw new Error("Invalid WooCommerce credentials")
      }

      if (error.response?.status === 404) {
        throw new Error(`WooCommerce endpoint not found: ${endpoint}`)
      }

      throw error
    }
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.windowStart

    if (elapsed >= WINDOW_MS) {
      this.requestCount = 0
      this.windowStart = now
      return
    }

    if (this.requestCount >= MAX_REQUESTS_PER_WINDOW) {
      const waitTime = WINDOW_MS - elapsed
      await this.sleep(waitTime)
      this.requestCount = 0
      this.windowStart = Date.now()
    }
  }

  private async courtesyDelay(): Promise<void> {
    await this.sleep(COURTESY_DELAY_MS)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

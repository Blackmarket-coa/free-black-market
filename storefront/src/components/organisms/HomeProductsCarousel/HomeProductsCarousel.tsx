import { Carousel } from "@/components/cells"
import { ProductCard } from "../ProductCard/ProductCard"
import { listProducts } from "@/lib/data/products"
import { HttpTypes } from "@medusajs/types"

const looksLikePlaceholderListing = (product: HttpTypes.StoreProduct) => {
  const title = String(product.title || "").toLowerCase()
  const handle = String(product.handle || "").toLowerCase()

  return ["test", "placeholder", "sample", "dummy"].some((token) =>
    title.includes(token) || handle.includes(token)
  )
}


/**
 * A row of product cards.
 *
 * On the home page (`home`) it fetches and shows the newest products.
 * Elsewhere it shows the products it is given, which the caller has already
 * fetched from the listing: every card is rendered from a product
 * `GET /store/products` served, so it carries its price and its seller's
 * name, and nothing the listing did not serve is handed to the client card.
 */
export const HomeProductsCarousel = async ({
  locale,
  sellerProducts,
  home,
}: {
  locale: string
  sellerProducts: HttpTypes.StoreProduct[]
  home: boolean
}) => {
  let products = sellerProducts

  if (home) {
    try {
      const { response } = await listProducts({
        countryCode: locale,
        queryParams: { limit: 10, order: "created_at" },
      })
      products = response.products
    } catch {
      return null
    }
  }

  const productsToRender = products.filter(
    (product) => !looksLikePlaceholderListing(product)
  )

  if (!productsToRender.length) return null

  return (
    <div className="w-full">
      <Carousel
        align="start"
        items={productsToRender.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            api_product={product}
            variant={home ? "producer-forward" : "default"}
          />
        ))}
      />
    </div>
  )
}

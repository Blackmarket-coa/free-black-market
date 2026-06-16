import { Carousel } from "@/components/cells"
import { ProductCard } from "../ProductCard/ProductCard"
import { listProducts } from "@/lib/data/products"
import { Product } from "@/types/product"
import { HttpTypes } from "@medusajs/types"
import { getProductPrice } from "@/lib/helpers/get-product-price"

const looksLikePlaceholderListing = (product: HttpTypes.StoreProduct) => {
  const title = String(product.title || "").toLowerCase()
  const handle = String(product.handle || "").toLowerCase()

  return ["test", "placeholder", "sample", "dummy"].some((token) =>
    title.includes(token) || handle.includes(token)
  )
}


export const HomeProductsCarousel = async ({
  locale,
  sellerProducts,
  home,
}: {
  locale: string
  sellerProducts: Product[]
  home: boolean
}) => {
  let products: HttpTypes.StoreProduct[] = []
  try {
    const { response } = await listProducts({
      countryCode: locale,
      queryParams: {
        limit: home ? 10 : undefined,
        order: "created_at",
        handle: home ? undefined : sellerProducts.map((product) => product.handle),
      },
      forceCache: !home,
    })
    products = response.products
  } catch {
    // Backend ORM bug workaround — return null gracefully so the page doesn't crash
    if (!sellerProducts.length) return null
  }

  if (!products.length && !sellerProducts.length) return null

  const productsToRender = (sellerProducts.length ? sellerProducts : products).filter(
    (product) => !looksLikePlaceholderListing(product as HttpTypes.StoreProduct)
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
            variant={home ? "producer-forward" : "default"}
            api_product={
              home
                ? (product as HttpTypes.StoreProduct)
                : products.find((candidate) => {
                    const { cheapestPrice } = getProductPrice({
                      product: candidate,
                    })
                    return (
                      cheapestPrice &&
                      candidate.id === product.id &&
                      Boolean(cheapestPrice)
                    )
                  })
            }
          />
        ))}
      />
    </div>
  )
}

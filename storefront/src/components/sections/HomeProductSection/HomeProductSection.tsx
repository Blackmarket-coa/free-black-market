import { HomeProductsCarousel } from "@/components/organisms"
import { HttpTypes } from "@medusajs/types"

export const HomeProductSection = async ({
  heading,
  locale = process.env.NEXT_PUBLIC_DEFAULT_REGION || "pl",
  products = [],
  home = false,
}: {
  heading: string
  locale?: string
  /**
   * The products to show, already fetched from the listing (the product
   * page's "More from this seller"). Left out on the home page, which shows
   * the newest products.
   */
  products?: HttpTypes.StoreProduct[]
  home?: boolean
}) => {
  return (
    <section
      className={
        home
          ? "w-full rounded-3xl border border-zinc-200/70 bg-gradient-to-b from-white via-zinc-50/60 to-zinc-100/40 px-4 py-10 md:px-6"
          : "w-full py-8"
      }
    >
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="space-y-2">
          <h2 className="heading-lg font-bold tracking-tight uppercase">{heading}</h2>
          {home && (
            <p className="text-sm text-zinc-600 md:text-base">
              Browse the 10 most recently published marketplace products.
            </p>
          )}
        </div>
      </div>

      <HomeProductsCarousel
        locale={locale}
        sellerProducts={products}
        home={home}
      />
    </section>
  )
}
